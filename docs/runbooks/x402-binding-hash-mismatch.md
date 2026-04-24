# P0: `x402.binding.mismatch ≥ 1`

> **Alert class:** Zero-tolerance correctness event
> **Severity:** P0 (pages immediately, 24/7)
> **Class:** Cryptographic binding violation
> **Packages affected:** `@aethelred/wallet-x402`
> **Last validated:** 2026-04-24

## 1. What this alert means

The facilitator received a payment whose TEE-attestation binding
hash does NOT match the expected `sha256(structHash ||
sha256(canonicalQuoteBytes))` computed from the submitted payload.

This is the x402 cornerstone property. In a healthy system, this
counter NEVER increments. Any firing means one of three things:

1. **Latent bug.** Canonical encoding drift between the client and
   the facilitator (e.g. a PR changed the canonical form without
   bumping both sides).
2. **Version skew.** Client + facilitator running different
   canonicalisation versions across a deploy boundary.
3. **Active compromise.** A malicious client is forging TEE quotes
   OR a malicious facilitator is spoofing verification.

## 2. Impact

- Payments with bad bindings **are rejected** — the binding check
  is the gate, so money doesn't move on the mismatch itself.
- However, the counter firing once means the mismatch was close
  enough to a successful payment to merit investigation. Silent
  quote-replay or canonical-form drift leaves attack surface that
  WILL be exploited.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the x402 facilitator dashboard.

### 3.2 Minute 2–5: contain

**Do NOT deploy any fix in the first 5 minutes.** The mismatch is
caught by the existing check; customer funds are safe. Wider
exposure from a hasty rollback is riskier than a 10-minute
investigation.

If traffic is actively increasing + more events fire:

- **Temporarily block new payment-requirement responses** via the
  facilitator feature flag `X402_BINDING_STRICT_MODE=reject-only`
  (default config). This keeps existing verified payments flowing
  but refuses NEW ones until we've diagnosed.

### 3.3 Minute 5–15: triage

Pull the raw event from logs:

```bash
# Fetch the last 10 mismatch events
dd logs query "service:x402-facilitator event:binding-mismatch" \
   --from="15m ago" --limit=10 --format=json
```

For each event, you need:

- **`expectedBinding`** — what the facilitator recomputed.
- **`presentedBinding`** — what the client submitted.
- **`structHash`** — the payment struct the facilitator saw.
- **`canonicalQuoteBytes` (hash)** — the quote fingerprint.
- **`userAgent`** — which client version?
- **`facilitatorBuild`** — which facilitator commit?

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — canonical drift.** If `structHash` matches the
on-wire payment BUT the canonical quote bytes differ, this is
canonicalisation drift. Check:

```bash
# Pull the canonicalisation module version from both sides
git log -- packages/x402/src/canonical.ts | head
git log -- packages/compliance/src/tee-attestation.ts | head
```

Any commit in the last 7 days touching either file is a suspect.

**Hypothesis B — version skew.** Compare the `facilitatorBuild`
commit hash against deployed client versions:

```bash
# What versions are live?
kubectl get deploy -n facilitator -o yaml | grep image:
# What does the client announce in the user-agent?
# (pull from event log above)
```

If client build ≠ facilitator build AND the delta touches x402 or
TEE code, version-skew is the likely cause.

**Hypothesis C — active compromise.** If neither A nor B holds,
treat as a security incident. The counter exists precisely to
catch this.

- Preserve ALL mismatch events by tagging them for retention
  extension (18 months → 7 years cold storage).
- Capture the network context: `sourceIp`, `originHeader`,
  `TLSFingerprint` if available.
- Escalate to Security Lead (role defined in `INCIDENT_RESPONSE.md`
  §2).

## 4. Resolution paths

### Hypothesis A resolved: canonicalisation drift

1. Identify the drifting commit.
2. If drift is a bug: revert or fix-forward — both sides must be
   on the same canonical form.
3. Ship the fix with a test that would have caught the drift.
4. Close the binding-strict-mode feature flag back to default.

### Hypothesis B resolved: version skew

1. Identify which side (client or facilitator) is behind.
2. Roll the lagging side forward, OR roll the ahead side back.
3. Document the deploy-ordering requirement in
   `contracts/deployments.json` notes (if contracts-relevant) or
   in the deployment runbook.
4. Close the binding-strict-mode feature flag back to default.

### Hypothesis C resolved: active compromise

1. Engage Security Lead immediately per `INCIDENT_RESPONSE.md` §2.
2. Preserve the complete event timeline; do NOT deploy changes
   yet.
3. Isolate the compromised component (client build — revoke
   Chrome Web Store version / facilitator — take the affected
   instance offline).
4. Regulator notification clock: GDPR 72-hour window starts at
   page-ack time.
5. Follow the security-incident branch in `INCIDENT_RESPONSE.md`
   §4.

## 5. Escalation criteria

Escalate to Security Lead immediately if ANY of:

- ≥ 3 events in the first hour (too high for a simple drift bug).
- Events span > 1 facilitator build (suggests shared-upstream
  compromise).
- Presented binding matches a pattern used by known TEE-quote
  replay attacks (check against the security-advisory registry).
- The client user-agents vary widely (not a single buggy build).

## 6. Post-incident

Follow `TEMPLATE_POSTMORTEM.md`. Specific action items this
incident class always produces:

- [ ] Did a property test exist covering the mismatch condition?
  If yes, why did it pass? If no, add one.
- [ ] Review deploy-ordering requirements between client +
  facilitator.
- [ ] Re-validate that `x402.binding.mismatch` alert triggers
  within 60 seconds of the first event (verify against incident
  timeline).
- [ ] Confirm all mismatch events are preserved in 7-year cold
  storage.

## 7. Why this runbook exists

Per [`docs/compliance/OBSERVABILITY_SCOPE.md`](../compliance/OBSERVABILITY_SCOPE.md)
§4.3, `x402.binding.mismatch` is one of seven zero-tolerance events.
The full list is covered by unit + fuzz tests in the x402 package,
so a firing in production means a latent-bug-that-escaped-CI OR
an attack — this runbook routes both paths to the correct
investigation.
