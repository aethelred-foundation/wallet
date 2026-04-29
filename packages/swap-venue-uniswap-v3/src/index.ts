/**
 * `@aethelred/wallet-swap-venue-uniswap-v3` — Uniswap v3 venue
 * for the swap-solver.
 *
 * Implements `SwapVenue` from `@aethelred/wallet-swap-solver`
 * against Uniswap v3's QuoterV2 (quoting) + SwapRouter02
 * (settlement) + Pool contracts (Swap event for fill decode).
 *
 * Single-hop only in v0.1. Zero runtime dependencies — ABI
 * encoding/decoding is hand-rolled to keep the wallet stack's
 * bundle discipline.
 *
 * Typical wiring:
 *
 * ```ts
 * import { UniswapV3SwapVenue, pairKey } from "@aethelred/wallet-swap-venue-uniswap-v3";
 * import { SwapSolver } from "@aethelred/wallet-swap-solver";
 *
 * const venue = new UniswapV3SwapVenue({
 *   chainId: 8453,
 *   quoterAddress: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
 *   swapRouterAddress: "0x2626664c2603336E57B271c5C0b26F421741e481",
 *   transport: rpcTransport,
 *   defaultFeeTier: 500, // 0.05%
 *   feeTiers: new Map([
 *     [pairKey(USDC, USDT), 100],   // stable pair
 *   ]),
 * });
 *
 * const solver = new SwapSolver({
 *   id: "swap:uniswap-v3:base",
 *   ...,
 *   venue,
 * });
 * ```
 *
 * @packageDocumentation
 */

export { UniswapV3SwapVenue, pairKey } from "./venue";
export {
  UniswapV3VenueError,
  UNISWAP_V3_FEE_TIERS,
  type MultiHopPath,
  type UniswapV3FeeTier,
  type UniswapV3SwapVenueConfig,
  type UniswapV3VenueData,
  type UniswapV3VenueErrorCode,
  type Eth_RpcTransport,
} from "./types";

// Encoder + decoder are exported for advanced consumers that
// want to compose with their own venue (e.g. multi-hop or
// custom fee-tier logic).
export {
  SELECTOR_QUOTE_EXACT_INPUT_SINGLE,
  SELECTOR_EXACT_INPUT_SINGLE,
  SELECTOR_QUOTE_EXACT_INPUT,
  SELECTOR_EXACT_INPUT,
  SELECTOR_QUOTE_EXACT_OUTPUT_SINGLE,
  SELECTOR_EXACT_OUTPUT_SINGLE,
  SELECTOR_ERC20_APPROVE,
  SELECTOR_ERC20_ALLOWANCE,
  encodeQuoteExactInputSingle,
  decodeQuoteExactInputSingleResult,
  encodeExactInputSingle,
  encodeQuoteExactOutputSingle,
  decodeQuoteExactOutputSingleResult,
  encodeExactOutputSingle,
  encodePath,
  encodeQuoteExactInput,
  decodeQuoteExactInputResult,
  encodeExactInput,
  reversePath,
  encodeErc20Approve,
  encodeErc20Allowance,
  decodeErc20AllowanceResult,
} from "./encoder";

export {
  TOPIC_SWAP_V3,
  decodeSwapEvents,
  extractBuyAmount,
  type SwapEventDecoded,
  type RawLogShape,
} from "./decoder";

export {
  InMemoryAllowanceCache,
  type AllowanceCache,
  type AllowanceCacheEntry,
  type InMemoryAllowanceCacheConfig,
} from "./allowance-cache";

export {
  NOOP_ALLOWANCE_CACHE_METRICS_RECORDER,
  type AllowanceCacheMetricsRecorder,
} from "./metrics";
