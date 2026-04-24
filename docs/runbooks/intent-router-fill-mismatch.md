# P0: `router.fill.mismatch ≥ 1`

> **Alert class:** Zero-tolerance correctness event
> **Severity:** P0 (pages immediately, 24/7)
> **Class:** Solver integrity / settlement correctness
> **Packages affected:** `@aethelred/wallet-intent-router`
> **Last validated:** 2026-04-24

## 1. What this alert means

`verifyFillAgainstQuote` rejected a solver's reported `Fill`
because the `actualAmount` didn't satisfy the quote commitment
rule for that intent kind:

- **transfer:** `actualAmount === commitment` (strict equality)
- **swap:** `actualAmount >= commitment` (over-delivery OK)
- **payment:** `actualAmount <= commitment` (solver pays ≤ cap)

A mismatch means a solver either:

1. **Lied about the settlement.** Reported a fill that doesn't
   match what it claims to have executed.
2. **Partial fill + mis-reported.** Actually filled less than
   committed but reported the full commitment.
3. **Cross-wiring bug.** The solver's settlement path used the
   wrong quote for the wrong intent — a fill got attributed to
   the wrong one.

## 2. Impact

- The fill is **rejected** by the router. The intent's outcome
  becomes `settlement-failed` instead of `fulfilled`.
- Depending on the solver's settlement architecture, the agent
  may or may not have actually lost funds:
  - If the solver's settlement path produced an on-chain tx
    before the fill was reported — funds moved, and now the
    router is rejecting the evidence. Money is actually lost
    until reconciled with the solver.
  - If the solver produced the fill optimistically without
    on-chain settlement — no money moved; the rejection is
    purely reputational for the solver.

This is why the alert is P0: the correctness property protects
the router, but whether the agent is whole depends on the
solver's architecture.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the intent-router dashboard.
3. From the alert context pull: `intentId`, `solverId`,
   `intent.body.kind`, `quote.commitment`, `fill.actualAmount`,
   `fill.settlementRef`.

### 3.2 Minute 2–5: contain

**Blocklist the solver immediately** for new intent submissions:

```bash
ops:router solver-block --solver-id=<id> \
                        --reason="fill mismatch on intent <id>"
```

This prevents the solver from quoting further intents while we
investigate. Existing in-flight quotes from this solver are also
rejected.

For high-value intents: consider freezing the agent temporarily
(by revoking their `AgentBudget` session) until you've confirmed
their balance is correct post-incident.

### 3.3 Minute 5–15: triage

Pull the full incident context:

```bash
# Intent + quote + fill chain
dd logs query "service:intent-router intentId:<id>" --from=1h --format=json
```

For the incident intent you need:

- **Intent body:** kind, asset, amount/minBuyAmount/maxAmount
- **Quote selected:** commitment value, solver signature
- **Fill reported:** actualAmount, settlementRef, solver's
  claimed settlement tx hash (if on-chain)

Verify the settlement on-chain:

```bash
# For on-chain solvers — pull the actual tx
cast tx <settlementRef> --rpc-url $PRODUCTION_RPC | tee /tmp/fill-tx.json
cast receipt <settlementRef> --rpc-url $PRODUCTION_RPC
```

Cross-reference: does the on-chain tx actually move the amount
the solver CLAIMED it moved? This is the critical check.

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — solver under-delivered + lied.** Solver reported
commitment amount but actually moved less. On-chain tx confirms
the shortfall:

- For a swap intent: `actualAmount < minBuyAmount` means the
  agent got fewer tokens than they requested.
- For a payment intent: the commitment said "pay X USDC," but
  the solver actually paid less — merchant unhappy.

**Hypothesis B — solver filled correctly + mis-reported.**
On-chain tx shows the correct amount moved, but the fill record
says something different:

- Off-by-one in fill-reporting code, OR
- Solver's reporting path serialised the wrong number.
- Agent is whole (money moved correctly); the router just
  can't verify.

**Hypothesis C — cross-wired intents.** The reported
`settlementRef` corresponds to a settlement for a DIFFERENT
intent:

- Solver shipped intent A's settlement tx but reported it under
  intent B's fill. 
- The on-chain tx will have a payer/recipient pair that doesn't
  match either of the two intents involved.
- Two agents may BOTH be affected.

**Hypothesis D — solver never settled.** `settlementRef` is a
hash of nothing (null / zeroes / non-existent tx):

- Solver fabricated a fill without actually executing. Malicious
  or buggy solver.
- The funds never moved; the agent is whole but misled into
  thinking their intent was fulfilled.

## 4. Resolution paths

### Hypothesis A: solver under-delivered

1. Quantify the shortfall exactly (on-chain amount vs committed).
2. Coordinate with the solver via their incident channel (every
   registered solver must have one — see solver onboarding SLA).
3. Solver MUST make the agent whole — either by filling the
   remainder or refunding. Commercial recourse if they don't.
4. Keep the solver blocklisted until the resolution is on-chain.
5. Customer comms: explicit notification to the affected agent
   with the shortfall amount + resolution timeline.

### Hypothesis B: reporting bug, agent is whole

1. Confirm on-chain: agent's balance matches the expected
   post-settlement state.
2. Fix the solver's reporting path (or acknowledge a spec
   interpretation difference and document which is canonical).
3. Re-enable the solver after patch confirmation.
4. Mark the intent as `fulfilled` out-of-band if the router's
   ledger can be manually updated with the correct actualAmount
   (depends on your audit infrastructure).

### Hypothesis C: cross-wired

1. Identify the OTHER intent in the crossover. It will have
   matching pattern-reversed symptoms.
2. Both agents: confirm actual balances match what they
   intended, not what the solver reported.
3. Manual accounting reconciliation for both intents.
4. Solver: fix the settlement → fill correlation bug in their
   code path. This is usually a race condition between
   concurrent intents.

### Hypothesis D: fabricated fill

1. **The agent is whole.** No actual settlement happened; no
   funds moved.
2. Solver must be permanently removed from the registry.
3. Escalate to Security Lead — potentially a malicious solver
   attempting to claim fees for work it didn't do.
4. If the solver has customer-facing reputation via the
   `@aethelred/wallet-reputation` package: the lie should
   surface as a future `fraud-report` signal against the
   solver's agent identity.

## 5. Escalation criteria

Escalate to Security Lead immediately if:

- Hypothesis D confirmed — fabricated fill.
- ≥ 2 different solvers triggered within 1 hour (suggests
  shared-code-path vulnerability across solver implementations).
- The mismatch magnitude is large (e.g., reported 1000 USDC,
  actually 1 USDC — that's not a bug, that's adversarial).
- Any cross-wiring affects more than one agent's funds.

## 6. Post-incident

- [ ] Did `verifyFillAgainstQuote` coverage include this specific
  mismatch type? It has per-kind tests but per-hypothesis bugs
  may slip through.
- [ ] Solver onboarding: tighter SLA / incident-channel guarantees
  / penalty-per-mismatch.
- [ ] Consider requiring on-chain `settlementRef` for every fill
  — makes Hypothesis D impossible at the type level.
- [ ] Audit the solver's reported actualAmount against on-chain
  tx hash as a background job for every fulfilled intent
  (currently done only at fill-verification time).

## 7. Sharp edges

- **`verifyFillAgainstQuote` is the ONLY barrier** between
  solver-reported fills and the `fulfilled` outcome. Any code
  path that marks an intent fulfilled without calling it is a
  bug — audit that invariant holds across any future refactor.
- **For swap intents, `actualAmount >= commitment` means the
  agent can get MORE than they asked for.** This is intentional
  (over-delivery is fine). Don't "fix" a swap mismatch as
  rejection if the solver actually over-delivered — check the
  direction.
- **On-chain verification requires the right RPC.** If the
  settlement happened on a chain your ops tooling isn't
  configured for, you may need to add the RPC provisionally.
  Runbook doesn't pin specific chains because solvers may
  settle cross-chain.
