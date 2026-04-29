/**
 * `UniswapV3SwapVenue` — concrete `SwapVenue` (from
 * `@aethelred/wallet-swap-solver`) backed by Uniswap v3.
 *
 * Single-hop only for v0.1: the venue resolves a `(sellAsset,
 * buyAsset)` pair to ONE pool (chosen by fee tier) and submits a
 * single `exactInputSingle` call. Multi-hop routing is a future
 * extension — operators with multi-hop needs configure their
 * own venue or use a 1inch / 0x adapter.
 *
 * Lifecycle (matches the SwapVenue interface contract):
 *
 *   quote(params) ──▶ QuoterV2.quoteExactInputSingle via eth_call
 *                      │
 *                      └─▶ { expectedBuyAmount, venueData }
 *
 *   buildSwapTxs(params) ──▶ [
 *     { label: "approve", to: sellAsset,        data: erc20.approve(router, amountIn) },
 *     { label: "swap",    to: swapRouterAddress, data: exactInputSingle(...) },
 *   ]
 *
 *   decodeFillAmount(params) ──▶ scan receipt.logs for the v3
 *                                 Swap event(s) that delivered to
 *                                 `recipient`; sum the negated
 *                                 buy-side delta(s).
 *
 * Native asset (ETH) handling: NOT supported in v0.1. v3 deals
 * in WETH; operators wanting to swap ETH must wrap to WETH
 * upstream OR configure the venue against a different router
 * that supports `unwrapWETH9` (SwapRouter02 supports this via
 * multicall, but adds complexity we defer).
 *
 * Why single-hop is enough to validate the abstraction:
 * single-hop covers the most common case (~90% of v3 retail
 * traffic per Uniswap analytics). It also exercises every
 * concern the abstraction worried about — quote ↔ settle
 * coupling, approval flow, on-chain `amountOutMinimum`,
 * multi-tx sequencing, log decoding. Multi-hop adds path
 * encoding + multi-pool routing logic but doesn't surface new
 * `SwapVenue` contract questions.
 */

import type {
  SwapBuildParams,
  SwapQuoteParams,
  SwapQuoteResult,
  SwapTxReceipt,
  SwapTxRequest,
  SwapVenue,
} from "@aethelred/wallet-swap-solver";

import {
  type AllowanceCache,
  InMemoryAllowanceCache,
} from "./allowance-cache";
import {
  type AllowanceCacheMetricsRecorder,
  NOOP_ALLOWANCE_CACHE_METRICS_RECORDER,
} from "./metrics";
import {
  decodeErc20AllowanceResult,
  decodeQuoteExactInputSingleResult,
  encodeErc20Allowance,
  encodeErc20Approve,
  encodeExactInputSingle,
  encodeQuoteExactInputSingle,
} from "./encoder";
import { extractBuyAmount } from "./decoder";
import {
  UniswapV3VenueError,
  UNISWAP_V3_FEE_TIERS,
  type UniswapV3FeeTier,
  type UniswapV3SwapVenueConfig,
  type UniswapV3VenueData,
} from "./types";

const DEFAULT_FEE_TIER: UniswapV3FeeTier = UNISWAP_V3_FEE_TIERS.MEDIUM;
const DEFAULT_ID = "uniswap-v3";

export class UniswapV3SwapVenue implements SwapVenue {
  readonly id: string;
  readonly chainId: number;

  private readonly config: UniswapV3SwapVenueConfig;
  private readonly now: () => number;
  /**
   * Pluggable allowance cache (PR #99). Defaults to
   * `InMemoryAllowanceCache` (per-venue Map) when the operator
   * doesn't supply one. Operators with multi-process deployments
   * pass a Redis / KV-store impl matching the `AllowanceCache`
   * interface.
   *
   * The cache is meaningful ONLY when both
   * `skipApproveWhenSufficient: true` AND
   * `allowanceCacheTtlMs > 0` are set; otherwise reads + writes
   * are short-circuited inside readAllowanceCache /
   * writeAllowanceCache.
   */
  private readonly allowanceCache: AllowanceCache;

  /**
   * Pluggable cache-metrics recorder (PR #102). Defaults to a
   * no-op so the cache code paths have zero `if (recorder)`
   * branches. Operators who want hit/miss/stale telemetry pass
   * an adapter that bridges to their meter — see metrics.ts.
   */
  private readonly allowanceCacheMetrics: AllowanceCacheMetricsRecorder;

  /**
   * Anything ≥ this is treated as "unlimited" — not decremented
   * after a swap, doesn't expire due to consumption. Agents that
   * pre-approve `type(uint256).max` (≈ 1.15e77) trip this branch
   * naturally; nothing reasonable comes anywhere near. Threshold
   * 2^200 ≈ 1.6e60 leaves plenty of headroom while still being
   * comfortably lower than MAX_UINT256.
   */
  private static readonly UNLIMITED_THRESHOLD = 1n << 200n;

  constructor(config: UniswapV3SwapVenueConfig) {
    if (!isValidAddress(config.quoterAddress)) {
      throw new UniswapV3VenueError(
        "invalid-asset-address",
        `quoterAddress must be 20-byte hex, got "${config.quoterAddress}"`,
      );
    }
    if (!isValidAddress(config.swapRouterAddress)) {
      throw new UniswapV3VenueError(
        "invalid-asset-address",
        `swapRouterAddress must be 20-byte hex, got "${config.swapRouterAddress}"`,
      );
    }
    this.config = config;
    this.id = config.id ?? DEFAULT_ID;
    this.chainId = config.chainId;
    this.now = config.now ?? (() => Date.now());
    this.allowanceCache = config.allowanceCache ?? new InMemoryAllowanceCache();
    this.allowanceCacheMetrics =
      config.allowanceCacheMetrics ?? NOOP_ALLOWANCE_CACHE_METRICS_RECORDER;
  }

  /**
   * Drop all cached allowance entries. Operators call this when
   * external state changes invalidate the cache — e.g., a
   * non-swap path consumed allowance, or the agent rotated keys
   * and the on-chain allowance was reset.
   *
   * Idempotent. No effect when caching is disabled. Cache-impl
   * errors are swallowed: failure to clear remote state doesn't
   * propagate (the operator can retry, and stale entries naturally
   * expire via TTL).
   */
  async invalidateAllowanceCache(): Promise<void> {
    try {
      await this.allowanceCache.clear();
    } catch {
      // Swallow — cache failures don't break correctness.
    }
  }

  // ─── SwapVenue.quote ─────────────────────────────────

  async quote(params: SwapQuoteParams): Promise<SwapQuoteResult | null> {
    if (params.chainId !== this.chainId) return null;
    if (params.sellAmount <= 0n) return null;
    if (
      params.sellAsset.toLowerCase() === params.buyAsset.toLowerCase()
    ) {
      return null;
    }

    const fee = this.feeTierFor(params.sellAsset, params.buyAsset);
    const data = encodeQuoteExactInputSingle({
      tokenIn: params.sellAsset,
      tokenOut: params.buyAsset,
      amountIn: params.sellAmount,
      fee,
      sqrtPriceLimitX96: this.config.sqrtPriceLimitX96 ?? 0n,
    });

    let resultHex: `0x${string}`;
    try {
      resultHex = await this.config.transport.call<`0x${string}`>(
        "eth_call",
        [
          {
            to: this.config.quoterAddress,
            data,
          },
          "latest",
        ],
      );
    } catch (cause) {
      // eth_call to QuoterV2 reverts when there's no liquidity
      // for the requested pair/tier. We return null instead of
      // throwing so the swap-solver treats this as a normal
      // decline (no liquidity → try another solver / venue /
      // fee tier).
      const message =
        cause instanceof Error ? cause.message.toLowerCase() : "";
      if (
        message.includes("revert") ||
        message.includes("execution reverted") ||
        message.includes("invalid pool")
      ) {
        return null;
      }
      // Unexpected error — surface to the caller. The
      // swap-solver wraps this as `venue-quote-failed`.
      throw new UniswapV3VenueError(
        "quoter-call-failed",
        `eth_call to QuoterV2 failed: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause },
      );
    }

    let decoded;
    try {
      decoded = decodeQuoteExactInputSingleResult(resultHex);
    } catch (cause) {
      throw new UniswapV3VenueError(
        "quoter-decode-failed",
        `failed to decode QuoterV2 result: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause, details: { resultHex } },
      );
    }

    if (decoded.amountOut <= 0n) {
      return null;
    }

    const venueData: UniswapV3VenueData = {
      feeTier: fee,
      expectedBuyAmount: decoded.amountOut,
      sqrtPriceX96After: decoded.sqrtPriceX96After,
    };

    return {
      expectedBuyAmount: decoded.amountOut,
      venueData,
    };
  }

  // ─── SwapVenue.buildSwapTxs ─────────────────────────

  async buildSwapTxs(
    params: SwapBuildParams,
  ): Promise<ReadonlyArray<SwapTxRequest>> {
    const fee = this.feeTierFromVenueData(params.venueData);

    // Allowance pre-flight: when configured, query the existing
    // allowance via eth_call and skip the approve tx when it's
    // already ≥ amountIn. Saves one on-chain tx per repeat swap.
    //
    // The pre-flight is opt-in (preserves PR #94's v0.1
    // unconditional-approve behavior) and requires
    // `agentAddress` to be configured. Without it, we have no
    // owner to query.
    const skipApprove = await this.shouldSkipApprove(
      params.sellAsset,
      params.sellAmount,
    );

    const swapTx: SwapTxRequest = {
      to: this.config.swapRouterAddress,
      data: encodeExactInputSingle({
        tokenIn: params.sellAsset,
        tokenOut: params.buyAsset,
        fee,
        recipient: params.recipient,
        amountIn: params.sellAmount,
        amountOutMinimum: params.amountOutMinimum,
        sqrtPriceLimitX96: this.config.sqrtPriceLimitX96 ?? 0n,
      }),
      label: "swap",
    };

    if (skipApprove) {
      // Single-tx sequence: existing allowance covers the swap.
      return [swapTx];
    }

    const approveTx: SwapTxRequest = {
      to: params.sellAsset,
      data: encodeErc20Approve(this.config.swapRouterAddress, params.sellAmount),
      label: "approve",
    };
    return [approveTx, swapTx];
  }

  /**
   * Decide whether `approve` can be skipped based on a
   * pre-flight `allowance` lookup.
   *
   * Cache layer (PR #98):
   *   - On hit + not stale: skip the eth_call entirely; use the
   *     cached value directly.
   *   - On miss / stale: fall through to eth_call as before;
   *     populate the cache with the fresh value.
   *
   * After deciding to skip approve, decrement the cached value
   * by `sellAmount` (upper-bound semantic — see the
   * `allowanceCacheTtlMs` doc on `UniswapV3SwapVenueConfig`).
   * MAX_UINT256-class allowances aren't decremented.
   *
   * Returns `false` (always emit approve) when the optimization
   * is disabled OR when the lookup itself fails — fail-closed
   * semantics keep us safe against pathological RPC behaviour.
   */
  private async shouldSkipApprove(
    sellAsset: `0x${string}`,
    sellAmount: bigint,
  ): Promise<boolean> {
    if (!this.config.skipApproveWhenSufficient) return false;
    if (!this.config.agentAddress) {
      return false;
    }

    const cacheKey = this.allowanceCacheKey(sellAsset);
    const cached = await this.readAllowanceCache(cacheKey);

    let existing: bigint;
    if (cached !== null) {
      existing = cached;
    } else {
      // Cache miss / stale / disabled — fetch fresh.
      let resultHex: `0x${string}`;
      try {
        resultHex = await this.config.transport.call<`0x${string}`>(
          "eth_call",
          [
            {
              to: sellAsset,
              data: encodeErc20Allowance(
                this.config.agentAddress,
                this.config.swapRouterAddress,
              ),
            },
            "latest",
          ],
        );
      } catch {
        return false;
      }
      try {
        existing = decodeErc20AllowanceResult(resultHex);
      } catch {
        return false;
      }
      await this.writeAllowanceCache(cacheKey, existing);
    }

    if (existing < sellAmount) return false;

    // Decrement the cached value by what we're about to use.
    // MAX_UINT256-class allowances are preserved unchanged.
    if (existing < UniswapV3SwapVenue.UNLIMITED_THRESHOLD) {
      await this.writeAllowanceCache(cacheKey, existing - sellAmount);
    }
    return true;
  }

  // ─── Allowance cache helpers ────────────────────────

  private allowanceCacheKey(sellAsset: `0x${string}`): string {
    // Owner + spender are venue-scoped (constructor-fixed), so
    // the key only needs the asset. We include the spender
    // anyway in case operators ever swap routerAddress.
    return [
      sellAsset.toLowerCase(),
      (this.config.agentAddress ?? "").toLowerCase(),
      this.config.swapRouterAddress.toLowerCase(),
    ].join("-");
  }

  /**
   * Read from cache. Returns the cached value when:
   *   - Caching is enabled (positive TTL).
   *   - Entry exists.
   *   - Entry isn't stale (now - recordedAt < TTL).
   * Returns `null` on miss / disabled / stale.
   *
   * Cache-impl errors (e.g., Redis disconnect) are silently
   * treated as cache miss — fail-closed semantics. The cache
   * is an optimization, never a correctness dependency.
   */
  private async readAllowanceCache(key: string): Promise<bigint | null> {
    const ttl = this.config.allowanceCacheTtlMs;
    // Caching disabled — emit no metrics events. The cache isn't
    // being consulted at all; ops people don't want every "no
    // cache configured" call counted.
    if (ttl === undefined || ttl <= 0) return null;
    let entry: { allowance: bigint; recordedAt: number } | null;
    try {
      entry = await this.allowanceCache.get(key);
    } catch {
      // Cache backend failure — treat as miss (fail-closed).
      // Counted as miss in metrics so backend flakiness shows up
      // as elevated miss rate; operators wanting to distinguish
      // backend errors from genuine misses wrap their cache
      // implementation in a logging shim.
      this.allowanceCacheMetrics.recordMiss();
      return null;
    }
    if (!entry) {
      this.allowanceCacheMetrics.recordMiss();
      return null;
    }
    if (this.now() - entry.recordedAt >= ttl) {
      // Stale — return null. The next pre-flight will fetch
      // fresh and overwrite this entry naturally via
      // writeAllowanceCache. We don't have a `delete` on the
      // interface, so stale entries linger until rewritten,
      // but they don't affect correctness (every read re-checks
      // the timestamp). Distinct event from "miss" so operators
      // can spot "TTL too short" vs "cache not populating."
      this.allowanceCacheMetrics.recordStale();
      return null;
    }
    this.allowanceCacheMetrics.recordHit();
    return entry.allowance;
  }

  /**
   * Write to cache when caching is enabled. No-op otherwise.
   * Stamps `recordedAt` with the current clock so subsequent
   * reads can compute staleness. Cache-impl errors are swallowed
   * — write failures don't break the swap, just deny the
   * optimization for the next lookup.
   */
  private async writeAllowanceCache(
    key: string,
    allowance: bigint,
  ): Promise<void> {
    const ttl = this.config.allowanceCacheTtlMs;
    if (ttl === undefined || ttl <= 0) return;
    try {
      await this.allowanceCache.set(key, {
        allowance,
        recordedAt: this.now(),
      });
    } catch {
      // Swallow.
    }
  }

  // ─── SwapVenue.decodeFillAmount ─────────────────────

  decodeFillAmount(params: {
    readonly receipt: SwapTxReceipt;
    readonly recipient: `0x${string}`;
    readonly buyAsset: `0x${string}`;
    readonly venueData?: unknown;
  }): bigint {
    // Pull sellAsset from venueData when available — needed for
    // the token0/token1 ordering check in extractBuyAmount.
    // venueData isn't required to carry sellAsset, so we fall
    // back to "scan all matching swap events and pick whichever
    // negative side delivered to the recipient".
    const venueData = params.venueData as
      | (UniswapV3VenueData & { readonly sellAsset?: `0x${string}` })
      | undefined;
    const sellAsset = venueData?.sellAsset;

    if (sellAsset) {
      // Strict path — we know the pair, so the token0/token1
      // discrimination is exact.
      return extractBuyAmount({
        logs: params.receipt.logs,
        recipient: params.recipient,
        buyAsset: params.buyAsset,
        sellAsset,
      });
    }

    // Fallback: try both possible orderings and return the larger
    // matching delta. In single-hop v0.1 there's exactly one
    // pool; the larger delta IS the correct buyAmount.
    const a = extractBuyAmount({
      logs: params.receipt.logs,
      recipient: params.recipient,
      buyAsset: params.buyAsset,
      // Use a sentinel sellAsset that's guaranteed to be lexicographically
      // greater than any address (all-Fs).
      sellAsset: ("0x" + "ff".repeat(20)) as `0x${string}`,
    });
    const b = extractBuyAmount({
      logs: params.receipt.logs,
      recipient: params.recipient,
      buyAsset: params.buyAsset,
      // ...and lexicographically less (all zeros).
      sellAsset: ("0x" + "00".repeat(20)) as `0x${string}`,
    });
    return a > b ? a : b;
  }

  // ─── Internals ──────────────────────────────────────

  /**
   * Resolve the fee tier to use for a given pair. Per-pair
   * config wins; otherwise default. Pair lookup tries both
   * directions (sell-buy and buy-sell) so operators don't need
   * to enumerate every direction.
   */
  private feeTierFor(
    sellAsset: `0x${string}`,
    buyAsset: `0x${string}`,
  ): UniswapV3FeeTier {
    const tiers = this.config.feeTiers;
    if (!tiers) return this.config.defaultFeeTier ?? DEFAULT_FEE_TIER;
    const sellLower = sellAsset.toLowerCase();
    const buyLower = buyAsset.toLowerCase();
    const forward = `${sellLower}-${buyLower}`;
    const reverse = `${buyLower}-${sellLower}`;
    return (
      tiers.get(forward) ??
      tiers.get(reverse) ??
      this.config.defaultFeeTier ??
      DEFAULT_FEE_TIER
    );
  }

  private feeTierFromVenueData(venueData: unknown): UniswapV3FeeTier {
    if (
      venueData &&
      typeof venueData === "object" &&
      "feeTier" in venueData &&
      typeof (venueData as { feeTier: unknown }).feeTier === "number"
    ) {
      return (venueData as UniswapV3VenueData).feeTier;
    }
    // Degraded path: caller didn't thread venueData. Use default
    // tier — may produce a different result than the original
    // quote if the default differs from the quote-time tier.
    // Document this in the README and discourage it.
    return this.config.defaultFeeTier ?? DEFAULT_FEE_TIER;
  }
}

// ─── Helpers ──────────────────────────────────────────────

function isValidAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Build the lookup key the venue uses for `feeTiers` — lower-cased
 * `<sellAsset>-<buyAsset>`. The venue lookup tries both directions,
 * so callers can pick either ordering when configuring.
 */
export function pairKey(
  asset0: `0x${string}`,
  asset1: `0x${string}`,
): string {
  return `${asset0.toLowerCase()}-${asset1.toLowerCase()}`;
}
