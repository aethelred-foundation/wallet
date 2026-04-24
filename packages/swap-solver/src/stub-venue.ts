/**
 * `StubSwapVenue` — deterministic in-memory `SwapVenue` for tests
 * and demos.
 *
 * Why it ships in the package proper (not just `test/`):
 *
 *   - The `@aethelred/wallet-integration` demo needs to exercise
 *     the swap-solver end-to-end without a real DEX. A stub in this
 *     package keeps that demo zero-dep.
 *   - Downstream packages writing their own venue adapters need a
 *     reference implementation showing the contract.
 *   - Test doubles in solver.test.ts can re-use it for
 *     happy-path assertions.
 *
 * What it does:
 *
 *   - Holds a configured `priceRatio` (buy per sell, as a fixed-point
 *     fraction so we can stay in bigint-land).
 *   - Returns `sellAmount * priceRatio` as the expected buy amount.
 *   - Emits a single-tx sequence labelled `"swap"`. The tx's `to` is
 *     the venue's configured router address, `data` is
 *     deterministically derived from the input params (for test
 *     assertability), `value` is the sellAmount if sellAsset is the
 *     native sentinel.
 *   - `decodeFillAmount` reads from a scripted receipt-to-amount
 *     map (tests seed this). Absent entry → 0n.
 *
 * What it does NOT do:
 *
 *   - Talk to a real AMM. Use
 *     `@aethelred/wallet-swap-venue-uniswap-v3` (or similar) for
 *     production deployments.
 *   - Perform approval. The stub assumes allowance is unlimited —
 *     matches the test scenario where the provider's `sendTransaction`
 *     is an in-memory queue, not a real chain.
 */

import type {
  SwapBuildParams,
  SwapQuoteParams,
  SwapQuoteResult,
  SwapTxReceipt,
  SwapTxRequest,
  SwapVenue,
} from "./types";

const NATIVE_SENTINEL = "0x0000000000000000000000000000000000000000";

export interface StubSwapVenueConfig {
  readonly id: string;
  readonly chainId: number;
  /** Router address the stub submits against. */
  readonly router: `0x${string}`;
  /**
   * Fixed-point price: buyAmount = sellAmount * priceNumerator /
   * priceDenominator. Using two bigints instead of a float keeps
   * everything exact.
   */
  readonly priceNumerator: bigint;
  readonly priceDenominator: bigint;
  /**
   * Pairs the stub can route, keyed `sellAsset-buyAsset` (lowercased).
   * Absent pair → `quote()` returns null (no-liquidity).
   *
   * Default: all pairs routable.
   */
  readonly routablePairs?: ReadonlyArray<string>;
  /**
   * Scripted receipt-hash → decoded buy amount map used by
   * `decodeFillAmount`. Tests seed this directly.
   *
   * If the receipt's txHash isn't in the map, falls back to
   * `venueData.expectedBuyAmount` threaded through `buildSwapTxs`
   * so happy-path tests "just work" without explicit seeding.
   */
  readonly scriptedDecodes?: ReadonlyMap<`0x${string}`, bigint>;
  /** Force `quote()` to return null (simulate no-liquidity). */
  readonly forceNoLiquidity?: boolean;
  /** Force `buildSwapTxs` to throw (simulate venue-build-failed). */
  readonly forceBuildThrow?: Error;
  /** Force `decodeFillAmount` to throw (simulate venue-decode-failed). */
  readonly forceDecodeThrow?: Error;
}

export class StubSwapVenue implements SwapVenue {
  readonly id: string;
  readonly chainId: number;

  private readonly config: StubSwapVenueConfig;

  constructor(config: StubSwapVenueConfig) {
    if (config.priceDenominator <= 0n) {
      throw new Error("StubSwapVenue: priceDenominator must be positive");
    }
    if (config.priceNumerator < 0n) {
      throw new Error("StubSwapVenue: priceNumerator must be non-negative");
    }
    this.config = config;
    this.id = config.id;
    this.chainId = config.chainId;
  }

  async quote(params: SwapQuoteParams): Promise<SwapQuoteResult | null> {
    if (this.config.forceNoLiquidity) return null;
    if (params.chainId !== this.chainId) return null;

    const pairKey = pairOf(params.sellAsset, params.buyAsset);
    if (this.config.routablePairs && !this.config.routablePairs.includes(pairKey)) {
      return null;
    }

    const expectedBuyAmount =
      (params.sellAmount * this.config.priceNumerator) /
      this.config.priceDenominator;
    if (expectedBuyAmount <= 0n) return null;

    return {
      expectedBuyAmount,
      // Thread the expected amount through so `decodeFillAmount` can
      // fall back to it when the tests don't seed a scripted decode.
      venueData: { expectedBuyAmount },
    };
  }

  async buildSwapTxs(
    params: SwapBuildParams,
  ): Promise<ReadonlyArray<SwapTxRequest>> {
    if (this.config.forceBuildThrow) throw this.config.forceBuildThrow;

    // Deterministic pseudo-calldata: selector + padded amounts. The
    // exact bytes don't matter for tests; what matters is that the
    // same inputs produce the same bytes (replayable).
    const selector = "0x12345678" as const; // stub "swap(...)" selector
    const sellHex = params.sellAmount.toString(16).padStart(64, "0");
    const minOutHex = params.amountOutMinimum.toString(16).padStart(64, "0");
    const recipientHex = params.recipient.slice(2).padStart(64, "0").toLowerCase();
    const deadlineHex = BigInt(params.deadlineMs).toString(16).padStart(64, "0");
    const sellAssetHex = params.sellAsset.slice(2).padStart(64, "0").toLowerCase();
    const buyAssetHex = params.buyAsset.slice(2).padStart(64, "0").toLowerCase();
    const data =
      (selector +
        sellAssetHex +
        buyAssetHex +
        sellHex +
        minOutHex +
        recipientHex +
        deadlineHex) as `0x${string}`;

    const isNativeSell = params.sellAsset.toLowerCase() === NATIVE_SENTINEL;

    return [
      {
        to: this.config.router,
        data,
        value: isNativeSell ? params.sellAmount : undefined,
        label: "swap",
      },
    ];
  }

  decodeFillAmount(params: {
    readonly receipt: SwapTxReceipt;
    readonly recipient: `0x${string}`;
    readonly buyAsset: `0x${string}`;
    readonly venueData?: unknown;
  }): bigint {
    if (this.config.forceDecodeThrow) throw this.config.forceDecodeThrow;

    // Use scripted map if present and key matches.
    const hash = params.receipt.transactionHash;
    const scripted = this.config.scriptedDecodes?.get(hash);
    if (scripted !== undefined) return scripted;

    // Otherwise fall back to the venueData.expectedBuyAmount —
    // simulates "venue executed at mid-price, no slippage."
    if (
      params.venueData &&
      typeof params.venueData === "object" &&
      "expectedBuyAmount" in params.venueData &&
      typeof (params.venueData as { expectedBuyAmount: unknown })
        .expectedBuyAmount === "bigint"
    ) {
      return (params.venueData as { expectedBuyAmount: bigint }).expectedBuyAmount;
    }

    return 0n;
  }
}

/** Lowercase `sellAsset-buyAsset` pair key — exported so tests can build the same keys. */
export function pairOf(
  sellAsset: `0x${string}`,
  buyAsset: `0x${string}`,
): string {
  return `${sellAsset.toLowerCase()}-${buyAsset.toLowerCase()}`;
}
