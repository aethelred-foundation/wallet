# P0: `router.nonce.replay.detected ≥ 1`

> **Alert class:** Zero-tolerance correctness event
> **Severity:** P0 (pages immediately, 24/7)
> **Class:** Replay resistance / state integrity
> **Packages affected:** `@aethelred/wallet-intent-router`
> **Last validated:** 2026-04-24

## 1. What this alert means

The intent-router's `NonceStore.claim()` rejected an intent
submission because the `(creator, nonce, chainId)` triple had
already been consumed. The router returned
`intent-nonce-reused` to the caller and did not execute the
intent.

Under healthy conditions this counter stays at 0. A client should
generate a fresh nonce (32 random bytes) per intent. Any firing
means:

1. **Client bug.** The caller is reusing nonces across intents —
   usually a counter that didn't advance, or a cached intent that
   got resubmitted after a network retry.
2. **Malicious replay.** Someone intercepted a signed intent and
   is trying to replay it. The nonce store is the defence-in-depth
   gate; it should always catch this.
3. **NonceStore storage corruption.** The store somehow LOST the
   record of an earlier nonce claim and is now treating a legit
   re-use as a new attempt — but that's actually the opposite
   failure mode (missed-catch, not false-positive). This alert
   fires on DETECTED replay, so Hypothesis 3 does not apply here.

## 2. Impact

- The replayed intent is **rejected** — the router throws
  `intent-nonce-reused` before quoting or settling. No duplicate
  payment lands.
- However, the fact that a signed intent appeared twice means
  either the client has a logic bug OR an attacker holds a valid
  signed intent and is probing for replay opportunities.
- Revenue impact is ZERO for the rejected call. The signal value
  is in understanding WHY a valid-signed intent was submitted twice.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the intent-router dashboard.
3. From the alert context pull: `intentId`, `creator`,
   `nonce`, `chainId`, `submittedAt`, `ingressIp` (if available).

### 3.2 Minute 2–5: contain

Contained by construction — the store already rejected the replay.
Containment here is **forensic preservation**, not symptom relief.

- Tag all alert events for extended retention (18mo → 7yr cold
  storage).
- If there's an observable burst (> 3 events in 1 min from the
  same `creator`), apply a temporary ingress rate-limit at the
  router's gateway for that creator address.

### 3.3 Minute 5–15: triage

Pull the originating intent's history:

```bash
# When was this nonce first claimed? Fetch the initial success.
dd logs query "service:intent-router event:intent-submitted \
   creator:<creator> nonce:<nonce>" --from=30d --format=json
```

You should see exactly ONE earlier success at the
`(creator, nonce, chainId)` key. Compare:

- **Timestamps:** how far apart?
- **`intentId` hashes:** are they the same (same intent replayed)
  or different (signature over different body with same nonce)?
- **Source IPs:** same client, different client, TOR exit node?
- **User-Agent or client build:** identical or diverged?

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — client nonce-generation bug.** If both events
come from the same client + same `intentId`:

- The client retried an already-submitted intent without
  generating a new nonce. Usually a network timeout handled
  badly.
- Check the client's version in `userAgent` — is it an old
  build with a known bug? Roll customers to the latest.
- Response: not a security incident; a usability bug with
  cosmetic impact (customer saw an error).

**Hypothesis B — malicious replay (pure).** If both events come
from DIFFERENT sources + SAME `intentId`:

- An attacker captured a signed intent in transit and is
  trying to replay it. The router caught it; no loss.
- Protocol worked as designed. Log + preserve + move on.
- Secondary consideration: HOW did the attacker capture the
  signed intent? That's the interesting question:
  - Customer's TLS MITM'd?
  - Router's TLS terminator is leaking?
  - Signed intent was logged somewhere it shouldn't have been?

**Hypothesis C — replay with modified body.** If events have
same `(creator, nonce, chainId)` but DIFFERENT `intentId` hashes:

- Someone is attempting to forge an intent using the captured
  nonce. The cryptographic binding prevents this from producing
  a valid signature, but the attempt reveals adversarial intent.
- Check if ANY of the failed intents have valid signatures:
  ```bash
  dd logs query "service:intent-router event:signature-verify-failed" \
     --from=1h --format=json
  ```
- If a nonce-reuse event has a VALID signature for a DIFFERENT
  body — that's impossible under EIP-712. Signature-bug
  investigation opens up.

## 4. Resolution paths

### Hypothesis A: client nonce-generation bug

1. Identify the client build from `userAgent`.
2. Patch the client's retry path to always generate a fresh
   nonce on re-submit.
3. Roll the customer to the fixed build (Chrome Web Store
   update path).
4. Property-test the retry flow in the client's test suite.

### Hypothesis B: transport-layer capture

1. Confirm source diversity (different IPs for the two events).
2. Identify the transport path between customer and router that
   could expose the signed intent:
   - Is the customer on a corporate proxy?
   - Is the router behind a CDN that logs request bodies?
   - Is there any log aggregator in the path that ingests full
     POST bodies?
3. Review logging config across the ingress path; ensure signed
   intents are NEVER written to application logs.
4. Escalate to Security Lead if the capture source is unclear —
   it may indicate compromise of an intermediary service.

### Hypothesis C: modified-body replay

1. Confirm the different intentIds have different signatures too
   (by EIP-712 construction, same nonce + different body = new
   intent and thus a new id).
2. If signatures are valid for both: **this is impossible under
   the current signing scheme.** Escalate immediately — the
   cryptographic primitives have broken.
3. If one signature is invalid: that's an attacker forgery
   attempt; the router correctly rejected it (signature-verify
   happens before nonce-claim). The nonce-replay-detected event
   fired for the OTHER one that was valid.

## 5. Escalation criteria

Escalate to Security Lead immediately if:

- ≥ 3 events across different `creator` addresses within 1 hour
  (systemic, not client-bug).
- Hypothesis C applies — modified body with a valid signature
  using the same nonce.
- Source IP traces to known adversary infrastructure.
- Any event where the nonce was supposedly single-use at the
  client (e.g., hardware wallet) but two submissions appeared.

## 6. Post-incident

- [ ] If Hypothesis B: review the entire request-path logging
  configuration for accidental signed-intent persistence.
- [ ] If Hypothesis A: publish a client-side fix + roll the
  fix to customers within the SLA window.
- [ ] Validate the `InMemoryNonceStore` production equivalent
  is durable + atomic under concurrency (CI tests the in-memory
  version; production variant may use Redis SETNX or a DB
  unique constraint).
- [ ] Audit the intent-router's NonceStore interface for any
  code path that doesn't go through `claim()`.

## 7. Sharp edges

- **The check is the protection.** You don't need to "fix" the
  replay — it's already rejected. The work is understanding
  WHY it happened.
- **Signed intents are not secret.** Anyone with a signed intent
  can re-submit it; that's why the nonce check exists. Don't
  treat the signed payload itself as sensitive, only the key
  that signed it.
- **NonceStore durability is critical.** If your production
  NonceStore loses state (restart without persistence, cache
  eviction, shard failure), replays will succeed silently. The
  `claim()` contract MUST be atomic + durable or the entire
  replay-defence model collapses. This isn't what the alert is
  firing about (the alert catches detected replays, not missed
  ones), but it's a related correctness property worth verifying
  quarterly.
