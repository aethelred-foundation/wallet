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
   * Optional override for `sqrtPriceLimitX96`. Default 0 means
   * "no price limit" — the swap will execute at whatever price
   * results. Operators wanting to enforce a maximum slippage
   * boundary at the pool level set this to a non-zero value.
   * Most consumers leave it at default; the swap-solver's
   * `amountOutMinimum` already provides the floor.
   */
  readonly sqrtPriceLimitX96?: bigint;
}

// ─── Venue data threaded through the SwapVenue contract ────

/**
 * Opaque payload returned by `quote()` and consumed by
 * `buildSwapTxs()` / `decodeFillAmount()`. The `SwapVenue`
 * interface treats this as `unknown`; the venue uses it to
 * thread the per-quote fee tier and other state.
 */
export interface UniswapV3VenueData {
  readonly feeTier: UniswapV3FeeTier;
  readonly expectedBuyAmount: bigint;
  readonly sqrtPriceX96After: bigint;
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
