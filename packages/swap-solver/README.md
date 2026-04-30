# `@aethelred/wallet-swap-solver`

Third production-shape intent-router solver, completing the `≤ / === / ≥`
commitment-rule matrix across all three intent kinds. Accepts
`SwapIntent`, translates it into a sequence of on-chain txs against
a pluggable `SwapVenue`, and polls the receipts into a router
`Fill`.

## Why this package exists

With x402-solver (PR #72) and transfer-solver (PR #73), the intent
router had two concrete solvers sharing the same `Solver` contract.
This package proves the pattern handles the **hardest** commitment
rule:

| Solver | Intent kind | Rule | Venue surface |
|--------|-------------|------|---------------|
| `x402-solver` | `payment` | `actualAmount ≤ commitment` | HTTP facilitator |
| `transfer-solver` | `transfer` | `actualAmount === commitment` | Raw chain tx |
| `swap-solver` | `swap` | `actualAmount ≥ commitment` | DEX adapter (`SwapVenue`) |

Payment is lenient (under-spending a ceiling is fine). Transfer is
strict (exact). **Swap is a floor** — the solver commits to a
minimum output, defends it with an on-chain `amountOutMinimum`, and
the router rejects anything below. This package ships the solver
logic + a `StubSwapVenue` reference implementation. Real Uniswap v3 /
CoW / 1inch adapters are future packages that implement the
`SwapVenue` interface; this solver treats them all identically.

**Direction-aware (PR #118+).** `SwapIntent` supports two directions:

- `direction: "exact-input"` (default) — sell exactly `sellAmount`,
  receive at least `minBuyAmount`. The classical floor-commitment
  rule applies: solver commits to the buy-side floor; chain
  enforces via `amountOutMinimum`.
- `direction: "exact-output"` — receive exactly `buyAmount`, spend
  up to `maxSellAmount`. Useful for NFT purchases / fixed-price
  payments. Solver commits to `buyAmount` (Uniswap's `exactOutput`
  contract guarantees that exact amount); chain enforces via
  `amountInMaximum`.

Same router rule (`actualAmount >= commitment`) applies to both
directions; same solver, same venue interface. `UniswapV3SwapVenue`
(`@aethelred/wallet-swap-venue-uniswap-v3`) supports both;
StubSwapVenue (this package) supports both as of PR #120.

## Quick start

```ts
import {
  InMemorySolverRegistry,
  IntentRouter,
  createSignedIntent,
} from "@aethelred/wallet-intent-router";
import { RpcAnchorChainProvider } from "@aethelred/wallet-rpc-adapters";
import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import { StubSwapVenue, SwapSolver } from "@aethelred/wallet-swap-solver";

// 1. Chain provider — same as transfer-solver.
const provider = new RpcAnchorChainProvider({
  chainId: 8453,
  rpc: { url: process.env.RPC_URL! },
  signAndEncodeTx: /* custody signer */,
});

// 2. Venue. StubSwapVenue is deterministic, in-memory, and zero-RPC —
//    great for tests and demos. Production swaps a venue adapter in.
const venue = new StubSwapVenue({
  id: "stub-v1",
  chainId: 8453,
  router: "0x2626664c2603336E57B271c5C0b26F421741e481", // Uniswap v3 on Base
  priceNumerator: 3_500_000_000n, // 1 WETH = 3500 USDC (scaled)
  priceDenominator: 1_000_000_000_000_000_000n,
});

// 3. Solver.
const custody = new LocalKeyAdapter({ privateKey: process.env.PK! });
const solver = new SwapSolver({
  id: "swap:stub:base",
  name: "Aethelred Swap Solver (Stub on Base)",
  from: custody.address,
  provider,
  venue,
  internalSlippageBps: 50, // 0.5% buffer
  allowedPairs: [          // optional allow-list
    "0x4200000000000000000000000000000000000006-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // WETH→USDC
  ],
});

// 4. Register + submit intent.
const router = new IntentRouter({
  registry: new InMemorySolverRegistry([solver]),
});
const intent = await createSignedIntent({
  body: {
    kind: "swap",
    sellAsset: "0x4200000000000000000000000000000000000006", // WETH
    sellAmount: "1000000000000000000",                        // 1 WETH
    buyAsset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",  // USDC
    minBuyAmount: "3400000000",                               // 3400 USDC (user-side floor)
    recipient: custody.address,
  },
  creator: custody.address,
  chainId: 8453,
  deadlineMs: Date.now() + 5 * 60_000,
  signer: custody.asTypedDataSigner(),
});

const result = await router.execute(intent);
if (result.outcome.kind === "fulfilled") {
  console.log("Bought:", result.outcome.fill.actualAmount);
  console.log("Tx:", result.outcome.fill.settlementRef);
}
```

## Design

### Direction-discriminated intents (PR #118)

`SwapIntentBody` supports two directions via the optional
`direction` discriminator:

```ts
// Exact-input (default — back-compat for callers that omit `direction`)
{
  kind: "swap",
  sellAsset: USDC,
  sellAmount: "1000000",            // exact sell
  buyAsset: WETH,
  minBuyAmount: "99000000000000",   // floor
  recipient: AGENT,
}

// Exact-output (PR #118)
{
  kind: "swap",
  direction: "exact-output",
  sellAsset: USDC,
  buyAsset: WETH,
  buyAmount: "1000000000000000000",  // exact buy
  maxSellAmount: "5000000000",       // ceiling
  recipient: AGENT,
}
```

Exact-output is useful for NFT purchases, fixed-price payments,
and any flow where the user cares about the OUTPUT amount, not
the input.

**Solver behavior per direction:**

| | exact-input | exact-output |
|---|---|---|
| Required body fields | `sellAmount`, `minBuyAmount` | `buyAmount`, `maxSellAmount` |
| Venue methods called | `venue.quote` + `venue.buildSwapTxs` | `venue.quoteExactOutput` + `venue.buildExactOutputSwapTxs` |
| Quote commitment | floor (`expectedBuyAmount * (1 - slippage)`) | exact `buyAmount` |
| Router rule | `actualAmount ≥ commitment` (floor satisfied) | `actualAmount ≥ commitment` (`actual === buyAmount === commitment`) |
| Slippage applied to | sell side (input is exact) | buy side (output is exact) |

**Venue capability check.** The solver checks
`typeof venue.quoteExactOutput === "function"` at quote time. If
the configured venue lacks exact-output support, exact-output
intents return null from quote (the router tries other solvers).

The `UniswapV3SwapVenue` from
`@aethelred/wallet-swap-venue-uniswap-v3` supports both directions
(PRs #113/#114 single-hop + multi-hop). Stub venues + bespoke
adapters (CoW, 1inch) can opt out by leaving the optional methods
undefined.

### Floor commitment + internal slippage

Swap prices move between the venue's `quote()` and the on-chain
execution inside `settle()`. The solver defends against this with
an **internal slippage buffer** applied to the venue's mid-price
estimate:

```
floor = expectedBuyAmount * (10_000 - internalSlippageBps) / 10_000
```

This floor becomes the router `commitment`. If the floor is below
the user's `minBuyAmount`, the solver declines (the intent is
unserveable at the offered tolerance). Otherwise the solver commits
to the floor — and the router's `actualAmount ≥ commitment` check
validates the end state.

`internalSlippageBps` is INDEPENDENT from the intent's `slippageBps`
(which is the user's preference). Default: 50 (0.5%).

**Direction-asymmetric slippage (PR #122).** Exact-input applies
the buffer to NARROW the buy-side floor; exact-output applies it
to WIDEN the sell-side ceiling. Operators wanting different
slippage values per direction set the optional
`internalSlippageBpsExactOutput` config field; when unset, the
exact-output path falls back to the unified `internalSlippageBps`.

```ts
new SwapSolver({
  // ...
  internalSlippageBps: 50,                  // 0.5% — used by exact-input
  internalSlippageBpsExactOutput: 200,      // 2% — used by exact-output (overrides default)
});
```

Production scenarios where direction-asymmetric values matter:

- **Tight-liquidity tokens** where buy-side and sell-side
  slippage manifest differently (e.g. token has many holders
  but few sellers; sell-side spreads are tight, buy-side spreads
  are wide)
- **Operator analytics** showing different P&L outcomes per
  direction motivating distinct ceilings
- **Risk segmentation** — exact-output is typically used for
  fixed-price commitments (NFT purchases, payments) where a
  larger sell-side buffer is acceptable in exchange for higher
  fill rate

The `Quote.metadata.internalSlippageBps` field reflects the
DIRECTION-ACTIVE value (not the unified one) so audit consumers
can attribute the buffer correctly.

### Defense-in-depth: on-chain `amountOutMinimum`

The same commitment is passed to `venue.buildSwapTxs()` as
`amountOutMinimum` — the venue embeds it as the on-chain revert
threshold. Result:

- Price moves within buffer → swap completes, fill ≥ commitment → ✓
- Price moves outside buffer → swap reverts on-chain → `chain-tx-reverted`

Without the on-chain minimum, a swap that delivered less than
commitment would be accepted by the chain but rejected by the
router — leaving gas burned, partial output moved, and an intent in
limbo. The on-chain guardrail keeps the two layers consistent.

### Venue abstraction (`SwapVenue`)

All DEX-specific logic lives in one interface:

```ts
interface SwapVenue {
  readonly id: string;
  readonly chainId: number;
  quote(params): Promise<SwapQuoteResult | null>;
  buildSwapTxs(params): Promise<ReadonlyArray<SwapTxRequest>>;
  decodeFillAmount(params): bigint;
}
```

- **`quote`** returns `null` for no-liquidity / unsupported pair
  (first-class decline — solver translates to `quote → null`).
- **`buildSwapTxs`** returns a **sequence** of txs (e.g.
  `[approve, swap]` for v3 without Permit2, `[swap]` for CoW). The
  solver submits them sequentially, aborts on first failure, captures
  all receipts.
- **`decodeFillAmount`** reads the buyAsset delivered to `recipient`
  from the final swap receipt's logs. Venue-specific — v3 reads
  `Swap(int256 amount0, int256 amount1)`, CoW reads `Trade`.

This keeps the solver package zero-dep — real venue adapters are
separate packages that can ship their own ABI libs without
polluting the solver.

### Multi-tx sequences

Some swap paths need prep work:

- **Uniswap v3 without Permit2**: approve the router for `sellAsset`, then swap.
- **CoW Batch**: post the order to the settlement contract, then wait for clearing.
- **Wrapped-native swap**: wrap native → ERC-20, then swap.

The `SwapVenue.buildSwapTxs()` contract supports this natively by
returning an array. Each element has a `label` (`"approve"`,
`"swap"`, `"wrap"`) that surfaces in `Fill.metadata.txLabels` for
audit. The LAST tx's receipt is the one passed to
`decodeFillAmount`.

### Re-quoting during settle

`settle()` re-quotes the venue to thread `venueData` into
`buildSwapTxs`. The alternative — persisting `venueData` across the
quote/settle handoff — would require serialising opaque venue state
through `Quote.metadata`, coupling the router to venue internals.
Re-quoting is one extra call (cheap — venue quotes are typically a
single pool-state read) and keeps the router/solver handoff about
`commitment` alone.

A side benefit: if the venue's floor has dropped below `commitment`
between quote and settle, we catch it before any tx is submitted
(`venue-quote-below-min-buy-amount`), saving gas on a guaranteed
revert.

### Declines as null, failures as throw

Follows the intent-router's `Solver` contract — same as the other
two solvers:

| Condition | Return |
|-----------|--------|
| Non-swap intent | `quote → null` |
| Creator ≠ `from` | `quote → null` |
| chainId mismatch | `quote → null` / `settle → throws chain-id-mismatch` |
| Past deadline | `quote → null` |
| Invalid address / amount | `quote → null` / `settle → throws typed code` |
| Same sell+buy asset | `quote → null` / `settle → throws same-sell-and-buy-asset` |
| Pair outside allow-list | `quote → null` |
| Venue no-liquidity | `quote → null` / `settle → throws venue-no-liquidity` |
| Venue quote throws at quote time | `quote → null` (degrades gracefully) |
| Venue quote throws at settle | `settle → throws venue-quote-failed` |
| Venue floor drops below commitment | `settle → throws venue-quote-below-min-buy-amount` |
| `buildSwapTxs` throws or returns empty | `settle → throws venue-build-failed` |
| `sendTransaction` throws | `settle → throws chain-submit-failed` |
| Receipt `reverted` | `settle → throws chain-tx-reverted` |
| Receipt never appears | `settle → throws chain-confirmation-timeout` |
| `getTransactionReceipt` throws | `settle → throws chain-submit-failed` |
| `decodeFillAmount` throws | `settle → throws venue-decode-failed` |
| Decoded fill < commitment | `settle → throws fill-below-commitment` |

### Fill metadata carries every receipt + aggregate gas

Multi-tx sequences produce multi-receipt fills:

```ts
{
  solverClass: "swap";
  chainId: number;
  venueId: string;
  receipts: ReadonlyArray<TxReceipt>;        // approve + swap + …
  txLabels: ReadonlyArray<string>;           // ["approve", "swap", …]
  perTxGasUsed?: ReadonlyArray<bigint | null>; // per-tx gas (null if missing on that receipt)
  gasUsed?: bigint;                           // sum across all receipts (if all have gas data)
  gasCostWei?: bigint;                        // sum of gasUsed * effectiveGasPrice
}
```

The audit pipeline preserves all receipts. The router's
`settlementRef` is the LAST tx's hash (the swap itself).

Gas aggregation is **conservative**: `gasUsed` / `gasCostWei` are
omitted if ANY receipt in the sequence lacks the field. A partial
sum (approve gas known, swap gas missing, total reported as
"approve gas") would mislead observability dashboards; better to
flag the absence via an omitted total while still preserving the
`perTxGasUsed` breakdown for receipts that DO have data.

## Errors

All failures throw `SwapSolverError` with a stable `code`:

| Code | When |
|------|------|
| `unsupported-intent-kind` | `settle()` called with non-swap intent |
| `invalid-sell-asset-address` | Sell asset isn't 20-byte hex |
| `invalid-buy-asset-address` | Buy asset isn't 20-byte hex |
| `invalid-recipient-address` | Recipient isn't 20-byte hex |
| `invalid-amount` | Quote commitment fails to parse / non-positive (post-direction-parse arithmetic) |
| `invalid-swap-direction` | (PR #125) Direction discriminator + amount fields are inconsistent: missing required fields for the declared direction, cross-direction fields populated, or unknown direction string. Carries `details: { direction, hasSellAmount, hasMinBuyAmount, hasBuyAmount, hasMaxSellAmount }` for ops triage. |
| `same-sell-and-buy-asset` | sellAsset === buyAsset |
| `venue-no-liquidity` | Venue returned null at settle (no route) |
| `venue-quote-failed` | Venue quote threw during settle |
| `venue-quote-below-min-buy-amount` | Price moved below commitment floor |
| `venue-build-failed` | `buildSwapTxs` threw or returned empty |
| `venue-decode-failed` | `decodeFillAmount` threw |
| `chain-submit-failed` | `sendTransaction` or `getTransactionReceipt` threw |
| `chain-confirmation-timeout` | Receipt not confirmed within `pollTimeoutMs` |
| `chain-tx-reverted` | Receipt returned `status: "reverted"` |
| `chain-id-mismatch` | `intent.chainId ≠ provider.chainId` |
| `fill-below-commitment` | Decoded fill below committed floor (defensive — on-chain amountOutMinimum should have prevented) |
| `solver-disposed` | Solver used after `dispose()` |
| `signer-mismatch` | Intent creator ≠ configured `from` |

Consumers branch on `code`, never on `message`.

## Testing

```bash
npx vitest run swap-solver
```

42 tests covering: solver identity (4 incl. constructor guards),
StubSwapVenue unit tests (6), quote declines (11 conditions), quote
happy path (1), settle declines (5), settle failure modes (11),
settle happy path — single-tx / multi-tx / native sell-asset (3),
dispose semantics + error class export (2).

Uses real `createSignedIntent` + `LocalKeyAdapter` for EIP-712-signed
intents. Chain provider + venue are in-memory test doubles.

## What this package DOES NOT do

- **Implement a real DEX adapter.** `StubSwapVenue` is deterministic
  and purely in-memory. Production deployments compose
  `@aethelred/wallet-swap-venue-uniswap-v3` (or bespoke) instead.
- **Sign transactions.** Signing lives in the chain provider's
  `signAndEncodeTx` slot — same pattern as transfer-solver. The
  solver assembles calldata, the custody layer signs.
- **Implement non-swap intents.** Transfer intents go to
  `transfer-solver`; payment intents to `x402-solver`.
- **Retry.** Swap failures fail. The intent-router's
  `settlement-failed` path is the recovery vector.
- **Permit2 / Permit / EIP-2612 approval flows.** Those are
  venue-specific optimisations that the venue adapter can emit as
  part of its tx sequence (e.g. as an `"approve"` label, or a
  `"permit"` label). The solver is label-agnostic.

## Composition with the rest of the stack

- **Custody adapters** sign txs inside the chain provider (same as transfer-solver).
- **rpc-adapters** provides `RpcAnchorChainProvider`.
- **Intent-router** hosts the solver in its `SolverRegistry`. The
  generic path now supports all three intent kinds end-to-end.
- **Reputation** (via VC gates) filters which recipients are swap-eligible.
- **Agent-budget** caps on-chain spend before the solver submits.
- **Paymaster-sponsor** covers gas on the entire tx sequence.
- **Notarization** anchors the fill receipts to the batch merkle tree.

Three concrete solvers, three commitment rules, one interface.
That's the composability proof the moat argued for in prose — now
demonstrated in code.
