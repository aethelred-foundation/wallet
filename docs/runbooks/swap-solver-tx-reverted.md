# P2: `swap.solver.tx.reverted ≥ N`

> **Alert class:** Operational fault, not a correctness event
> **Severity:** P2 (paginate during business hours; P1 if rate
> > 5% of fulfilled swaps in a 5-min window)
> **Class:** On-chain solver / DEX integration
> **Packages affected:** `@aethelred/wallet-swap-solver`,
> `@aethelred/wallet-rpc-adapters`, downstream `SwapVenue`
> adapter (e.g. `@aethelred/wallet-swap-venue-uniswap-v3`)
> **Last validated:** 2026-04-25

## 1. What this alert means

A swap intent reached `SwapSolver.settle()`, the configured
`SwapVenue.buildSwapTxs()` produced a tx sequence (typically
`approve → swap`), the chain provider submitted them, and one
of the receipts came back with `status: "reverted"`.

The solver throws `SwapSolverError({ code: "chain-tx-reverted" })`
which the intent-router translates into
`outcome.kind === "settlement-failed"` with
`error: "chain-tx-reverted"`.

Unlike the seven zero-tolerance P0 runbooks, **a swap revert is an
expected operational event**, not a correctness violation. The
moat's two-layer defence is designed to keep reverts safe.

**For exact-input intents** (default direction):

1. **Off-chain commitment floor** — solver commits to
   `expectedBuyAmount * (10_000 - internalSlippageBps) / 10_000`.
2. **On-chain `amountOutMinimum`** — the same value is embedded
   in the swap tx so adverse price movement reverts BEFORE any
   value moves.

**For exact-output intents** (PR #118+, `direction: "exact-output"`):

1. **Off-chain commitment ceiling** — solver commits to
   `expectedSellAmount * (10_000 + internalSlippageBpsExactOutput) / 10_000`
   (per-direction override from PR #122; falls back to
   `internalSlippageBps`).
2. **On-chain `amountInMaximum`** — the same value is embedded
   in the swap tx so adverse price movement reverts BEFORE any
   value moves. The user is protected from spending more than
   their ceiling for the requested exact output.

A revert is therefore a *warning that the upper layer is firing
correctly*, not a sign the moat broke. The runbook focuses on
distinguishing the expected failure modes from the genuinely
unexpected ones, with separate triage paths per direction (§3.3).

## 2. Impact

- **The specific swap did not settle.** The intent-router
  returns `settlement-failed`; the agent sees the error, the
  user can retry with a fresh quote (recommended) or accept
  defeat.
- **No partial value movement.** The `amountOutMinimum`
  guardrail means the swap tx reverted on-chain; gas was spent
  but no token movement occurred. **Approve txs (if any) DID
  succeed** — those don't have an output minimum, so the agent's
  router approval may persist. Document this for ops; it's not
  a bug, it's the cost of the conservative two-layer model.
- **Audit trail intact.** The `intent-submitted`,
  `quotes-solicited`, `quote-received`, `quote-chosen`, and
  `settlement-failed` events all fire. The `Fill.metadata.receipts`
  array is NOT populated (no successful settlement), but the
  thrown error includes the failed tx hash in `details`.
- **Histogram impact.** The fill never lands in
  `SolverGasHistogram` (no `gasUsed` extracted from a fulfilled
  outcome). Grafana panels showing per-solver p95 won't see this
  failure — that's by design; gas distributions are over
  successful intents only.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the swap-solver dashboard.
3. Pull from the alert context:
   - `solver_id` (which `SwapSolver` instance)
   - `tx_hash` of the reverted tx (from `details.transactionHash`)
   - `tx_label` (`approve` vs `swap` — different diagnostic paths)
   - `intent_id` (for joining to audit + reputation streams)

### 3.2 Minute 2–5: classify

The runbook's first decision: **is this a single-event blip or
a sustained anomaly?**

```bash
# Count reverts per solver in the last hour
solver_gas_count{solver_id="swap:..."} -
  ignoring(...) solver_gas_count{solver_id="swap:..."}[1h ago]
```

If the rate is > 5% of fulfilled swaps OR > 10 reverts in 5
minutes, **escalate to P1**. Most likely venue-side problem
(see Hypothesis C). Continue this runbook for diagnosis.

For a single-event revert, continue at P2 cadence — the moat's
guardrails fired correctly and there's nothing to "fix"; the
diagnosis is about *why the price moved that much*, which is
ecosystem context, not a code bug.

### 3.3 Minute 5–15: triage

Inspect the reverted transaction:

```bash
cast tx <tx-hash> --rpc-url $PRODUCTION_RPC | tee /tmp/reverted-tx.json
cast receipt <tx-hash> --rpc-url $PRODUCTION_RPC | tee /tmp/reverted-receipt.json
```

Decode the revert reason:

```bash
# Most v3-shaped routers use a custom error or string revert
cast --to-string $(cast call <router> <calldata> --block <block>) || \
  echo "revert opcode used (no reason data)"
```

Common revert reasons:

| Reason | Likely cause |
|---|---|
| `Too little received` (or `STF`) | `amountOutMinimum` tripped — price moved adversely between quote and settle (exact-input direction). **EXPECTED behaviour**. |
| `Too much requested` / `IIA` | `amountInMaximum` tripped — exact-output direction (PR #118+) where the on-chain swap would have required more input than the agent authorized. **EXPECTED behaviour** for exact-output intents under price drift. |
| `EXPIRED` (deadline) | The intent's deadline fell behind block.timestamp. Solver's deadline plumbing may be slow. |
| `STF` (`SafeTransferFrom` failed) | The agent's allowance was revoked/insufficient. Approve flow problem. |
| Custom error matching the venue's error selectors | Venue-specific — refer to that adapter's docs. |
| No revert data | Possibly out-of-gas. Check `gasUsed == gasLimit`. |

**Identify the swap direction first.** From the audit-trail
metadata for the affected intent:

```bash
# direction is in Fill.metadata.solverClass-specific fields
dd logs query "service:swap-solver intentId:<id> direction:*" --from=1h \
  | jq '[.[].body.direction] | unique'
```

Returns `["exact-input"]` (default), `["exact-output"]` (PR #118),
or `[null, "exact-input"]` (mix during a rolling deploy). The
hypothesis space differs by direction:

- **Exact-input revert** → `amountOutMinimum` triggered. The
  output side moved adversely (less buy than committed).
- **Exact-output revert** → `amountInMaximum` triggered. The
  input side moved adversely (more sell required than authorized).
  The semantic flips: a sell-side spike that's RECOVERABLE at the
  user level (they got the EXACT buy they asked for; just paid
  more than expected) is the user's pain. An exact-output revert
  is a user-side cap protecting them from overpaying.

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — adversarial price movement (most common).**
If the revert is `Too little received` AND the intent's
`internalSlippageBps` matches the operator-configured value:

- The swap-solver's first-line defence fired correctly.
- Look at the venue quote at the time of submission vs the
  on-chain price at the revert block. If `quote.expectedBuyAmount
  ≈ on-chain mid-price` at the revert block, the slippage was
  legitimate market movement.
- **Resolution:** none required. The agent retries with a fresh
  quote at the new price, OR the operator widens
  `internalSlippageBps` if the venue's volatility profile
  doesn't tolerate 50 bps.

**Hypothesis B — stale venue oracle.**
If the venue's `quote()` returns a price that consistently
disagrees with the on-chain pool state at submission time:

- The venue's data source is stale (RPC lag, indexer fallback,
  cached pool state).
- Check the venue adapter's pool-state fetch: it should read the
  current block, not a cached value.
- **Resolution:** refresh venue's quote logic to read latest
  block. May need new patch on the venue adapter package
  (e.g. `@aethelred/wallet-swap-venue-uniswap-v3`).

**Hypothesis C — venue-wide outage / liquidity gap.**
If reverts are clustered (>5% of fulfilled swaps in 5 min) for
ONE venue but not others:

- The venue's pool may have been drained, paused, or hit an
  edge case (concentrated liquidity tick boundary, oracle pause).
- **Resolution:** disable the failing venue in the operator's
  `SolverRegistry` until it recovers. Other venues continue
  serving traffic. Reputation-router's `comparator` already
  picks the next-best quote when one solver consistently fails.

**Hypothesis D — agent allowance bug.**
If the revert is `STF` (`SafeTransferFrom` failed):

- The agent didn't approve enough OR the approval was revoked
  between approve and swap.
- Check the agent's approval transactions on the asset:
  ```bash
  cast call <asset> "allowance(address,address)" \
    <agent> <router> --rpc-url $PRODUCTION_RPC
  ```
- **Resolution:** the venue adapter should re-emit the approve
  step. If it does and STILL reverts, custody backend
  (Nitro/Ledger) is rejecting the approval — escalate to custody.

**Hypothesis E — deadline plumbing.**
If the revert is `EXPIRED`:

- The intent's `deadlineMs` was passed during settlement.
- Check `intent.envelope.deadline - settle_started_at`. Less than
  the venue's `deadline` field gives no headroom for confirmation.
- **Resolution:** either (a) clients submit intents with longer
  deadlines, or (b) solver's `deadlineMs - bufferMs` calculation
  is off. Audit the venue adapter's `buildSwapTxs` deadline
  derivation.

**Hypothesis F — out-of-gas misclassified as revert.**
If `gasUsed == gasLimit` AND no revert reason:

- The solver / venue gas estimate is stale.
- Check `swap_solver_gas_used{solver_id="..."}` p99 against the
  venue's static `gasLimit` setting.
- **Resolution:** bump the gas-limit floor in the venue adapter
  configuration. This is a config bump, not a code change, but
  document it in the venue adapter's README.

## 4. Resolution paths

### Hypothesis A: adversarial price movement (the EXPECTED case)

1. No code change. The two-layer defence worked.
2. Add the swap to the post-incident dataset for "venues
   exhibiting > 50bps swings during retail hours" if the pattern
   is recurrent — may inform a future config bump
   (`internalSlippageBps` for exact-input, or
   `internalSlippageBpsExactOutput` per-direction override from
   PR #122 if exact-output reverts dominate).
3. The agent's UI should already show "swap reverted, please
   retry"; if it doesn't, fix the UI mapping for
   `outcome.kind === "settlement-failed"` + `error: "chain-tx-reverted"`.
4. **Direction-specific guidance for exact-output reverts**
   (PR #118+): the user got NO tokens (the swap reverted)
   despite their ceiling being well above the spot price. UI
   should distinguish "exact-output failed at price ceiling"
   from "exact-input failed at output floor" — different
   retry guidance:
   - Exact-input retry: same intent works at the new spot.
   - Exact-output retry: user should bump `maxSellAmount`
     OR accept a smaller `buyAmount`. The retry-with-same-shape
     would have a high probability of failing again at the same
     ceiling.

### Hypothesis B: stale venue oracle

1. File issue against the venue adapter package.
2. Patch + ship + bump the venue adapter dependency in
   `@aethelred/wallet-integration` (or wherever the venue is
   wired in production).
3. Confirm the fix with a property test asserting "venue.quote
   == on-chain mid-price within X bps."

### Hypothesis C: venue-wide outage

1. **Immediately** — operator opens the registry config and
   removes the failing venue. Router's comparator routes around
   automatically; other venues keep serving.
2. Monitor the venue's recovery via the alert-source dashboard
   (number of fulfilled swaps per minute climbing back).
3. Re-enable when the rate stabilises. Defer until business
   hours unless the operator's traffic profile requires
   immediate restoration.

### Hypothesis D: allowance bug

1. Verify the venue adapter is emitting the approve step.
2. If yes — check custody backend logs. Nitro / Ledger rejection
   is the only way an emitted approve fails to land.
3. Resolve at custody layer; the swap-solver is downstream of
   the broken signer.

### Hypothesis E: deadline plumbing

1. Audit the venue's `buildSwapTxs(params: { deadlineMs })` —
   the deadline argument is the intent's, but the venue may add
   a buffer or use a stale value.
2. Fix in the venue adapter; ship.

### Hypothesis F: gas estimation stale

1. Bump the venue's static gas limit.
2. Defer to a recurring "venue config calibration" task —
   gas costs change with EVM upgrades, contract code, etc.

## 5. Escalation criteria

Escalate to **L2 on-call** (P1) if:

- Revert rate exceeds 5% of fulfilled swaps in 5 minutes (venue
  outage suspected).
- Revert is `STF` (allowance bug — could affect other agents on
  the same custody backend).
- The swap-solver's `chain-tx-reverted` error includes a tx
  hash that doesn't appear on-chain via independent RPC
  (provider bug, or worse — receipt-tampering).

Escalate to **Security Lead** (P0) if:

- The reverting tx's `to:` address doesn't match the
  operator-configured router for the venue (possible config
  poisoning OR the venue contract was replaced).
- The intent's `quote.commitment` is below the user's
  `minBuyAmount` despite the solver's pre-flight check —
  indicates a code path bypass in the swap-solver.
- Reverts cluster around specific agents (possible targeted
  attack, e.g. MEV searcher front-running the solver's quote
  with adverse pool-state manipulation).

## 6. Post-incident

- [ ] If Hypothesis A: was the slippage within the configured
  `internalSlippageBps`? If yes, no action. If marginally outside,
  consider whether the operator's slippage tolerance should
  widen.
- [ ] If Hypothesis B/C: venue adapter post-mortem. What's the
  blast radius of one venue's stale-quote bug? What's the
  fallback chain?
- [ ] If Hypothesis D: custody integration review. Allowance
  rejection should be VISIBLE earlier — emit a signal at custody
  rejection, not at solver revert.
- [ ] If Hypothesis E: deadline-plumbing audit. Property test:
  `intent.deadline - venue.txDeadline > minBufferMs` for every
  venue.
- [ ] If Hypothesis F: gas-budget freshness check. The wallet
  monorepo already has `npm run gas:check` for our own contracts;
  the venue adapter packages should adopt the same discipline.
- [ ] Did the audit pipeline join `intent-submitted`,
  `quote-received`, `quote-chosen`, `settlement-failed` for this
  intent into one trace? If not, fix tracing — operators need
  the full chain to diagnose.

## 7. Sharp edges

- **Approval txs persist after a swap revert.** A multi-tx
  sequence `[approve, swap]` lands the approve on-chain but
  reverts the swap. The agent's allowance for the venue's router
  remains. **This is correct** — re-running the swap intent
  doesn't need a fresh approve, saving gas. But it means
  measurement of "how much gas was wasted by reverts" should
  count the approve too, not zero. Read `Fill.metadata.receipts`
  is empty in the failed case; you need the thrown error's
  `details.transactionHash` plus the audit-event chain to
  reconstruct. Worth instrumenting if it's a recurring concern.

- **Reverts don't appear in `SolverGasHistogram`.** By design.
  The histogram tracks fulfilled swaps' gas; reverted ones
  have no `Fill` and aren't recorded. If you want a "wasted
  gas" panel, that's a separate metric — feed the
  `settlement-failed` audit events into a separate Counter.

- **`amountOutMinimum` was the right defence.** Don't be tempted
  to "fix" the revert by lowering the on-chain minimum. The
  whole point of the two-layer model is that adverse price
  movement reverts ON-CHAIN before any value moves. Without it,
  a swap delivering less than commitment passes on-chain but
  fails router verification, leaving the user down gas + partial
  output. This is documented in `packages/swap-solver/README.md`
  under "Defense-in-depth: on-chain `amountOutMinimum`."

- **Reputation-comparator already routes around bad solvers.**
  When configured with a `bestPriceWithReputation` comparator,
  the router naturally de-prioritises a solver with frequent
  failures. You don't need to manually disable the venue unless
  the failure rate is overwhelming the reputation signal.
  Verify the comparator config is doing what you expect:
  `routerConfig.comparator.name === "bestPriceWithReputation"`.

- **Gas refunds are not recovered.** The agent paid gas for the
  reverted tx. The intent-router's audit trail records the
  `chain-tx-reverted` error but doesn't surface the wei cost
  unless the venue's adapter populated it via `Fill.metadata`
  before the throw. If gas accounting per-revert matters for
  ops cost reporting, add a `gas_used_on_revert` field to the
  thrown error's `details` — open question for the swap-solver
  follow-up.
