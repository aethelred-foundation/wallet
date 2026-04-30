/**
 * `@aethelred/wallet-swap-solver` — type surface.
 *
 * Four logical groups:
 *
 *   1. `SwapChainProvider` — re-exported alias for
 *      `AnchorChainProvider` (same pattern as transfer-solver). The
 *      solver doesn't need anything chain-provider-specific; it just
 *      submits whichever tx sequence the venue produces.
 *
 *   2. `SwapVenue` — the pluggability surface. Any DEX adapter
 *      (Uniswap v3, CoW, 1inch, a bespoke liquidity venue) that can
 *      quote a price and emit a tx sequence + receipt decoder
 *      satisfies this interface. The solver stays venue-agnostic.
 *
 *   3. Config + metadata types.
 *
 *   4. Re-exports from intent-router.
 */

import type {
  AnchorChainProvider,
  TxReceipt,
} from "@aethelred/wallet-notarization";

import type {
  Fill,
  Intent,
  Quote,
  Solver,
  SwapIntentBody,
} from "@aethelred/wallet-intent-router";

// ─── Chain provider ────────────────────────────────

/**
 * Minimal chain provider the swap solver needs. Same shape as
 * `TransferChainProvider` — both are aliases for
 * `AnchorChainProvider` so `RpcAnchorChainProvider` from
 * `@aethelred/wallet-rpc-adapters` drops in unchanged.
 */
export type SwapChainProvider = AnchorChainProvider;

/** Same as above but for reading transaction receipts. */
export type SwapTxReceipt = TxReceipt;

// ─── Venue ─────────────────────────────────────────

/**
 * Parameters a venue needs to produce a quote / build a swap.
 *
 * Deliberately narrower than the full `SwapIntentBody` — the venue
 * doesn't need the intent envelope or recipient address for pricing;
 * those get wired in at `buildSwapTxs` time. This separation lets
 * venues cache quotes keyed on `(sellAsset, sellAmount, buyAsset,
 * chainId)` without leaking recipient-specific state.
 */
export interface SwapQuoteParams {
  readonly chainId: number;
  readonly sellAsset: `0x${string}`;
  readonly sellAmount: bigint;
  readonly buyAsset: `0x${string}`;
}

/**
 * A venue's quote response. `expectedBuyAmount` is the venue's
 * **mid-price estimate** (pre-slippage); the solver applies its
 * internal slippage buffer to derive the router `commitment`.
 *
 * `venueData` is an opaque payload the venue may thread through
 * `buildSwapTxs` (e.g. a Uniswap v3 pool path, a CoW batch ref, a
 * 1inch route blob). The solver treats it as a black box.
 */
export interface SwapQuoteResult {
  readonly expectedBuyAmount: bigint;
  readonly venueData?: unknown;
}

/**
 * Parameters a venue needs to assemble the on-chain tx sequence.
 *
 * `amountOutMinimum` is the on-chain revert threshold the venue
 * embeds into the swap call. It is computed from the solver's
 * commitment and — crucially — must be ≤ commitment so that a
 * successful tx guarantees `actualAmount ≥ commitment`.
 */
export interface SwapBuildParams extends SwapQuoteParams {
  readonly recipient: `0x${string}`;
  /** Committed output floor (router commitment). */
  readonly amountOutMinimum: bigint;
  /** Opaque passthrough from the quote step. */
  readonly venueData?: unknown;
  /** Unix-ms deadline after which the on-chain tx must revert. */
  readonly deadlineMs: number;
}

// ─── Exact-output (PR #118) ─────────────────────────────────

/**
 * Parameters for an exact-output quote — "what's the sell-side
 * cost to obtain exactly `buyAmount`?" Mirrors `SwapQuoteParams`
 * but flips the known/unknown axis.
 */
export interface SwapQuoteOutputParams {
  readonly chainId: number;
  readonly sellAsset: `0x${string}`;
  readonly buyAsset: `0x${string}`;
  /** Exact desired output amount. */
  readonly buyAmount: bigint;
}

/**
 * Exact-output quote response. `expectedSellAmount` is the
 * venue's mid-price estimate of the input cost; the solver
 * applies its internal slippage buffer to derive the
 * `amountInMaximum` ceiling.
 */
export interface SwapQuoteOutputResult {
  readonly expectedSellAmount: bigint;
  readonly venueData?: unknown;
}

/**
 * Parameters for assembling an exact-output swap tx sequence.
 * `amountInMaximum` is the on-chain revert threshold the venue
 * embeds — it MUST be ≥ the venue's quoted expectedSellAmount
 * (with slippage absorbed by the solver) so the on-chain swap
 * doesn't revert under normal price drift.
 */
export interface SwapBuildOutputParams extends SwapQuoteOutputParams {
  readonly recipient: `0x${string}`;
  /** Committed input ceiling (router authorizes up to this much). */
  readonly amountInMaximum: bigint;
  readonly venueData?: unknown;
  readonly deadlineMs: number;
}

/**
 * A single on-chain tx the solver submits. Same shape as
 * `AnchorChainProvider.sendTransaction({ to, data, value? })`.
 *
 * The venue may return multiple tx requests when the swap requires
 * a preparatory step (e.g. `approve(router, amount)` before the
 * swap, or a wrap-native step). The solver submits them
 * **sequentially**, awaiting each receipt before the next — any
 * failure aborts the rest. The LAST tx in the sequence is treated
 * as the swap itself; its receipt is passed to `decodeFillAmount`.
 */
export interface SwapTxRequest {
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  readonly value?: bigint;
  /**
   * Human-label for audit. `"approve"`, `"swap"`, `"wrap"`, etc.
   * Surfaced in `Fill.metadata.txLabels`.
   */
  readonly label: string;
}

/**
 * Venue contract. Implementations translate a swap intent into a
 * concrete tx sequence against a specific DEX. Stays decoupled from
 * the solver so swapping venues (Uniswap v3 → CoW → 1inch) doesn't
 * touch solver code.
 */
export interface SwapVenue {
  /** Human id — surfaces in `Fill.metadata.venueId`. */
  readonly id: string;
  /** Chain this venue operates on; used for fast-fail mismatch. */
  readonly chainId: number;

  /**
   * Produce a price quote or return `null` if the venue can't route
   * this pair (no liquidity, unsupported asset, etc.). Null is a
   * first-class decline — the solver translates it to a null quote
   * so the router tries other solvers/venues.
   */
  quote(params: SwapQuoteParams): Promise<SwapQuoteResult | null>;

  /**
   * Assemble the tx sequence that performs the swap. Called during
   * settle(); errors must be thrown (the solver wraps them as
   * `venue-build-failed`).
   */
  buildSwapTxs(params: SwapBuildParams): Promise<ReadonlyArray<SwapTxRequest>>;

  /**
   * Decode the buyAsset delivered to `recipient` from the final
   * swap tx's receipt. This is venue-specific — v3 reads `Swap`
   * event, CoW reads `Trade`, 1inch reads a router-internal
   * `Swapped` event. Returning 0n is legal (tx succeeded but no
   * tokens were received, e.g. a reverted inner call wrapped by
   * the venue router) — the solver compares against commitment
   * and throws `fill-below-commitment` accordingly.
   */
  decodeFillAmount(params: {
    readonly receipt: SwapTxReceipt;
    readonly recipient: `0x${string}`;
    readonly buyAsset: `0x${string}`;
    readonly venueData?: unknown;
  }): bigint;

  /**
   * Optional exact-output quote (PR #118). Implementations that
   * support fixed-output swaps (e.g., UniswapV3SwapVenue's
   * `quoteExactOutput` from PRs #113/#114) declare this method;
   * others leave it undefined.
   *
   * The solver's runtime check (`typeof venue.quoteExactOutput
   * === "function"`) determines whether an exactOutput intent
   * can be served by this venue.
   */
  readonly quoteExactOutput?: (
    params: SwapQuoteOutputParams,
  ) => Promise<SwapQuoteOutputResult | null>;

  /**
   * Optional exact-output tx builder (PR #118). Mirrors
   * `buildSwapTxs` for the exactOutput direction.
   */
  readonly buildExactOutputSwapTxs?: (
    params: SwapBuildOutputParams,
  ) => Promise<ReadonlyArray<SwapTxRequest>>;
}

// ─── Config ────────────────────────────────────────

export interface SwapSolverConfig {
  /** Stable solver id — surfaces everywhere. e.g. `swap:uniswap-v3:base`. */
  readonly id: string;
  readonly name: string;

  /**
   * The address swap txs are submitted FROM. Must equal
   * `intent.envelope.creator`.
   */
  readonly from: `0x${string}`;

  /** Chain provider the solver submits against. */
  readonly provider: SwapChainProvider;

  /** The venue adapter (Uniswap v3 / CoW / 1inch / stub for tests). */
  readonly venue: SwapVenue;

  /**
   * **Solver's own** slippage buffer, in basis points. Used for
   * both directions when no per-direction override is supplied.
   *
   * - **Exact-input:** floor = `expectedBuyAmount * (10_000 - internalSlippageBps) / 10_000`.
   *   The buffer NARROWS the buy-side floor so price drift between
   *   quote() and settle() doesn't trip the router's
   *   `actualAmount ≥ commitment` check.
   * - **Exact-output:** ceiling = `expectedSellAmount * (10_000 + internalSlippageBps) / 10_000`.
   *   The buffer WIDENS the sell-side ceiling so price drift
   *   doesn't make the on-chain `amountInMaximum` revert before
   *   the swap completes.
   *
   * Default 50 (0.5%). Independent from the intent's `slippageBps`,
   * which is the USER'S preference. The solver MUST still satisfy
   * the intent's bounds (`minBuyAmount` for exact-input,
   * `maxSellAmount` for exact-output).
   */
  readonly internalSlippageBps?: number;

  /**
   * Optional per-direction override for `internalSlippageBps` on
   * EXACT-OUTPUT intents (PR #122). When set, exact-output quote
   * + settle use this value instead of the unified
   * `internalSlippageBps`. Useful when the same solver serves
   * both directions but the underlying liquidity behaves
   * asymmetrically:
   *
   *   - Exact-input swaps absorb sell-side slippage (input is
   *     fixed; output varies).
   *   - Exact-output swaps absorb buy-side slippage (output is
   *     fixed; input varies).
   *
   * Production examples where direction-asymmetric values matter:
   *   - Tight-liquidity tokens where the buy-side slippage
   *     manifests differently than sell-side
   *   - Operator analytics showing different P&L outcomes per
   *     direction, motivating different ceilings
   *
   * Default: undefined → falls back to `internalSlippageBps`.
   */
  readonly internalSlippageBpsExactOutput?: number;

  /**
   * Optional allow-list of (sellAsset, buyAsset) pairs the solver
   * will route. Absent = accept any pair the venue can route.
   * Each pair is two lowercased addresses joined by `-`.
   */
  readonly allowedPairs?: ReadonlyArray<string>;

  /** Polling interval for receipt fetch, ms. Default 2_000. */
  readonly pollIntervalMs?: number;

  /** Max wall-clock wait per tx for confirmation, ms. Default 120_000. */
  readonly pollTimeoutMs?: number;

  /** Quote validity in ms. Default 30_000 (shorter than transfer — prices move). */
  readonly quoteValidityMs?: number;

  /** Estimated fill time declared on each quote. Default 20_000. */
  readonly estimatedFillTimeMs?: number;

  /** Clock override for deterministic testing. */
  readonly now?: () => number;

  /** Sleep override for testing (default: `setTimeout`-backed). */
  readonly sleep?: (ms: number) => Promise<void>;
}

// ─── Quote + Fill metadata ─────────────────────────

export interface SwapSolverQuoteMetadata {
  readonly solverClass: "swap";
  readonly chainId: number;
  readonly venueId: string;
  readonly sellAsset: `0x${string}`;
  readonly buyAsset: `0x${string}`;
  /** Direction discriminator (PR #118). Defaults to `"exact-input"` for back-compat. */
  readonly direction?: "exact-input" | "exact-output";
  /** Set for exact-input quotes (the user-supplied input amount). */
  readonly sellAmount?: string;
  /** Set for exact-input quotes (venue's pre-slippage output estimate). */
  readonly expectedBuyAmount?: string;
  /** Set for exact-output quotes (the user-requested exact output amount). */
  readonly buyAmount?: string;
  /** Set for exact-output quotes (venue's pre-slippage input estimate). */
  readonly expectedSellAmount?: string;
  /** Solver's internal slippage buffer. */
  readonly internalSlippageBps: number;
  readonly [key: string]: unknown;
}

export interface SwapSolverFillMetadata {
  readonly solverClass: "swap";
  readonly chainId: number;
  readonly venueId: string;
  /** Receipts for every tx in the sequence (approve, swap, ...). */
  readonly receipts: ReadonlyArray<SwapTxReceipt>;
  /** Parallel to `receipts` — semantic label per tx. */
  readonly txLabels: ReadonlyArray<string>;
  /**
   * Sum of `gasUsed` across every receipt in the sequence. Omitted
   * when any receipt in the sequence lacked a `gasUsed` field
   * (can't partial-aggregate without double-counting later).
   * Observability pipelines sum this across fills; the multi-tx
   * sequence shape (approve → swap, etc.) means swap gas is
   * usually larger than transfer gas per intent.
   */
  readonly gasUsed?: bigint;
  /**
   * Sum of `gasUsed * effectiveGasPrice` across every receipt.
   * Omitted when any receipt lacked either field.
   */
  readonly gasCostWei?: bigint;
  /**
   * Per-tx gas breakdown, parallel to `receipts` + `txLabels`. Each
   * entry is the receipt's `gasUsed` or `null` if that receipt
   * omitted it. Lets dashboards chart approve-vs-swap gas separately.
   */
  readonly perTxGasUsed?: ReadonlyArray<bigint | null>;
  /**
   * Direction of the underlying intent (PR #132). Mirrors the same
   * field on `SwapSolverQuoteMetadata` so observability pipelines can
   * filter / chart fill outcomes by direction WITHOUT joining back
   * to the original intent. Always populated when the solver
   * produces a fill — the solver knows the direction by the time
   * settle reaches metadata construction (parsed at line ~512).
   *
   * Operators chart fill latency, gas cost, and revert rate per
   * direction with this; exact-output flows are price-spike-bounded
   * (different revert profile) and tend to use more gas (always
   * a `swap` plus often an `approve`), so dashboard segmentation
   * is genuinely useful.
   */
  readonly direction?: "exact-input" | "exact-output";
  readonly [key: string]: unknown;
}

// ─── Re-exports ────────────────────────────────────

export type { Fill, Intent, Quote, Solver, SwapIntentBody };
