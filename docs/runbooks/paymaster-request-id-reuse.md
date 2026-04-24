# P0: `sponsor.request_id.reused ≥ 1`

> **Alert class:** Zero-tolerance correctness event
> **Severity:** P0 (pages immediately, 24/7)
> **Class:** Sponsorship replay resistance
> **Packages affected:** `@aethelred/wallet-paymaster-sponsor`
> **Last validated:** 2026-04-24

## 1. What this alert means

The paymaster-sponsor service attempted to record a sponsorship
approval with a `requestId` that already exists in the ledger.
The service threw `request-id-reused` and did not sign the
approval.

`requestId` is deterministic:

```
requestId = keccak(userOpHash || validUntil || validAfter || priceQuoteId)
```

Under healthy conditions every sponsorship has a unique request
id because at least one input changes per request:

- `priceQuoteId` is fresh per oracle fetch (bound to the
  oracle's `asOf` timestamp).
- `userOpHash` is unique per UserOp.
- `validUntil` / `validAfter` depend on request time.

Any firing means:

1. **Replayed sponsorship request.** The caller submitted the
   identical request twice — usually a network retry without
   regenerating the request.
2. **Clock collision.** A replay was attempted within the same
   tick of the oracle's timestamp, producing the same
   `priceQuoteId`. Pinned-clock tests in CI exercise this path.
3. **Adversarial replay.** Attacker captured a sponsorship
   request pre-submission and tried to replay it.

## 2. Impact

- The duplicate sponsorship **is rejected.** The paymaster
  approval is not signed. The caller sees a typed
  `PaymasterSponsorError` with code `request-id-reused`.
- No user funds or sponsor funds move on the rejection.
- Revenue impact: zero — the rejected call didn't sponsor
  anything. Signal value: confirming whether the cause is a
  client bug or something adversarial.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the paymaster-sponsor dashboard.
3. Pull from the alert context: `requestId`, `agentId`,
   `chainId`, `priceQuoteId`, `submittedAt`, `ingressIp`.

### 3.2 Minute 2–5: contain

Contained by construction — the ledger rejected the replay.
Containment is forensic preservation.

- Tag all request-id-reuse events for extended retention
  (18mo → 7yr cold storage).
- If the request rate spikes from a single agent:
  ```bash
  ops:sponsor agent-block --agent=<id> \
                          --reason="suspected replay activity"
  ```
  The `AgentBlocklistPolicy` then rejects subsequent requests
  at the policy-evaluation step.

### 3.3 Minute 5–15: triage

Pull both the original sponsorship AND the replay attempt:

```bash
dd logs query "service:paymaster-sponsor requestId:<id>" \
   --from=30d --format=json
```

You should see exactly ONE earlier `sponsorship-approved` event
at this requestId. Compare:

- **Timestamps:** how far apart?
- **Source IPs:** same ingress, different, suspicious?
- **User-agent / client build:** identical?
- **UserOp payloads:** hash-identical?

Also retrieve the earlier sponsorship's settlement state:

```bash
# Was the original sponsorship actually settled on-chain?
ops:sponsor ledger-lookup --request-id=<id>
```

Understanding whether the original already settled tells you
whether the duplicate is benign (already-settled, nothing to
gain by replaying) or potentially-adversarial (original still
pending, replay is trying to double-sponsor).

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — client retry bug.** Same source, same
user-agent, same UserOp hash:

- Caller retried without refreshing the sponsorship request.
  Common pattern: client saw network timeout, retried with
  cached request instead of regenerating.
- Not a security incident; UX bug worth fixing in the client.

**Hypothesis B — oracle clock collision.** Timestamps within
the oracle's quote-validity window (tests use pinned clock for
this; production oracles usually differ by a few seconds):

- Review `FixedPriceOracle` / `CachingPriceOracle` behaviour —
  is `asOf` advancing per request? If two requests fall
  within the same quote-cache bucket, they share `priceQuoteId`.
- Expected: if client regenerates userOp between requests
  (different `userOpHash`), the collision doesn't occur. If
  client reuses the userOp AND the quote didn't refresh, you
  get same requestId.

**Hypothesis C — adversarial replay attempt.** Different source,
same UserOp payload + same quote:

- Someone captured a sponsorship request in transit and is
  trying to replay it.
- The paymaster-sponsor caught it; no damage.
- Important: HOW did the adversary capture the request? That's
  the investigation.

## 4. Resolution paths

### Hypothesis A: client retry bug

1. Identify client build from user-agent.
2. Patch the client to regenerate the sponsorship request (new
   quote + new validUntil) on retry, not replay the cached one.
3. Roll to the fixed build.

### Hypothesis B: oracle clock collision

1. Verify: is this expected-and-benign (the client legitimately
   resubmitted within the quote cache window)?
2. If unwanted: tighten the oracle's cache TTL or add salt to
   the quote-id derivation (e.g., include a random nonce).
3. For CachingPriceOracle users: review the TTL setting — short
   enough that replays are meaningfully different, long enough
   that oracle queries stay cheap.

### Hypothesis C: adversarial replay

1. Escalate to Security Lead per `INCIDENT_RESPONSE.md` §2.
2. Confirm source diversity (different IPs / ASNs).
3. Review the transport path: how did the attacker obtain the
   signed request?
   - TLS MITM on customer side?
   - Paymaster ingress logging request bodies to a log
     aggregator?
   - Bundler leaking requests upstream?
4. Harden any identified leak + audit similar paths.

## 5. Escalation criteria

Escalate to Security Lead immediately if:

- ≥ 3 events across different agents within 1 hour (systemic,
  not per-client).
- Source IP diverges from the agent's normal ingress pattern.
- The original sponsorship HASN'T settled yet (replay could be
  trying to double-sponsor if the check somehow failed).
- Any event where the agent involved is enterprise-tier.

## 6. Post-incident

- [ ] Review ingress logging — signed sponsorship requests MUST
  NEVER be logged in plaintext to any log store.
- [ ] Verify the production `SettlementLedger` implementation
  has atomic `record` semantics (unique constraint on requestId
  at the database level). The in-memory version is safe; DB
  implementations need the constraint declared.
- [ ] If Hypothesis C: update THREAT_MODEL.md with the capture
  vector + mitigation.
- [ ] Consider adding client-side request-nonce that's not
  part of the deterministic requestId but prevents stale
  retries from reaching the server.

## 7. Sharp edges

- **Signed sponsorship requests are not secret AS LONG AS the
  ledger catches duplicates.** The defence is the uniqueness
  constraint, not the confidentiality of the request.
- **Deterministic request ids are a feature, not a bug.** They
  allow the ledger to catch replays without tracking a separate
  nonce. Don't "fix" the determinism by adding randomness —
  that removes replay detection.
- **Production ledger durability matters.** If the ledger loses
  state, replays slip through silently. The alert fires on
  DETECTED replays, which requires the ledger was durable
  enough to remember the first one. Test durability separately.
- **"Settled" vs "approved" matters for blast radius.**
  A reused `requestId` for a sponsorship that ALREADY settled
  has zero impact (the paymaster contract settled once; the
  second attempt can't settle again because the tx is already
  mined). A reused id for a pending approval is where the
  attacker could theoretically try to double-sponsor if the
  ledger check failed. The ledger check is the critical gate.
