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
  decodeQuoteExactInputSingleResult,
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

    // Two-tx sequence: approve the router for `amountIn` of the
    // sellAsset, then call exactInputSingle. Approval is
    // unconditional in v0.1 — production deployments should
    // pre-flight allowance and skip the approve when sufficient
    // (open question, tracked as future work).
    const approveTx: SwapTxRequest = {
      to: params.sellAsset,
      data: encodeErc20Approve(this.config.swapRouterAddress, params.sellAmount),
      label: "approve",
    };

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

    return [approveTx, swapTx];
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
