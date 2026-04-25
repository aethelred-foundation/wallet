# P2: `x402.solver.facilitator.error ≥ N`

> **Alert class:** Operational fault for HTTP-based payment surface.
> ONE specific path inside (`receipt-amount-exceeds-commitment`)
> is a correctness violation and triggers P0 escalation.
> **Severity:** P2 baseline (paginate during business hours);
> P1 if rate > 2% of fulfilled payments in 5 min;
> **P0 immediate** if any single `receipt-amount-exceeds-commitment`.
> **Class:** HTTP / x402 facilitator integration
> **Packages affected:** `@aethelred/wallet-x402-solver`,
> `@aethelred/wallet-x402` (the underlying `x402Fetch` client),
> the configured facilitator endpoint
> **Last validated:** 2026-04-25

## 1. What this alert means

A payment intent reached `X402FacilitatorSolver.settle()`, the
solver invoked `x402Fetch(resource, { signer, attestation,
audit, fetch })`, and the call surfaced an
`X402SolverError`. The intent-router translates the throw into
`outcome.kind === "settlement-failed"` with `error: "<error-code>"`.

Unlike the on-chain solver runbooks (PRs #85 / #86 covering
swap and transfer reverts), x402 failures are **HTTP-shaped**:

- DNS / TLS errors
- HTTP 5xx from the facilitator
- HTTP 2xx without a receipt (resource didn't need payment, OR
  facilitator misbehaving)
- Facilitator overcharging (the one correctness violation in the
  family — see Hypothesis E)
- Authorization rejection by the facilitator (signature, balance,
  blacklist on the facilitator's side)

The error codes the alert can fire on (from
`packages/x402-solver/src/errors.ts`):

| Code | Severity | Class |
|---|---|---|
| `facilitator-http-error` | P2 → P1 if sustained | HTTP transport / 5xx |
| `missing-receipt` | P2 | 2xx but no `X-PAYMENT-RESPONSE` header |
| **`receipt-amount-exceeds-commitment`** | **P0 immediate** | **Correctness violation — facilitator overcharged** |
| `payment-authorization-rejected` | P2 → P1 if cluster | Reserved (richer facilitator handshake) |
| `no-matching-requirement` | P2 | Reserved (preflight mode) |
| `signer-mismatch` | P0 (config bug) | Operator config didn't match agent identity |
| `unsupported-intent-kind` | P0 (config bug) | Should never reach this solver — router dispatches by kind |
| `solver-disposed` | P0 (lifecycle bug) | Solver was used after `dispose()` |

The first three are the operationally interesting ones; the
others surface code/config bugs that should never appear in
steady-state production.

## 2. Impact

- **The specific payment did not settle.** Same shape as the
  other two solver runbooks — the intent-router returns
  `settlement-failed`; agent retries or surfaces error.
- **No on-chain effect for HTTP-only failures.** Unlike chain
  reverts, a `facilitator-http-error` or `missing-receipt`
  means NO on-chain state change occurred (the facilitator
  failed before signing the on-chain settlement). Gas was NOT
  spent by the agent — the facilitator pays gas in the x402
  model.
- **Possible on-chain settlement on `receipt-amount-exceeds-commitment`.**
  The facilitator's receipt claims a settlement happened;
  whether it actually did is determined by checking the
  receipt's `txHash`. **The user may have lost funds.**
- **Audit trail intact.** Same five-event chain as other
  solvers, terminating at `settlement-failed`. The thrown error
  includes details for triage — for HTTP errors, the response
  status; for missing-receipt, the response status; for
  amount-exceeds, both the receipt's claimed amount and the
  intent's commitment.
- **Histogram irrelevant.** x402 fills don't appear in
  `SolverGasHistogram` even when fulfilled (gas paid by
  facilitator). Failed x402 settles don't either.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. **Check the error code first** — runbook flow diverges:
   - `receipt-amount-exceeds-commitment` → **STOP. P0 path.
     Skip to Hypothesis E.**
   - All others → continue with the standard flow below.
3. Open this runbook + the x402 facilitator dashboard.
4. Pull from the alert context:
   - `solver_id` (which `X402FacilitatorSolver` instance)
   - `error_code` (one of the codes above)
   - `intent_id`, `creator`, `chain_id`, `asset`, `maxAmount`,
     `merchant`, `resource`
   - For HTTP errors: `details.status` (the HTTP status code)
   - For missing-receipt: `details.status` (typically 200)
   - For amount-exceeds: `details.amountPaid` and
     `details.commitment`

### 3.2 Minute 2–5: classify

```promql
# Rate of x402-solver errors in last 5m, by error code
rate(intent_router_settlement_failed_total{
  solver_kind="payment",
  error=~"facilitator-http-error|missing-receipt|payment-.*"
}[5m]) * 60
```

Decision tree:

- **> 2% of fulfilled payments / 5 min, single error code clusters
  on one facilitator** → P1: facilitator-wide outage. Continue
  with Hypothesis A or B.
- **Any single `receipt-amount-exceeds-commitment`** → P0:
  correctness violation. Skip to Hypothesis E.
- **`signer-mismatch` or `unsupported-intent-kind`** → P0
  config-bug. Operator config doesn't match runtime state;
  skip to Hypothesis F.
- **Single-event blip on transport** → P2 standard flow.

### 3.3 Minute 5–15: triage

For HTTP-shaped errors, inspect the failing request:

```bash
# x402's two-call flow: 1st returns 402 with requirement,
# 2nd carries the signed authorization and returns 200 + receipt.
# Unfortunately we don't have a tx hash to grep — the audit log
# carries the resource URL + timestamp; replay manually:

curl -i -H "User-Agent: aethelred-wallet/triage" "$RESOURCE_URL"
# Expect: 402 with `accepts: [PaymentRequirement]` body
```

The facilitator's response shape:

| Status | Meaning |
|---|---|
| 402 + `accepts` body | Normal — first call. The agent then signs auth + retries with `Authorization: x402 ...`. |
| 5xx | Facilitator outage / bug |
| 2xx with `X-PAYMENT-RESPONSE` header | Normal — second call success |
| 2xx without `X-PAYMENT-RESPONSE` | Resource didn't actually require payment, OR facilitator misconfigured (Hypothesis D) |
| 4xx (other than 402) | Facilitator rejected our authorization (Hypothesis C) |

For amount-exceeds, decode the receipt:

```bash
# The error's details include the receipt blob. Extract:
# details.amountPaid, details.commitment, details.txHash (if
# the facilitator claims settlement happened).
```

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — facilitator HTTP outage.**

Error code is `facilitator-http-error` AND HTTP status is 5xx
(or DNS / TLS error masking under the same code).

- **How to confirm:** repeated curl against the resource URL
  returns 5xx; the facilitator's status page shows degraded
  service.
- **Resolution:** if the operator has a fallback facilitator
  configured, switch to it (operator-side config swap, not a
  code change). Otherwise wait for upstream recovery; pause
  payment intent submission for the affected resource via the
  operator's flow control.

**Hypothesis B — facilitator stale / wrong network.**

Error code is `facilitator-http-error` (4xx) OR
`no-matching-requirement` AND the facilitator's
`PaymentRequirement` carries a `network` or `scheme` the agent
can't satisfy.

- **How to confirm:** inspect the 402's `accepts` array. Does it
  include the agent's chain (`base-mainnet` / `polygon-mainnet`
  / etc.)? Does the scheme match what the agent supports?
- **Resolution:** facilitator misconfiguration on the
  receiver's side, OR the agent's `supportedNetworks` config is
  too narrow. Coordinate with the receiver (it's their
  facilitator); if the agent's config is the problem, expand
  `supportedNetworks` in the `X402FacilitatorSolver` config.

**Hypothesis C — facilitator rejected the authorization.**

Error code is `facilitator-http-error` with HTTP 4xx (most
commonly 402 returned a SECOND time, indicating the auth was
rejected).

- **How to confirm:** the facilitator's response body should
  include a rejection reason. Common values:
  - `auth-signature-invalid` — signature recovery doesn't
    match the agent's address. **Likely a custody bug or
    EIP-712 domain mismatch.**
  - `auth-expired` — `authValidUntil` was past block time.
    Either clock skew or the signature was reused.
  - `insufficient-balance` — the agent's on-chain balance is
    below `maxAmountRequired`. Same as Hypothesis A in PR #86
    but caught by the facilitator instead of by the chain.
  - `blacklisted` — facilitator's compliance check rejected
    the agent.
- **Resolution:** depends on the rejection reason. Signature
  bugs are P0 custody escalations; expired auths point at clock
  skew or replay; blacklist is a P0 compliance event.

**Hypothesis D — 2xx without receipt (`missing-receipt`).**

The facilitator returned 200 OK with no `X-PAYMENT-RESPONSE`
header.

- **Two sub-cases:**
  1. **Resource didn't actually require payment.** The 402
     handshake didn't happen (the agent's first call returned
     200 directly). The agent paid for nothing — but also
     received the resource. This is wasted x402 overhead, not
     a security issue.
  2. **Facilitator misconfigured.** The facilitator returned
     200 + body but forgot to attach the receipt header. The
     agent paid (or the facilitator claims it did) but has no
     receipt to anchor against.
- **How to distinguish:** check whether the facilitator
  signed an on-chain settlement. If yes, sub-case 2 (lost
  receipt — escalate to facilitator vendor). If no, sub-case 1
  (agent overpaid for free content).
- **Resolution:** sub-case 1 is fixable by inspecting the
  resource's true 402 behaviour and not invoking the x402
  solver for ungated resources. Sub-case 2 is the facilitator's
  bug; escalate.

**Hypothesis E — `receipt-amount-exceeds-commitment` (P0).**

**This is the only correctness violation in the operational
runbook family.** The facilitator's receipt claims a settled
amount LARGER than the intent's `quote.commitment` (which was
the intent's `maxAmount`).

- **What this means:** the facilitator either has a bug, OR
  it's adversarial — settling more than authorized. The agent
  may have lost funds.
- **First hour:**
  1. **PAGE Security Lead immediately.**
  2. Pause all payment-intent submissions for the affected
     facilitator.
  3. Verify the on-chain settlement: was the claimed `txHash`
     actually mined? Did it transfer `details.amountPaid` from
     the agent's address?
  4. Cross-check the agent's balance: is it below
     `quote.commitment` post-incident? If yes, the
     settlement was real and the user lost funds.
- **Resolution:**
  - If real overcharge: incident response, customer
    notification, regulator notification per jurisdiction
    (SOC-2 + applicable financial regulation). Switch
    facilitator immediately.
  - If facilitator bug (no actual overcharge — receipt was
    wrong but settlement was correct): file with vendor;
    audit-trail integrity intact; less severe but still P0.

**Hypothesis F — config bug surface.**

Error code is `signer-mismatch` or `unsupported-intent-kind`
or `solver-disposed`. These shouldn't occur in steady-state
production:

- `signer-mismatch`: operator wired the
  `X402FacilitatorSolver` with a `signer` whose address
  doesn't match the agents whose intents are routed through
  it. Code-side guard at quote() ALSO rejects mismatched
  intents, so this firing means a deploy-time misconfiguration.
  - **Resolution:** fix the operator config; redeploy.
- `unsupported-intent-kind`: the router dispatched a
  non-payment intent to the x402 solver. This shouldn't
  happen (registry's `listFor("payment")` only returns
  payment-supporting solvers). If it does, the registry is
  broken.
  - **Resolution:** audit the registry config; redeploy.
- `solver-disposed`: solver was used after `dispose()`. Hot-
  swap raced.
  - **Resolution:** lifecycle bug in the operator's solver
    management. Fix the swap logic to wait for in-flight calls.

## 4. Resolution paths

### Hypothesis A: facilitator outage

1. Switch to fallback facilitator if configured.
2. Pause payment intent submission for the resource until
   recovery.
3. Customer-facing: status page entry.

### Hypothesis B: facilitator/agent network mismatch

1. Coordinate with the resource's facilitator owner —
   typically a receiver-side config bug.
2. If agent-side: expand `supportedNetworks` in the
   `X402FacilitatorSolver` config.

### Hypothesis C: authorization rejection

1. Check the rejection reason in the facilitator's response.
2. **`auth-signature-invalid`**: P0 escalate to custody. EIP-712
   domain mismatch or recovery bug.
3. **`auth-expired`**: clock skew investigation; if recurrent,
   shorten the agent's `authValidUntil` buffer.
4. **`insufficient-balance`**: same fix as PR #86 Hypothesis A
   — pre-flight balance at intent creation.
5. **`blacklisted`**: P0 compliance escalation.

### Hypothesis D: missing receipt

1. **Sub-case 1** (resource doesn't gate): fix the agent's
   intent generator so it doesn't invoke x402 for ungated
   resources. Optional: add a HEAD request preflight in the
   agent's intent generator (NOT in the solver — solver-side
   preflight scales badly per the README).
2. **Sub-case 2** (facilitator missed the header): escalate to
   facilitator vendor; consider switching providers.

### Hypothesis E: amount exceeds commitment (P0)

1. **Page Security Lead.**
2. Pause all payments for the affected facilitator.
3. Forensic on-chain check.
4. Customer notification + regulator notification.
5. Vendor escalation; potentially black-list the facilitator
   from the operator's allowed-facilitators set.

### Hypothesis F: config bugs

1. Fix the operator config; redeploy.
2. Add a property test that the configured `signer.address`
   matches the agents whose intents flow through the solver
   (deploy-time check).

## 5. Escalation criteria

Escalate to **L2 on-call** (P1) if:

- HTTP error rate > 2% of fulfilled payments in 5 minutes.
- `payment-authorization-rejected` clusters across multiple
  agents (compliance event affecting the operator-wide agent
  pool).
- `missing-receipt` sub-case 2 (facilitator misbehaviour) for
  > 1 facilitator simultaneously.

Escalate to **Security Lead** (P0) if:

- Any single `receipt-amount-exceeds-commitment` (Hypothesis E).
- `auth-signature-invalid` rejection (Hypothesis C) — possible
  EIP-712 domain mismatch or signature-recovery bug.
- `signer-mismatch` AND the configured `signer` is from a
  different agent's custody backend (config supply-chain
  poisoning).
- Facilitator returns receipts that don't decode cleanly per
  the x402 spec — possible vendor compromise or our parser
  divergence.

Escalate to **Compliance Lead** (P0) if:

- Authorization rejection reason is `blacklisted`. Same path
  as PR #86 Hypothesis C — the agent's identity may be frozen
  for the asset; rotate control address.

## 6. Post-incident

- [ ] If Hypothesis A: was the operator running a single
  facilitator? Should there be a fallback configured? Diversity
  is the right hedge but adds operational complexity.
- [ ] If Hypothesis B: how did the misconfiguration land? Was
  the operator config reviewed for `network` / `scheme`
  compatibility before deploy?
- [ ] If Hypothesis C/Compliance: agent control-address rotation
  process. How long does it take? Document.
- [ ] If Hypothesis D sub-case 2: facilitator SLA review. How
  many missed-receipt incidents before we switch?
- [ ] If Hypothesis E: full incident response including:
  - Customer-facing transparent disclosure
  - Regulator notification per applicable jurisdiction
  - SOC-2 evidence package (control failure)
  - Facilitator vendor blacklist entry
  - Forensic blockchain trace of all settlements during the
    affected window
- [ ] If Hypothesis F: deploy-time validation. Property test
  that asserts every `X402FacilitatorSolver` in the registry
  has a `signer.address` matching at least one agent in the
  operator's identity pool.
- [ ] Cross-runbook learning: should the swap-revert (PR #85)
  and transfer-revert (PR #86) runbooks gain
  `receipt-amount-exceeds-commitment`-equivalent paths? Swap
  has `fill-below-commitment` (already a security path);
  transfer has `=== commitment` so the equivalent doesn't
  exist for it. x402 is structurally most exposed to
  facilitator misbehaviour because the facilitator carries the
  commitment.

## 7. Sharp edges

- **x402 receipts are NOT on-chain receipts.** A
  `PaymentReceipt` from the facilitator includes a `txHash`,
  but that hash is the facilitator's claim about an on-chain
  settlement — not a receipt the moat fetched directly. Always
  verify the txHash on canonical chain state during incident
  response. The facilitator could, in principle, return a
  txHash that doesn't exist (the receipt-as-proof concern is
  why anchoring + notarization exist).

- **Receipt amount exceeding commitment is the ONLY
  correctness path.** All other operational runbooks (PRs #85,
  #86) have ZERO correctness-violation paths in their
  hypothesis trees. x402 has one because the facilitator is
  trusted to honor the commitment cap on the agent's behalf.
  This trust boundary is a design choice — alternatives
  (agent verifies the receipt amount before signing) add
  round-trips that defeat the x402 latency win. Document this
  trade-off explicitly when discussing vendor selection.

- **Solver-level retries are NOT done.** The
  `X402FacilitatorSolver` does NOT retry HTTP failures. A
  single 5xx surfaces as a `settlement-failed` outcome.
  Retries belong at the intent-router or the agent's
  retry-loop layer — adding them at solver level would hide
  signal from the router's observability (per the
  x402-solver README's "What this package DOES NOT do"
  section). Don't propose adding retries here.

- **The agent doesn't pay gas in the x402 model.** Unlike
  transfer-solver and swap-solver, where the agent's address
  funds the gas, x402 facilitators pay gas as part of their
  service. Wasted-gas accounting for x402 failures is
  facilitator-side, not agent-side. Operator dashboards
  comparing per-solver "gas wasted on failure" should NOT
  include x402 — and the operator-trio demo's CLI rendering
  ("facilitator pays") already reflects this correctly.

- **`x402Fetch`'s two-call handshake is observable as TWO
  HTTP requests in the audit stream.** When debugging,
  remember the first call returns 402 (intentionally — that's
  the protocol) and the second carries the auth. A 402 in
  isolation is NOT an error; it's the start of the handshake.
  The audit pipeline should capture both calls so triage can
  see whether the second arrived.

- **Facilitator URL changes are config supply-chain risks.**
  A malicious PR or compromised deployer could swap the
  facilitator URL to an attacker's endpoint. Treat
  `X402FacilitatorSolverConfig.fetch` as a security-sensitive
  parameter; its source should pass through code review +
  deployment audit. Same hardening applies as PR #86's
  Hypothesis H (asset config supply-chain).

- **Reputation-comparator can route around bad facilitators**
  if the operator configures multiple `X402FacilitatorSolver`
  instances for the same intent kind, each pointing at a
  different facilitator. Failure-rate accumulation on one
  solver naturally de-prioritises it. This is the recommended
  redundancy strategy — avoid the temptation to retry inside a
  single solver.
