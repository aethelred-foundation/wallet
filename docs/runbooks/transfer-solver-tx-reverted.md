# P2: `transfer.solver.tx.reverted ≥ N`

> **Alert class:** Operational fault, not a correctness event
> **Severity:** P2 (paginate during business hours; P1 if rate
> > 1% of fulfilled transfers in a 5-min window — transfer
> reverts have no "expected" case, so even low rates are
> investigative)
> **Class:** On-chain solver / token-contract integration
> **Packages affected:** `@aethelred/wallet-transfer-solver`,
> `@aethelred/wallet-rpc-adapters`, the configured chain
> provider's signing backend
> **Last validated:** 2026-04-25

## 1. What this alert means

A transfer intent reached `TransferSolver.settle()`, the solver
encoded `transfer(recipient, amount)` calldata (or built a plain
value-transfer for the native sentinel), the chain provider
submitted it, and the receipt came back with
`status: "reverted"`.

The solver throws `TransferSolverError({ code: "chain-tx-reverted" })`
which the intent-router translates into
`outcome.kind === "settlement-failed"` with
`error: "chain-tx-reverted"`.

Unlike swap reverts (PR #85 runbook), **transfer reverts have NO
expected operational case**. The transfer-solver doesn't price
against anything — its `quote.commitment === intent.body.amount`
is a pure pass-through. There's no in-flight slippage, no
pool-state movement between quote and settle. Every transfer
revert is therefore one of:

1. **ERC-20 contract reverted** the call (insufficient balance,
   frozen sender, token paused).
2. **Native transfer rejected** by the recipient contract
   (no `receive`/`fallback`).
3. **Out-of-gas** (rare — `transfer()` is well-defined gas, but
   non-standard tokens may use more).
4. **Chain reorg** invalidated the original receipt.
5. **Nonce collision** — two pending txs same nonce; one won.
6. **Custody backend replaced the tx** with a higher-gas variant
   that hit a different code path.
7. **Asset misconfigured** — the operator's allow-list points at
   a non-ERC-20 token (or worse, an attacker-deployed lookalike).

That's it. There is no "the moat's defence fired correctly,
nothing to fix" case. **Every transfer revert implies action.**

## 2. Impact

- **The specific transfer did not settle.** Same as swap: the
  intent-router returns `settlement-failed`; agent retries or
  surfaces error to user.
- **No partial value movement** for ERC-20 transfers — the
  contract reverts atomically.
- **Native transfers can be partial-trickier.** A `value:` field
  on the tx burns gas to the recipient regardless of whether
  the recipient's `receive()` reverts; the gas IS spent, but
  the value isn't transferred. Operators sometimes confuse this.
- **Audit trail intact.** Same chain as swap — `intent-submitted`,
  `quotes-solicited`, `quote-received`, `quote-chosen`,
  `settlement-failed` events fire. The thrown error includes the
  failed tx hash in `details.transactionHash` plus the
  `blockNumber` for forensics.
- **Histogram impact.** The fill never lands in
  `SolverGasHistogram` (no `Fill` produced). Same caveat as
  swap-revert runbook: gas distributions in Grafana are over
  successful transfers only. A separate Counter on
  `settlement-failed` events is needed to track wasted gas.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the transfer-solver dashboard.
3. Pull from the alert context:
   - `solver_id` (which `TransferSolver` instance)
   - `tx_hash` of the reverted tx (from `details.transactionHash`)
   - `block_number` (from `details.blockNumber`)
   - `intent_id`, `creator`, `chain_id`, `asset`, `amount`,
     `recipient` (joined from the audit stream)

### 3.2 Minute 2–5: classify

The runbook's first decision: **single-event blip vs sustained
pattern?**

For transfer reverts the bar is lower than swap reverts —
swaps have legitimate price-driven failures, transfers don't.
Even a low rate is meaningful:

```promql
# rate of transfer reverts in last 5m
rate(intent_router_settlement_failed_total{
  solver_kind="transfer",
  error="chain-tx-reverted"
}[5m]) * 60
```

If > 1% of fulfilled transfers in 5 minutes, **escalate to P1**.
Most likely causes at that rate: token contract paused,
RPC provider returning bad receipts, custody backend issue
affecting all signers.

For a single revert, continue at P2. Single-revert diagnosis
focuses on the specific token + recipient combination.

### 3.3 Minute 5–15: triage

Inspect the reverted transaction:

```bash
cast tx <tx-hash> --rpc-url $PRODUCTION_RPC | tee /tmp/reverted-tx.json
cast receipt <tx-hash> --rpc-url $PRODUCTION_RPC | tee /tmp/reverted-receipt.json
```

Decode the calldata to confirm it's a transfer:

```bash
# Should be transfer(address,uint256) — selector 0xa9059cbb
cast 4byte-decode 0x<calldata>
```

Decode the revert reason. Common ERC-20 errors:

| Reason | Likely cause |
|---|---|
| `ERC20: transfer amount exceeds balance` | Insufficient balance — agent's USDC is below `amount`. **Most common.** |
| `Pausable: paused` | Token contract globally paused (USDC has done this for incidents). |
| `Blacklistable: account is blacklisted` | Sender or recipient on a contract-level blacklist (USDC enforces OFAC). |
| `ERC20: transfer to the zero address` | Bug in the agent's intent — recipient is `0x0`. |
| No revert data + `gasUsed == gasLimit` | Out-of-gas. Token uses more gas than the estimate provided. |
| Empty revert + `gasUsed < gasLimit` | Recipient is a contract with no `receive()` (native transfer only). |

Cross-check the agent's balance:

```bash
cast call <asset> "balanceOf(address)" <agent-address> \
  --block <block-number-of-revert> --rpc-url $PRODUCTION_RPC
```

If balance < amount at the revert block, **Hypothesis A**
(insufficient balance). Otherwise continue.

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — insufficient balance.**

The agent's balance was below `amount` at the time of submission.

- **How did this slip past?** The transfer-solver doesn't pre-flight
  balance — that would require an extra RPC call per quote and
  add coordination cost the moat decided wasn't worth it.
- **Resolution:** add a balance pre-flight at the agent /
  intent-creator level (most likely candidate). Operators
  generating intents should check the agent's balance before
  signing — the moat's solver layer is intentionally
  thin-client.
- **Alternative:** the agent had balance at quote time but a
  concurrent withdrawal drained it. This is a race with a UI
  that allows two pending intents from the same agent; fix at
  the UI layer, not the solver.

**Hypothesis B — token contract paused.**

The asset's contract is in a global pause state (Circle's USDC
has paused before during compliance incidents).

- **How to confirm:** `cast call <asset> "paused()" --rpc-url ...`
  returns `true`.
- **Resolution:** wait for the issuer to unpause; pause the
  agent's transfer flow for that asset until then. Other
  assets continue working. Document the pause in the operator's
  status page.

**Hypothesis C — sender or recipient blacklisted.**

USDC, USDT, and other compliance-enforcing tokens maintain
on-contract blacklists. A blacklisted sender can't transfer at
all; a blacklisted recipient can't receive.

- **How to confirm:**
  ```bash
  cast call <asset> "isBlacklisted(address)" <agent> --rpc-url ...
  cast call <asset> "isBlacklisted(address)" <recipient> --rpc-url ...
  ```
- **Resolution:** if the AGENT is blacklisted, escalate to
  Compliance Lead immediately. The agent's identity is
  effectively frozen for that asset; the operator may need to
  rotate the agent's control address. If the RECIPIENT is
  blacklisted, the intent is malformed (UI shouldn't have
  allowed it); fix the UI's recipient validation.

**Hypothesis D — recipient contract rejected native transfer.**

For native asset transfers (the `0x0…0` sentinel), the recipient
is a contract that doesn't implement `receive()` or
`fallback() payable`. The transfer reverts in the recipient's
EVM dispatch.

- **How to confirm:** `cast code <recipient> --rpc-url ...`
  returns non-empty bytecode AND the revert had no error data
  AND `gasUsed < gasLimit`.
- **Resolution:** the intent is malformed; the recipient is a
  contract that doesn't accept native value. Either send to an
  EOA, or wrap the native asset (WETH on Base / WMATIC etc.)
  and submit as an ERC-20 transfer instead. Fix at the UI/
  intent-creator level.

**Hypothesis E — chain reorg invalidated the receipt.**

The receipt poll fetched a tx hash that ended up in a forked
block; canonical chain has the tx reverted (or missing).

- **How to confirm:** query the same tx hash from a second RPC
  provider:
  ```bash
  cast receipt <tx-hash> --rpc-url $BACKUP_RPC
  ```
  If status differs across providers, reorg. If the canonical
  chain says "tx not found," the tx was mined in a forked
  block and is gone.
- **Resolution:** the moat's chain provider should re-poll until
  receipt finality (configurable confirmation depth). If reorg
  events are recurring, increase the confirmation threshold
  in the operator's `RpcAnchorChainProvider` config — currently
  `pollTimeoutMs` bounds the wait, but doesn't enforce N-block
  confirmation. Open question: should the chain provider expose
  a `confirmations` parameter? Track as follow-up.

**Hypothesis F — nonce collision.**

Two pending txs from the agent's address with the same nonce;
the network mined the other one. The original tx is dropped or
mined into a stale state.

- **How to confirm:**
  ```bash
  cast nonce <agent-address> --rpc-url $PRODUCTION_RPC
  ```
  vs the tx's nonce. Plus check pending mempool for txs from
  the same sender.
- **Resolution:** the custody backend's nonce-management is
  racing — likely two intents submitted before the first's
  receipt was confirmed. The moat's `InMemoryNonceStore`
  prevents intent-level replay but doesn't manage chain-level
  nonces; the chain provider's `signAndEncodeTx` is where
  nonces are picked. Audit the custody adapter's nonce
  reservation logic; consider a nonce lock for the agent.

**Hypothesis G — custody-backend tx replacement.**

The agent's custody backend (Nitro / Ledger / Fireblocks) signed
a tx, then the operator's resubmit-with-higher-gas logic replaced
it. The replacement may have used different calldata or hit a
different code path.

- **How to confirm:** check custody backend's audit log for
  resubmits; compare the original signed tx hash with the
  on-chain tx hash.
- **Resolution:** custody backend's resubmit logic should not
  modify calldata (only gas price / tip cap). If it does, that's
  a bug in the custody adapter — fix there. The transfer-solver
  is downstream and shouldn't see modified calldata.

**Hypothesis H — asset misconfigured / lookalike token.**

The operator's `allowedAssets` config (or the intent body's
`asset` field) points at an address that ISN'T the canonical
ERC-20 contract. Likely candidates:

1. **Old token version** — USDC v1 vs v2 addresses on some
   chains.
2. **Bridged token at the wrong address** — Polygon vs Avalanche
   USDC bridges have produced multiple addresses; one is the
   "real" canonical, others are zombie tokens.
3. **Attacker-deployed lookalike** — same name/symbol as USDC,
   different address. **Confirm escalation to Security Lead.**

- **How to confirm:**
  ```bash
  cast call <asset> "name()" --rpc-url $PRODUCTION_RPC
  cast call <asset> "symbol()" --rpc-url $PRODUCTION_RPC
  cast call <asset> "decimals()" --rpc-url $PRODUCTION_RPC
  # Compare against canonical addresses from
  # https://www.circle.com/multi-chain-usdc — for USDC on Base:
  # 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
  ```
- **Resolution:** Hypothesis H8 (attacker-deployed lookalike)
  is **P0 escalation to Security Lead** — operator config has
  been poisoned. Other variants are config bugs; fix the
  allow-list, regenerate intents.

## 4. Resolution paths

### Hypothesis A: insufficient balance

1. Add agent-side balance pre-flight at intent creation time
   (NOT solver-side; that's the wrong layer).
2. UI/agent should refuse to create the intent OR warn the user
   before signing.
3. Optional: surface the balance gap in the
   `settlement-failed` outcome's `details` so the agent's
   retry-loop can self-diagnose.

### Hypothesis B: token paused

1. Pause the operator's transfer flow for that asset.
2. Monitor the asset's pause status; resume when issuer
   unpauses.
3. Customer-facing: status page entry; potentially refund any
   gas the agent spent on the failed tx (operator policy).

### Hypothesis C: blacklist

1. **Agent blacklisted** → P0 escalate to Compliance Lead.
   Frozen agent identity; possibly rotate control address; SOC-2
   incident report required.
2. **Recipient blacklisted** → fix UI validation; the agent
   shouldn't be able to enter a blacklisted recipient.

### Hypothesis D: native transfer to non-payable contract

1. Fix UI: don't allow native sends to contracts without a
   verified `receive()` or `fallback() payable`.
2. Document the limitation; agents wanting to send to such
   contracts must use a wrapping token (WETH / WMATIC).

### Hypothesis E: chain reorg

1. Add a `confirmations` parameter to `RpcAnchorChainProvider`
   config (currently `pollTimeoutMs` is the only bound).
2. For the affected chain, set confirmation depth to whatever
   the chain's reorg-tail empirics support (Base: ~3 blocks,
   Polygon: ~32 blocks, etc.).
3. Backfill the missing audit event from the canonical chain
   state via re-poll.

### Hypothesis F: nonce collision

1. Audit the custody adapter's nonce reservation: does it lock
   the agent's nonce until the tx is confirmed? If not, add a
   per-agent nonce lock.
2. Consider an in-memory nonce reservation queue at the chain
   provider level.

### Hypothesis G: custody resubmit corruption

1. Custody adapter bug. Fix should constrain resubmit to gas
   parameters only, never calldata.
2. Add a test: resubmit at higher gas → calldata bytes
   identical.

### Hypothesis H: asset misconfigured / lookalike

1. **Lookalike (H8)** → **P0 SECURITY ESCALATION**. Audit the
   operator config supply chain: who pushed the bad address?
   Was it a typo, a malicious PR, or a compromised deployer?
2. Other variants: fix the allow-list config; regenerate any
   intents that referenced the wrong address.

## 5. Escalation criteria

Escalate to **L2 on-call** (P1) if:

- Revert rate exceeds 1% of fulfilled transfers in 5 minutes
  (token-pause, blacklist surge, or RPC issue suspected).
- Reverts cluster on a single asset across multiple agents
  (token-side issue).
- Reverts cluster on a single agent across multiple assets
  (custody-side or balance-management issue).

Escalate to **Security Lead** (P0) if:

- Hypothesis H8 confirmed (attacker-deployed lookalike token in
  operator config).
- Hypothesis C confirmed with the AGENT blacklisted (compliance
  freeze, rotate control address, file incident report).
- Reverts cluster on a single recipient across multiple agents
  (possible front-running / honeypot recipient).
- The reverting tx's calldata doesn't decode to
  `transfer(address,uint256)` despite the solver claiming to
  have submitted a transfer (code path bypass).

## 6. Post-incident

- [ ] If Hypothesis A: implement balance pre-flight at intent
  creation. Property test: `intent.body.amount <= balance(agent,
  asset, intent.envelope.chainId)` for every transfer intent
  produced by the operator's UI.
- [ ] If Hypothesis B/C: cache the asset's pause/blacklist
  state for fast pre-flight. Refresh on a cadence; bypass the
  cache when the alert fires.
- [ ] If Hypothesis E: confirmation-depth config landed across
  every operator's deployment. Open a follow-up to add
  `confirmations` to `RpcAnchorChainProvider` config.
- [ ] If Hypothesis F: nonce-lock added to custody adapter.
  Property test: two concurrent intents from the same agent →
  one wins, one queued; no nonce collision.
- [ ] If Hypothesis H: operator config audit. Was the
  `allowedAssets` change reviewed by ≥ 2 humans? Should it have
  been? Time-lock on `allowedAssets` writes is a candidate.
- [ ] Did the audit pipeline join the failure trace correctly?
  Same hygiene check as swap-revert runbook §6.

## 7. Sharp edges

- **Non-standard ERC-20s return `false` instead of reverting.**
  Early USDT mainnet, BNB token, and some bridged assets do
  NOT revert on insufficient balance — they return `false`
  from `transfer()`. The on-chain receipt has
  `status: "success"`, but no tokens moved.

  The transfer-solver does NOT inspect logs to confirm the
  Transfer event fired. **For non-standard assets, a "successful"
  receipt does NOT mean the transfer succeeded.**

  Detection requires log inspection: the Transfer(from,to,value)
  event must appear with the expected from/to/value. Until the
  solver checks this (open question), operators serving
  non-standard tokens should NOT trust the
  `outcome.kind === "fulfilled"` signal alone — verify on-chain
  separately.

- **Native value DOES burn gas on revert.** A `value:` field on
  a tx that reverts because the recipient is non-payable still
  consumes gas up to the failure point. The agent paid for the
  revert. ERC-20 transfers that revert behave the same way
  (always do — that's how EVM reverts work). Operators tracking
  "wasted gas on transfer reverts" should count BOTH the failed
  tx AND any preceding txs in the operator's pipeline (e.g.
  custody pre-flight calls).

- **Balance pre-flight is at the intent layer, not the solver
  layer.** The transfer-solver intentionally doesn't pre-check
  balance — that would require an extra RPC per quote and add
  latency. The pre-flight belongs at the intent creator's UI /
  agent layer. Don't propose moving it into the solver as a
  "fix" for Hypothesis A — that creates the wrong coupling.

- **Reorgs surface as inconsistent receipts across RPCs.** The
  transfer-solver polls ONE provider's `getTransactionReceipt`.
  If that provider's view drifts from canonical chain state
  (it happens during reorgs), the audit trail records a
  different outcome than what the chain ultimately confirms.

  Mitigation: cross-RPC validation BEFORE acting on the
  receipt. The chain provider could call N providers and
  require quorum. Track as a follow-up; the moat's current
  posture trusts the configured provider.

- **`InMemoryNonceStore` is intent-level, not chain-level.**
  The intent-router's nonce store prevents the same `(creator,
  intent-nonce, chainId)` tuple from being submitted twice as
  an intent. It does NOT manage the on-chain Ethereum
  `transactionCount` of the agent's address — that's the
  custody adapter's job. Don't confuse the two; nonce
  collisions at the chain level (Hypothesis F) are NOT a
  router bug.

- **Reputation-comparator can't help here.** Unlike swap-revert
  (where multiple solvers can serve a swap and the comparator
  picks the best one), there's typically ONE TransferSolver per
  chain in a registry. Manual operator intervention (pause the
  flow for the affected asset / agent) is the only remediation
  during an incident. Don't expect automatic routing-around.
