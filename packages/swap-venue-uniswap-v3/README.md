# `@aethelred/wallet-swap-venue-uniswap-v3`

First production-shape `SwapVenue` adapter — validates the
abstraction shipped in `@aethelred/wallet-swap-solver` against
a real DEX. Hand-rolled ABI encoders for QuoterV2 + SwapRouter02;
Pool `Swap` event decoder for fill-amount extraction; zero
runtime dependencies.

## Why this package exists

The `SwapSolver` shipped in PR #74 was venue-agnostic — its only
concrete implementation was `StubSwapVenue`, an in-memory test
double. Customers asking *"does the abstraction actually work
against a production DEX?"* couldn't be shown a working example.
This package answers that question:

- `quote()` calls **QuoterV2.quoteExactInputSingle** via
  `eth_call` (view function — no gas).
- `buildSwapTxs()` emits `[approve(router, amountIn),
  exactInputSingle(...)]` against **SwapRouter02**.
- `decodeFillAmount()` reads the **Pool Swap event** from the
  receipt's logs.

The venue plugs into `SwapSolver` unchanged — same composition
the moat stack has used since #74.

## Quick start

```ts
import { UniswapV3SwapVenue, pairKey, UNISWAP_V3_FEE_TIERS } from "@aethelred/wallet-swap-venue-uniswap-v3";
import { SwapSolver } from "@aethelred/wallet-swap-solver";
import { RpcAnchorChainProvider } from "@aethelred/wallet-rpc-adapters";

// Base mainnet canonical addresses.
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH = "0x4200000000000000000000000000000000000006";

const transport = /* your JSON-RPC transport — fetch-backed, websocket, etc. */;

const venue = new UniswapV3SwapVenue({
  chainId: 8453,
  quoterAddress: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  swapRouterAddress: "0x2626664c2603336E57B271c5C0b26F421741e481",
  transport,
  defaultFeeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,    // 0.3%
  feeTiers: new Map([
    [pairKey(USDC, WETH), UNISWAP_V3_FEE_TIERS.LOW], // 0.05% for USDC↔WETH
  ]),
});

const provider = new RpcAnchorChainProvider({ chainId: 8453, ... });

const solver = new SwapSolver({
  id: "swap:uniswap-v3:base",
  name: "Uniswap v3 — Base mainnet",
  from: agentAddress,
  provider,
  venue,
  internalSlippageBps: 50,
});
```

## Design

### Zero-dep ABI encoding

All three calls (`quoteExactInputSingle`, `exactInputSingle`,
`approve`) are encoded by hand. Layout is documented inline in
`src/encoder.ts`. The selectors are pre-computed constants:

| Selector | Function |
|---|---|
| `0xc6a5026a` | `QuoterV2.quoteExactInputSingle((address,address,uint256,uint24,uint160))` |
| `0x04e45aaf` | `SwapRouter02.exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))` |
| `0x095ea7b3` | `IERC20.approve(address,uint256)` (canonical ERC-20) |

Why hand-roll instead of viem? Same trade-off
`@aethelred/wallet-transfer-solver` made for
`transfer(address,uint256)`: every wallet-tier consumer pays the
package's bundle cost. viem ≈ 200KB; hand-rolled encoders ≈ 30
lines each, 4KB total. The ABI surface is small and stable;
hand-rolling is the correct trade-off for a wallet-tier
dependency.

### Single-hop only in v0.1

`quoteExactInputSingle` + `exactInputSingle` cover single-hop
swaps (one pool per swap). v3's multi-hop variant
(`quoteExactInput` + `exactInput`) takes a packed path
(`token0 → fee → token1 → fee → token2 → ...`) and routes
across multiple pools. Multi-hop is a future extension; the
single-hop path covers ~90% of v3 retail traffic per Uniswap
analytics and exercises every concern the `SwapVenue`
abstraction worried about.

### Per-pair fee tiers

v3 has three canonical fee tiers per pair (0.05% / 0.3% / 1%);
plus a stable-pair tier (0.01%) that's only deployed for some
pairs. Most pairs trade primarily on ONE tier. The venue's
`feeTiers` config is a `Map<pairKey, fee>` — operators specify
exceptions; everything else uses `defaultFeeTier`.

```ts
feeTiers: new Map([
  [pairKey(USDC, USDT), UNISWAP_V3_FEE_TIERS.ULTRA_LOW], // stable pair
  [pairKey(WETH, USDC), UNISWAP_V3_FEE_TIERS.LOW],       // ETH/USDC
]),
defaultFeeTier: UNISWAP_V3_FEE_TIERS.MEDIUM,             // everything else
```

The lookup is direction-agnostic — `pairKey(A, B)` and
`pairKey(B, A)` both match the same configured entry.

### Quote-time eth_call ↔ settle-time tx coupling

`quote()` does an `eth_call` to QuoterV2 (no gas, no state
change). The result includes `expectedBuyAmount`,
`sqrtPriceX96After`, etc. The venue threads `feeTier` and
`expectedBuyAmount` through `venueData` so `buildSwapTxs()`
uses the SAME tier without re-querying.

Why this matters: between quote and settle, the price can move.
The venue's job is to ENSURE the same tier is used (otherwise
the swap goes to a different pool than was quoted, breaking
the commitment guarantee). The solver's job is to ENSURE
`actualAmount >= commitment` regardless. Together: the
`amountOutMinimum` baked into the swap tx is the
solver-computed commitment floor, NOT the quote's mid-price.

### Approval flow

Two modes:

**v0.1 default — unconditional approve.** Every swap emits
`[approve(router, amountIn), exactInputSingle(...)]`. Wasteful
for repeat swaps from the same agent (the previous approval
still stands), but the simplest flow and the right starting
point.

**Allowance pre-flight — skip approve when sufficient (PR #97).**
Set `skipApproveWhenSufficient: true` plus `agentAddress` and
the venue calls `allowance(agent, router)` via `eth_call`
BEFORE deciding to emit an approve tx. When the existing
allowance is ≥ amountIn, approve is skipped:

```ts
const venue = new UniswapV3SwapVenue({
  chainId: 8453,
  quoterAddress, swapRouterAddress, transport,
  agentAddress: agentControlAddress,
  skipApproveWhenSufficient: true,
});
```

This is the standard production pattern for agents that
pre-approve their router once (typically `MAX_UINT256`) at
agent setup. Result: half the on-chain operations per swap.
Failing-closed semantics: if the allowance call throws, OR
the response is malformed, OR `agentAddress` is missing, the
venue falls back to emitting approve. Operators see wasted
tx, never a broken swap.

The solver-trio demo demonstrates both modes:

```bash
# Default v3 path: 2-tx swap [approve, swap]
npm run demo:solvers:v3 -- --samples 3
# Per-solver gas:  swap  237k  (57k + 180k)

# With pre-flight enabled: 1-tx swap [swap]
npm run demo:solvers -- --venue uniswap-v3 --preflight-allowance --samples 3
# Per-solver gas:  swap  171k  (171k)
```

Permit2 (Uniswap's signed-permit flow that REPLACES approve)
is a separate, deeper extension — requires migrating from
`SwapRouter02` to Universal Router (different ABI, different
calldata layout) plus EIP-712 signing capability injected
into the venue. Not in v0.1; deferred to a dedicated PR.

### Native asset handling: NOT supported

v3 deals in WETH; native ETH must be wrapped first. v0.1 of
this venue does NOT auto-wrap. Operators wanting native-ETH
swaps either:

1. Wrap upstream — agent's UI calls `WETH.deposit{value: ...}`
   before submitting the SwapIntent.
2. Use SwapRouter02's `multicall` to combine `wrapETH` +
   `exactInputSingle` in one tx — adds complexity to the
   venue. Defer.

### Swap-event decoding

Every v3 pool emits a `Swap` event on every swap:

```solidity
event Swap(
  address indexed sender,
  address indexed recipient,
  int256 amount0,
  int256 amount1,
  uint160 sqrtPriceX96,
  uint128 liquidity,
  int24 tick
);
```

Topic0 is the pre-computed
`0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`.

`amount0` / `amount1` are signed deltas from the POOL's
perspective — positive means received-by-pool, negative means
sent-by-pool (delivered to recipient). The decoder filters
by `recipient` and reads the negative side.

Token order in v3 pools is canonical: `token0 < token1` by
address (lowercased). The venue infers which side is `buyAsset`
from the configured `sellAsset` / `buyAsset` lexicographic
comparison; this is correct for any single-pool swap.

## Errors

`UniswapV3VenueError` taxonomy:

| Code | When |
|---|---|
| `no-liquidity` | Reserved (currently `quote()` returns null instead) |
| `quoter-call-failed` | `eth_call` to QuoterV2 threw a non-revert error |
| `quoter-decode-failed` | QuoterV2 result couldn't be parsed (< 128 bytes, malformed hex) |
| `swap-decode-failed` | Pool Swap event log couldn't be parsed |
| `missing-pool-event` | Receipt has no Swap event matching the recipient (caller should treat as `fill-below-commitment`) |
| `invalid-asset-address` | Address validation failed at construction or encode time |
| `chain-id-mismatch` | Reserved (the venue returns null from `quote()` instead) |

The swap-solver translates these into its own
`venue-quote-failed` / `venue-build-failed` /
`venue-decode-failed` codes per the `SwapVenue` contract.

## Testing

```bash
npx vitest run swap-venue-uniswap-v3
```

29 tests across four layers:

- **Encoder (5):** selector + slot-padding for QuoterV2 +
  SwapRouter02 + ERC-20 approve; bad-address rejection;
  QuoterV2 result roundtrip with realistic values.
- **Decoder (5):** Swap event topic + log layout including
  two's-complement handling for negative deltas; token0 vs
  token1 ordering inference; recipient mismatch returns 0n.
- **Venue (16):** constructor validation; happy-path quote;
  null on chainId mismatch / revert / zero-amount /
  same-asset; `[approve, swap]` tx ordering; receipt log →
  buyAmount; per-pair fee tier override; allowance pre-flight
  paths (allowance < amountIn → approve emitted; allowance ≥
  amountIn → approve skipped; flag-disabled default; no
  agentAddress fail-closed; throwing transport fail-closed;
  equal-allowance ≥ comparison).
- **Allowance encoder + decoder (3):** selector layout, uint256
  decode, vacuous "0x" returns 0n.

## What this package DOES NOT do

- **Multi-hop.** Single-hop only.
- **Native ETH.** Wrap to WETH upstream.
- **Permit2 / EIP-2612.** Vanilla `approve` flow only — opt
  into allowance pre-flight (above) for the common production
  optimization. Permit2 requires Universal Router + EIP-712
  signing capability injection; deferred to a dedicated PR.
- **Quote caching.** Each `quote()` call makes a fresh
  `eth_call`. Operators with high-frequency quoting needs
  add a caching wrapper.
- **Live testnet integration test in CI.** Tests use a
  stubbed transport; live integration is out-of-band.

## Composition with the rest of the stack

- **`@aethelred/wallet-swap-solver`** consumes this venue.
  Same `SwapVenue` interface, same composition surface.
- **`@aethelred/wallet-rpc-adapters`** provides
  `RpcAnchorChainProvider` for the swap-solver. The transport
  this venue takes can be the same RPC transport used by the
  chain provider.
- **`@aethelred/wallet-observability`** aggregates per-solver
  gas via `SolverGasHistogram` + `SolverGasHistogram.exportToMeter`
  (PRs #80–#82). The venue's gas data flows through the swap-
  solver's `Fill.metadata.receipts` array.

## Status

**v0.1 — single-hop happy path, validates the venue
abstraction.** Production rollout requires additional pre-flight
(allowance check, balance check) and the multi-hop / Permit2
extensions where applicable. The runbooks for swap reverts
(`docs/runbooks/swap-solver-tx-reverted.md`) reference this
venue as the canonical Uniswap integration.
