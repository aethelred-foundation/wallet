# P2: `custodian_liability_unknown_rate ≥ 0.05` (custodian-oracle degraded)

> **Alert class:** Custodian liability attestation / observability completeness
> **Severity:** P2 (paginate during business hours; **escalate to P1
> if `unknown_rate ≥ 0.25` for any single custodian, OR the custodian
> handles assets-under-attestation > \$100M, OR a regulator request
> for a custodian liability snapshot is in-flight**)
> **Class:** Custodian oracle reachability + signed-attestation pipeline
> **Packages affected:** `@aethelred/wallet-custody-adapters` (attestor
> implementations, `captureLiabilitySnapshot`), `@aethelred/wallet-audit`
> (event recording), `@aethelred/wallet-observability`
> (`CustodianLiabilityHistogram`)
> **Last validated:** 2026-05-04

## 1. What this alert means

The wallet captured ≥ 5% failed attestation attempts in the recent
rolling window for at least one custodian. Concretely:

```
custodian_liability_unknown_rate{custodian_id="..."} ≥ 0.05
```

This is computed by `CustodianLiabilityHistogram` (PR #164) as
`window_unknown_count / window_total` over the last 1024 sample
window per custodian. The companion gauge
`custodian_liability_latest_attestation_age_ms` typically grows in
parallel when the oracle is unreachable.

A `liabilityUnknown: true` event lands in the audit chain whenever
`JsonFeedLiabilityAttestor` (or any custom attestor) returned `null`
from `fetchAttestation()`. The attestor returns `null` when ANY of:

1. **Network failure** — HTTP fetch threw, non-2xx response, or
   `AbortController` timeout (default 5s).
2. **Parse failure** — JSON body malformed, missing required fields,
   wrong types, malformed signature or coverage.
3. **Freshness violation** — snapshot older than `maxAgeMs` (default
   10 min) OR future-dated.
4. **Signature verification failure** — pinned key in
   `Secp256k1OracleSignatureVerifier` rejected the signature, or
   verifier threw.

The system continues to function correctly during the alert window —
transactions still settle, audit chain still hashes, the
`liabilityUnknown: true` events are themselves cryptographically
recorded so a future auditor can see "we tried at this exact
millisecond and got nothing." This is the suppression-defense
property from PR #148.

## 2. Impact

- **Transaction liveness preserved.** `captureLiabilitySnapshot`
  is fail-graceful — null attestation does NOT block the transaction.
  Wallet liveness is intentionally decoupled from third-party oracle
  availability.
- **Audit chain remains consistent.** Each `liabilityUnknown: true`
  event still has a deterministic SHA-256 digest binding it to its
  transaction id. `AuditCapture.verifyChain` continues to return
  `true` across mixed known/unknown sequences.
- **Compliance evidence gap.** The wallet cannot prove the custodian's
  active SLA + insurance coverage state at the moment of execution
  for transactions during the alert window. An external auditor
  reviewing those transactions will see "attestation gap" markers
  instead of `\$X coverage, status: operational`. The transactions
  themselves are not invalidated, but the *evidence completeness*
  for them is reduced.
- **Coverage-monitoring blind spot.** The
  `custodian_liability_latest_coverage` gauge stays pinned to the
  last known value — it does NOT update during the gap. If the
  custodian quietly reduced coverage during the outage, operators
  won't see it until the oracle recovers. See §4 hypothesis C.
- **Regulator-clock implications.** None automatic. But: a regulator
  request that touches an affected transaction within the gap window
  will require manual evidence reconstruction (custodian's own
  records, signed statements). Note in the incident channel if any
  open regulator inquiry intersects the affected transaction set.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the Custody / Compliance dashboard (Grafana →
   Custody row → "Oracle reliability per custodian" panel).
3. From the alert context pull:
   - `custodian_id` — which custodian's oracle is flapping
   - `unknown_rate` — current value
   - `window_total` — sample count (low values are noisier; if
     `window_total` < 20 the rate may be jittery, not a real outage)
   - `latest_attestation_age_ms` — how stale the last attestation is
   - `latest_sla_status` — what the custodian's status was right
     before things went sideways

### 3.2 Minute 2–5: classify

The runbook's first decision: **is this one custodian or several?**

Query Prometheus / the dashboard:

```promql
custodian_liability_unknown_rate >= 0.05
```

- **Single custodian** (most common): scope is bounded to one
  vendor. Proceed to §3.3 single-custodian triage.
- **Multiple custodians simultaneously**: highly unusual.
  Hypotheses in priority order:
  - Wallet host has lost outbound network (check `node_exporter`
    on the host).
  - Wallet's shared oracle infrastructure (Chainlink node, etc.)
    is down — check `chainlink:custody:*` shared oracle health.
  - Wallet TLS bundle is broken (cert rotation drift) — check
    the wallet host's CA store, run `openssl s_client` against
    one of the oracle URLs.
  - System clock is wrong — `latest_attestation_age_ms` going
    NEGATIVE on the gauge would surface this (clamped to 0 in
    PR #165, but raw `now() < attestedAt` is the smoking gun).
  - All custodians publish through a common pinning oracle that
    rotated keys without notice — see hypothesis D.

  **If multi-custodian, escalate to P1 immediately.** Multi-vendor
  simultaneous failure indicates an upstream wallet-side problem,
  not a vendor-side outage.

### 3.3 Single-custodian triage

For the affected `custodian_id`:

1. Check the custodian's public status page first
   (e.g., status.komainu.com, status.fireblocks.com). If they've
   declared an incident, you're correlated — note their incident
   number in the channel and proceed to §4 hypothesis A.

2. Probe the oracle URL directly from a host on the same network
   as the wallet:

   ```bash
   curl -i --max-time 10 https://oracle.example.com/<custodian>
   ```

   - **Connection refused / DNS failure** → §4 hypothesis B
     (network-side)
   - **5xx response** → §4 hypothesis A (oracle-side)
   - **200 OK with body** → continue to step 3

3. Validate the body against the schema the attestor expects:

   ```bash
   curl -s https://oracle.example.com/<custodian> | jq '. | {custodianId, slaStatus, insuranceCoverage, insuranceCurrency, attestedAt, oracleId, signature}'
   ```

   - **Missing required fields / wrong types** → §4 hypothesis E
     (schema drift)
   - **`attestedAt` >> 10 min old** → §4 hypothesis C (oracle
     stalled)
   - **`signature` present but verifier rejects** → §4 hypothesis D
     (key rotation)

## 4. Hypothesis space

### Hypothesis A — vendor-side outage

The custodian's oracle is failing on their side. Their status page
confirms it.

**Diagnosis:**
- Custodian's status page declares incident
- `latest_attestation_age_ms` growing without bound
- Direct curl returns 5xx or no response
- Other tenants of the same custodian also report degraded
  attestation (check #ops-custody Slack for cross-team signals)

**Mitigation:**
- Confirm transactions are still settling — this alert does NOT
  block them. Audit gap is the only impact.
- Stand up an incident channel `#inc-YYYY-MM-DD-NNN`, post the
  vendor incident number, and pin this runbook.
- Comms: NOT a customer-facing P0 unless the custodian's outage
  is causing actual settlement failures via a different path
  (rare). The compliance gap is a regulator-facing post-incident
  story, not a customer one.
- ETA: wait for vendor resolution. The audit gap self-heals when
  the next successful attestation lands — no wallet-side action
  required to recover the metric.

**Post-incident:**
- Note the affected transaction set in the incident postmortem
  for compliance evidence reconstruction.

### Hypothesis B — wallet-side network outage

The wallet host can't reach the oracle (DNS, firewall, NAT, TLS).

**Diagnosis:**
- `curl` from the wallet host fails; same `curl` from a different
  host succeeds
- `node_exporter` shows interface flapping, packet loss, etc.
- TLS error: cert expired, CA bundle mismatch

**Mitigation:**
- **Containment:** if the wallet has a fallback attestor (e.g., a
  secondary oracle URL for the same custodian wrapped in a
  `CachingLiabilityAttestor`), failover via ops config. The
  existing `NoopLiabilityAttestor` is NOT a valid fallback — it
  produces `liabilityUnknown: true` for every transaction.
- **Recover:** fix DNS / firewall / TLS bundle. Restart the wallet
  process if the network state was cached.
- **Verify:** `unknown_rate` should drop back below threshold
  within ~window-fill time (1024 samples).

### Hypothesis C — oracle stalled (responses arriving but stale)

The oracle endpoint responds 200 OK but the `attestedAt`
timestamps are old.

**Diagnosis:**
- `latest_attestation_age_ms` growing without bound DESPITE
  responses succeeding at the curl level
- Custodian status page may not yet reflect the stall
- The freshness gate (default `maxAgeMs: 10 * 60_000`) is rejecting
  every snapshot

**Mitigation:**
- **Diagnose first, mitigate second.** A stalled oracle is more
  dangerous than a down one — it suggests the custodian's internal
  pipeline is broken but their HTTP layer is still serving cached
  data. Insurance coverage info you'd see from a non-stale path
  may differ.
- Contact custodian via their P1 channel (typically a dedicated
  Slack or pager). Note that THEIR status page doesn't show the
  issue.
- Do NOT raise `maxAgeMs` to "fix" the metric. A stale snapshot
  is operationally worse than a missing one — it claims liability
  state that no longer holds.

### Hypothesis D — oracle key rotation

The custodian rotated their signing key without notifying us; the
verifier's pinned key no longer matches.

**Diagnosis:**
- HTTP returns 200, schema is valid, but verifier rejects
- The `signature` field is present and well-formed
- Custodian's docs page has a new public key published

**Mitigation:**
- **Verify the new key out-of-band.** Confirm via a second channel
  (vendor email, signed Slack message) that the new key is genuine.
  Do NOT pull the key from the same endpoint that's failing to
  attest — that's a chicken-and-egg attack vector.
- **Rotation in place** if `Secp256k1OracleSignatureVerifier` was
  configured with multiple pinned keys:

  ```ts
  // pinnedKeys map per oracleId carries OLD + NEW during rotation
  new Map([[oracleId, [oldKeyBytes, newKeyBytes]]])
  ```

  If both keys are pinned, the verifier accepts either — the
  rotation window. If only the old key was pinned, ops needs to
  push a config update adding the new key. See PR #153 docs on
  rotation windows.
- After rotation completes, schedule a follow-up ticket to remove
  the old key from the pin map (don't leave stale keys live).

### Hypothesis E — schema drift

The custodian changed their JSON shape (renamed a field, changed
a type, etc.) without versioning the endpoint.

**Diagnosis:**
- HTTP returns 200, signature is valid, but
  `JsonFeedLiabilityAttestor.fetchAttestation` returns null
- Manual curl + jq shows missing required fields OR wrong types

**Mitigation:**
- **Confirm via the custodian's developer changelog** that the
  schema actually changed (vs. transient bug).
- **Patch the parser:** update `parseAttestationJson` in
  `packages/custody-adapters/src/json-feed-attestor.ts` to accept
  the new shape. The function is intentionally tolerant of
  *additive* changes (extra fields ignored); only *renames* /
  *type changes* require code.
- **Open a custodian-side ticket** asking them to version their
  endpoint going forward (`/v2/attestation` etc.).

## 5. Resolution paths

| Hypothesis | Time-to-recover | Action owner |
|---|---|---|
| A: vendor outage | Hours, vendor-dependent | Wallet ops monitors; no code change |
| B: wallet network | Minutes once root cause identified | Wallet ops / infra |
| C: oracle stalled | Hours, vendor-dependent | Wallet ops + custodian-side P1 |
| D: key rotation | Minutes if rotation window pre-configured; hours if config push required | Wallet ops + custody team |
| E: schema drift | Hours (code change + deploy) | Custody-adapters maintainer |

For all hypotheses: once `unknown_rate` drops back below
threshold, no manual intervention is needed to "clear" the audit
gap. The `liabilityUnknown: true` events remain in the chain as
permanent evidence that the wallet *tried* during the gap window
and failed — which is exactly the property auditors need.

## 6. Post-incident

- [ ] Document affected transaction set: query
  `audit_event.kind = "custodian-liability-snapshot" AND
  detail.liabilityUnknown = true AND
  capturedAt ∈ [incident_start, incident_end]`. This is the
  evidence-gap surface for any regulator request that lands later.
- [ ] If hypothesis D (key rotation): file a request with the
  custodian for advance-notice on the next rotation. Open an
  internal ticket to add rotation runbooks if missing.
- [ ] If hypothesis E (schema drift): land a regression test in
  `apps/extension/src/test/json-feed-liability-attestor.test.ts`
  pinning the new schema; consider asking the vendor to version
  their endpoint.
- [ ] Update the per-custodian SLO in
  `docs/perf/SLO.md` if recurring with this vendor — sometimes
  the right answer is "this vendor's oracle isn't reliable
  enough for our tier; renegotiate or replace."
- [ ] Review the alert threshold. The default 5% is conservative;
  some custodians may need a higher threshold (e.g., 10% for
  vendors with documented intermittent attestation availability).

## 7. Sharp edges

- **`liabilityUnknown` events are NOT silent failures.** Some
  on-call may think "the attestor returned null, the audit must
  have nothing about this transaction." Wrong. The event is
  recorded with `liabilityUnknown: true`. Auditors see the gap.
  This is the suppression defense; do not "fix" the metric by
  suppressing the events.
- **Do not switch the verifier to `PASSTHROUGH_VERIFIER` to
  silence the alert.** That mode trades cryptographic verification
  for transport-layer trust and is only appropriate for mTLS-
  pinned endpoints. Using it to make the alert go away during a
  signature mismatch (hypothesis D) bypasses the entire security
  posture.
- **Do not raise `maxAgeMs` to silence hypothesis C.** Stale
  attestations are operationally worse than missing ones — they
  claim a custodian liability state that no longer holds.
- **`reset()` on the histogram clears `unknown_rate` to 0**
  because there are zero samples again. Don't reset during an
  incident as a "fix" — you've just hidden the gap, not closed
  it. Reset belongs in SLO-boundary maintenance, not incident
  response.

## 8. References

- Custodian liability attestation pipeline: `docs/architecture/INSTITUTIONAL_COMPLIANCE_PIPELINE.md`
- Source: `packages/custody-adapters/src/liability-attestation.ts`,
  `packages/custody-adapters/src/json-feed-attestor.ts`,
  `packages/custody-adapters/src/secp256k1-oracle-verifier.ts`
- Histogram: `packages/observability/src/custodian-liability-histogram.ts`
- Integration test: `apps/extension/src/test/institutional-compliance-pipeline.test.ts`
- Source PRs: #148 (capture), #150 (audit wiring), #152 (json-feed
  attestor), #153 (secp256k1 verifier), #164 (histogram), #165
  (exportToMeter)
