/**
 * `@aethelred/wallet-swap-venue-uniswap-v3` — type surface.
 *
 * Two logical groups:
 *
 *   1. Config + identifiers consumed at venue construction.
 *   2. Errors thrown by the venue (the swap-solver wraps them as
 *      `venue-quote-failed` / `venue-build-failed` /
 *      `venue-decode-failed` per its public contract).
 */

import type { AllowanceCache } from "./allowance-cache";
import type { AllowanceCacheMetricsRecorder } from "./metrics";

// ─── Transport ─────────────────────────────────────────────

/**
 * Minimal JSON-RPC transport — same shape as the one in
 * `@aethelred/wallet-rpc-adapters`. We re-define it here rather
 * than depending on rpc-adapters because the venue only needs
 * `eth_call` (for QuoterV2) and a no-op `eth_getTransactionReceipt`
 * is provided by whatever chain provider the swap-solver wires
 * through.
 *
 * Operators can pass their existing transport instance OR roll
 * any object that satisfies the shape — fetch-backed,
 * websocket-backed, in-memory test double, etc.
 */
export interface Eth_RpcTransport {
  call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T>;
}

// ─── Multi-hop path (PR #106) ──────────────────────────────

/**
 * A multi-hop swap path through Uniswap v3 pools — `tokens[i] →
 * tokens[i+1]` for `i = 0..N-1`, traversing the pool of fee tier
 * `fees[i]` for each hop.
 *
 * Invariants (enforced by `encodePath`):
 *   - `tokens.length >= 2`
 *   - `fees.length === tokens.length - 1`
 *   - every token is a valid 20-byte 0x-prefixed address
 *   - every fee is a valid uint24
 *
 * Operators configure paths per `(sellAsset, buyAsset)` pair via
 * `multiHopPaths`. The venue routes through the configured path
 * when the pair is present; falls back to single-hop with the
 * configured fee tier otherwise.
 *
 * Example for `USDC → DAI` via WETH:
 *
 * ```ts
 * const usdcDaiPath: MultiHopPath = {
 *   tokens: [USDC, WETH, DAI],
 *   fees: [500, 3000], // USDC/WETH 0.05%, WETH/DAI 0.3%
 * };
 * ```
 */
export interface MultiHopPath {
  readonly tokens: ReadonlyArray<`0x${string}`>;
  readonly fees: ReadonlyArray<UniswapV3FeeTier | number>;
}

// ─── Fee tiers ─────────────────────────────────────────────

/**
 * Uniswap v3's three canonical fee tiers (in pip basis points —
 * 100 = 0.01%). Most pairs trade primarily on ONE tier; operators
 * configure which tier to use per pair via `feeTiers`.
 *
 * Stable-stable pairs (USDC↔USDT) typically use 100 (0.01%);
 * volatile-major pairs (ETH↔USDC) use 500 (0.05%) or 3000 (0.3%);
 * exotic pairs use 10000 (1%). Choosing the wrong tier means the
 * QuoterV2 returns a "no liquidity" reply (Uniswap pools are
 * keyed on tier, so the WETH/USDC 0.3% pool and the WETH/USDC
 * 0.05% pool are different contracts).
 */
export const UNISWAP_V3_FEE_TIERS = {
  ULTRA_LOW: 100,    // 0.01%
  LOW: 500,          // 0.05%
  MEDIUM: 3000,      // 0.3%  (default for most pairs)
  HIGH: 10000,       // 1%
} as const;

export type UniswapV3FeeTier =
  (typeof UNISWAP_V3_FEE_TIERS)[keyof typeof UNISWAP_V3_FEE_TIERS];

// ─── Config ────────────────────────────────────────────────

export interface UniswapV3SwapVenueConfig {
  /** Stable id surfaced in `Fill.metadata.venueId`. */
  readonly id?: string;

  /** Chain the venue operates on. Must equal swap-solver's provider chainId. */
  readonly chainId: number;

  /**
   * QuoterV2 contract address. Uniswap canonical addresses (where
   * relevant — operators on bespoke deployments configure their own):
   *
   *   - Ethereum mainnet: 0x61fFE014bA17989E743c5F6cB21bF9697530B21e
   *   - Base mainnet:     0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a
   *   - Polygon mainnet:  0x61fFE014bA17989E743c5F6cB21bF9697530B21e
   *   - Arbitrum:         0x61fFE014bA17989E743c5F6cB21bF9697530B21e
   */
  readonly quoterAddress: `0x${string}`;

  /**
   * SwapRouter02 contract address. Same addresses as Quoter on
   * most chains (Uniswap deploys them deterministically).
   *
   *   - Ethereum mainnet: 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
   *   - Base mainnet:     0x2626664c2603336E57B271c5C0b26F421741e481
   *   - Polygon mainnet:  0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
   *   - Arbitrum:         0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45
   */
  readonly swapRouterAddress: `0x${string}`;

  /** JSON-RPC transport for QuoterV2 eth_call lookups. */
  readonly transport: Eth_RpcTransport;

  /**
   * Default fee tier when no per-pair entry exists in `feeTiers`.
   * Default: 3000 (0.3% — covers most volatile pairs).
   */
  readonly defaultFeeTier?: UniswapV3FeeTier;

  /**
   * Per-pair fee tier overrides. Key format: lowercased
   * `<sellAsset>-<buyAsset>` OR `<buyAsset>-<sellAsset>` (the venue
   * normalises both directions). Use `pairKey()` from `index.ts`
   * to construct correctly.
   *
   * Example:
   * ```ts
   * feeTiers: new Map([
   *   [pairKey(USDC, USDT), 100],   // stable pair → 0.01%
   *   [pairKey(WETH, USDC), 500],   // ETH/USDC → 0.05%
   * ]),
   * ```
   */
  readonly feeTiers?: ReadonlyMap<string, UniswapV3FeeTier>;

  /**
   * Per-pair multi-hop path overrides (PR #106). Keyed by
   * `pairKey(sellAsset, buyAsset)`. When a pair is present here,
   * the venue uses `quoteExactInput` (multi-hop) instead of
   * `quoteExactInputSingle` (single-hop) for that pair, and
   * `exactInput` instead of `exactInputSingle` for the swap.
   *
   * The path's first token MUST equal `sellAsset` and last token
   * MUST equal `buyAsset` — both directions of the pair share the
   * same path (the venue normalizes pairKey for both directions
   * but uses the path verbatim from the operator's perspective).
   *
   * Example:
   *
   * ```ts
   * multiHopPaths: new Map([
   *   [pairKey(USDC, DAI), {
   *     tokens: [USDC, WETH, DAI],
   *     fees: [500, 3000],
   *   }],
   * ]),
   * ```
   *
   * Single-hop remains the default for pairs NOT in this map.
   * Operators wanting to route the same pair both ways
   * (USDC→DAI and DAI→USDC through different paths) currently
   * must register two pair keys; future enhancement could allow
   * direction-specific paths.
   */
  readonly multiHopPaths?: ReadonlyMap<string, MultiHopPath>;

  /**
   * Optional override for `sqrtPriceLimitX96`. Default 0 means
   * "no price limit" — the swap will execute at whatever price
   * results. Operators wanting to enforce a maximum slippage
   * boundary at the pool level set this to a non-zero value.
   * Most consumers leave it at default; the swap-solver's
   * `amountOutMinimum` already provides the floor.
   */
  readonly sqrtPriceLimitX96?: bigint;

  /**
   * The agent's address whose ERC-20 allowance is checked when
   * `skipApproveWhenSufficient` is true. Required when that flag
   * is set; ignored otherwise (the v0.1 unconditional-approve
   * flow doesn't need to know the owner).
   *
   * Typically passed as `intent.envelope.creator` from the
   * swap-solver, but the swap-solver doesn't currently expose
   * `from` to the venue's `buildSwapTxs`. Operators wiring this
   * venue into a SwapSolver must configure `agentAddress` to
   * match the SwapSolver's `from` address.
   */
  readonly agentAddress?: `0x${string}`;

  /**
   * When `true`, the venue calls `allowance(agentAddress,
   * swapRouterAddress)` via `eth_call` BEFORE deciding to emit
   * an approve tx. If the existing allowance is ≥ amountIn, the
   * approve is skipped and `buildSwapTxs` returns just the
   * single swap tx.
   *
   * **Default: `false`** — preserves PR #94's v0.1 behavior
   * (unconditional approve). Opting in saves one tx of gas per
   * swap on repeat swaps from the same agent.
   *
   * Production consumers using a custody backend that issues
   * `approve(MAX_UINT256)` once per token at agent setup should
   * set this to `true` — the per-swap approve becomes
   * unnecessary noise.
   *
   * Requires `agentAddress` to be set.
   */
  readonly skipApproveWhenSufficient?: boolean;

  /**
   * When set to a positive number AND
   * `skipApproveWhenSufficient: true`, the venue caches
   * `allowance(owner, spender)` results for this many
   * milliseconds. On a cache hit (entry not stale), the venue
   * skips the `eth_call` entirely — saving an RPC round-trip
   * per swap.
   *
   * Cache is per-venue-instance and per-token. After the venue
   * decides to skip approve, the cached value is decremented by
   * `amountIn` (upper-bound semantic) — if the swap reverts on
   * chain, the next swap's pre-flight will emit a fresh approve
   * unnecessarily but never break.
   *
   * `MAX_UINT256` (>= 2^200) is treated as unlimited — not
   * decremented, doesn't drift from consumption. Agents that
   * pre-approve `type(uint256).max` enjoy zero RPC overhead per
   * swap until the TTL expires.
   *
   * Default `undefined` — no caching, every swap pre-flights.
   *
   * Recommended: `300_000` (5 min) for steady-state agent
   * workloads; lower if external state can change frequently
   * (e.g., concurrent transferFrom from another flow).
   */
  readonly allowanceCacheTtlMs?: number;

  /**
   * Clock override for cache TTL checks. Default `() => Date.now()`.
   * Test doubles use a controllable clock to advance time
   * without `setTimeout`.
   */
  readonly now?: () => number;

  /**
   * Pluggable cache backend. Default: `InMemoryAllowanceCache`
   * (per-venue-instance Map). Operators with multi-process
   * deployments — or wanting cache state to survive restarts —
   * pass a Redis / KV-store / cloud-cache implementation
   * matching the `AllowanceCache` interface.
   *
   * The cache is treated as an optimization, never a
   * correctness dependency. Failures (`get` / `set` / `clear`
   * throwing) are silently treated as cache miss / no-op; the
   * venue falls through to fresh eth_call. Operators wanting
   * to surface cache errors should wrap their backend impl
   * with their own logging.
   *
   * No effect when `allowanceCacheTtlMs` is unset or 0.
   */
  readonly allowanceCache?: AllowanceCache;

  /**
   * Optional cache-metrics recorder (PR #102). When set, the
   * venue emits hit / miss / stale events for every allowance-
   * cache lookup, letting operators answer:
   *
   *   - "Is the cache helping?" → hit_rate = hits / (hits + misses + stales)
   *   - "Is the TTL too short?" → high stale_rate vs miss_rate
   *   - "Is the backend healthy?" → miss_rate elevated when set()
   *     should be populating it (Redis disconnect, etc.)
   *
   * No events are emitted when caching is disabled
   * (`allowanceCacheTtlMs` undefined or 0) — the cache isn't
   * being consulted at all.
   *
   * The recorder shape is intentionally minimal (3 methods, no
   * labels) so the venue stays decoupled from any specific
   * meter implementation. Operators bridge to
   * `@aethelred/wallet-observability` (or OpenTelemetry SDK,
   * prom-client, etc.) inside their adapter — see
   * `metrics.ts` JSDoc for a full example.
   *
   * Default: `NOOP_ALLOWANCE_CACHE_METRICS_RECORDER` (no-op).
   */
  readonly allowanceCacheMetrics?: AllowanceCacheMetricsRecorder;
}

// ─── Venue data threaded through the SwapVenue contract ────

/**
 * Opaque payload returned by `quote()` and consumed by
 * `buildSwapTxs()` / `decodeFillAmount()`. The `SwapVenue`
 * interface treats this as `unknown`; the venue uses it to
 * thread the per-quote fee tier and other state.
 *
 * For single-hop quotes (the default), `feeTier` is the chosen
 * pool's tier and `path` is undefined.
 *
 * For multi-hop quotes (PR #106), `path` contains the resolved
 * `MultiHopPath` and `feeTier` is set to the FIRST hop's fee
 * tier (preserved for backward compatibility with consumers
 * that read `feeTier` directly; multi-hop consumers should
 * inspect `path` instead). `sqrtPriceX96After` is `0n` for
 * multi-hop quotes — the per-pool prices don't compose into a
 * single venue-data scalar.
 */
export interface UniswapV3VenueData {
  readonly feeTier: UniswapV3FeeTier;
  readonly expectedBuyAmount: bigint;
  readonly sqrtPriceX96After: bigint;
  /** Set when this quote routes through multiple pools (PR #106). */
  readonly path?: MultiHopPath;
}

// ─── Errors ────────────────────────────────────────────────

export type UniswapV3VenueErrorCode =
  | "no-liquidity"
  | "quoter-call-failed"
  | "quoter-decode-failed"
  | "swap-decode-failed"
  | "missing-pool-event"
  | "invalid-asset-address"
  | "chain-id-mismatch";

export class UniswapV3VenueError extends Error {
  readonly code: UniswapV3VenueErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: UniswapV3VenueErrorCode,
    message: string,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message);
    this.name = "UniswapV3VenueError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}
