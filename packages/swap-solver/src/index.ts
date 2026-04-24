/**
 * `@aethelred/wallet-swap-solver` — concrete intent-router solver
 * for `SwapIntent` backed by a pluggable `SwapVenue`.
 *
 * Third production-shape solver after
 * `@aethelred/wallet-x402-solver` (payment / ≤) and
 * `@aethelred/wallet-transfer-solver` (transfer / ===). Completes
 * the commitment-rule matrix with swap's `actualAmount ≥ commitment`
 * floor semantics.
 *
 * Typical wiring:
 *
 * ```ts
 * import { InMemorySolverRegistry, IntentRouter } from "@aethelred/wallet-intent-router";
 * import { RpcAnchorChainProvider } from "@aethelred/wallet-rpc-adapters";
 * import { StubSwapVenue, SwapSolver } from "@aethelred/wallet-swap-solver";
 *
 * const provider = new RpcAnchorChainProvider({ chainId: 8453, rpc, signAndEncodeTx });
 * const venue = new StubSwapVenue({
 *   id: "stub-v1",
 *   chainId: 8453,
 *   router: "0xSwapRouterAddress",
 *   priceNumerator: 3_500n, // 1 ETH = 3500 USDC
 *   priceDenominator: 1n,
 * });
 * const solver = new SwapSolver({
 *   id: "swap:stub:base",
 *   name: "Stub Swap Solver (Base)",
 *   from: "0xAgentControlAddress",
 *   provider,
 *   venue,
 *   internalSlippageBps: 50, // 0.5% buffer
 * });
 * const router = new IntentRouter({ registry: new InMemorySolverRegistry([solver]) });
 * ```
 *
 * Real production deployments pass a concrete venue adapter
 * (`@aethelred/wallet-swap-venue-uniswap-v3` or similar) instead of
 * `StubSwapVenue`. The solver treats them identically.
 *
 * @packageDocumentation
 */

export { SwapSolver } from "./solver";
export { SwapSolverError } from "./errors";
export { StubSwapVenue, pairOf } from "./stub-venue";

export type { SwapSolverErrorCode } from "./errors";
export type { StubSwapVenueConfig } from "./stub-venue";
export type {
  SwapChainProvider,
  SwapTxReceipt,
  SwapSolverConfig,
  SwapSolverQuoteMetadata,
  SwapSolverFillMetadata,
  SwapVenue,
  SwapQuoteParams,
  SwapQuoteResult,
  SwapBuildParams,
  SwapTxRequest,
  Fill,
  Intent,
  Quote,
  Solver,
  SwapIntentBody,
} from "./types";
