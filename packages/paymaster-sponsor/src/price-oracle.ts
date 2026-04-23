/**
 * Price oracle implementations.
 *
 * Two ship here:
 *
 *   - `FixedPriceOracle` — for tests + local dev. Returns a
 *     caller-supplied price.
 *   - `CachingPriceOracle` — wraps any inner oracle with a TTL so
 *     the sponsor doesn't hit the underlying RPC on every request.
 *
 * Production oracles (Chainlink, Pyth, in-house feed) implement
 * `PriceOracle` and plug in behind the caching wrapper. We don't
 * ship a Chainlink adapter here to keep this package dep-free.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";

import type { PriceOracle, PriceQuote } from "./types";
import { PaymasterSponsorError } from "./errors";

/**
 * Scale factor used everywhere prices are stored. 1e18 is enough
 * precision for any expected ETH/USDC rate AND fits in a uint256.
 */
export const PRICE_SCALE = 10n ** 18n;

// ─── FixedPriceOracle ──────────────────────────────────────────

export interface FixedPriceOracleConfig {
  readonly id?: string;
  readonly chainId: number;
  readonly stable: `0x${string}`;
  /** Native-per-stable, human form. Example: 2500 ETH per 1 USDC → 2500. */
  readonly nativePerStable: number | bigint;
  readonly stableDecimals?: number;
  readonly native?: string;
  readonly now?: () => number;
}

export class FixedPriceOracle implements PriceOracle {
  readonly id: string;
  private readonly chainId: number;
  private readonly stable: `0x${string}`;
  private readonly nativePerStableScaled: bigint;
  private readonly stableDecimals: number;
  private readonly native: string;
  private readonly now: () => number;

  constructor(config: FixedPriceOracleConfig) {
    this.id = config.id ?? "fixed";
    this.chainId = config.chainId;
    this.stable = config.stable;
    const raw =
      typeof config.nativePerStable === "bigint"
        ? config.nativePerStable * PRICE_SCALE
        : BigInt(Math.round(Number(config.nativePerStable) * 1e6)) * (PRICE_SCALE / 10n ** 6n);
    this.nativePerStableScaled = raw;
    this.stableDecimals = config.stableDecimals ?? 6;
    this.native = config.native ?? "eth";
    this.now = config.now ?? (() => Date.now());
  }

  async fetchQuote(chainId: number, stable: `0x${string}`): Promise<PriceQuote> {
    if (chainId !== this.chainId) {
      throw new PaymasterSponsorError(
        "chain-id-unsupported",
        `FixedPriceOracle configured for chain ${this.chainId}, got ${chainId}`,
      );
    }
    if (stable.toLowerCase() !== this.stable.toLowerCase()) {
      throw new PaymasterSponsorError(
        "price-unavailable",
        `FixedPriceOracle configured for stable ${this.stable}, got ${stable}`,
      );
    }
    const asOf = this.now();
    return buildQuote({
      oracleId: this.id,
      chainId: this.chainId,
      nativePerStableScaled: this.nativePerStableScaled,
      asOf,
      native: this.native,
      stable: this.stable,
      stableDecimals: this.stableDecimals,
    });
  }
}

// ─── CachingPriceOracle ────────────────────────────────────────

export interface CachingPriceOracleConfig {
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export class CachingPriceOracle implements PriceOracle {
  readonly id: string;
  private readonly inner: PriceOracle;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<
    string,
    { quote: PriceQuote; cachedUntil: number }
  >();

  constructor(inner: PriceOracle, config: CachingPriceOracleConfig = {}) {
    this.inner = inner;
    this.id = `caching:${inner.id}`;
    this.ttlMs = config.ttlMs ?? 15_000;
    this.now = config.now ?? (() => Date.now());
  }

  async fetchQuote(chainId: number, stable: `0x${string}`): Promise<PriceQuote> {
    const key = `${chainId}:${stable.toLowerCase()}`;
    const hit = this.cache.get(key);
    const now = this.now();
    if (hit && hit.cachedUntil > now) return hit.quote;
    const quote = await this.inner.fetchQuote(chainId, stable);
    this.cache.set(key, { quote, cachedUntil: now + this.ttlMs });
    return quote;
  }

  /** Drop every cached entry. Useful for ops tools. */
  clear(): void {
    this.cache.clear();
  }
}

// ─── Quote construction ────────────────────────────────────────

/** Build a quote with a deterministic id. Exported so tests can round-trip. */
export function buildQuote(params: {
  readonly oracleId: string;
  readonly chainId: number;
  readonly nativePerStableScaled: bigint;
  readonly asOf: number;
  readonly native: string;
  readonly stable: `0x${string}`;
  readonly stableDecimals: number;
}): PriceQuote {
  const preimage = new TextEncoder().encode(
    [
      params.oracleId,
      String(params.chainId),
      params.nativePerStableScaled.toString(),
      String(params.asOf),
      params.native,
      params.stable.toLowerCase(),
      String(params.stableDecimals),
    ].join("|"),
  );
  const digest = keccak_256(preimage);
  let hex = "0x";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return {
    id: hex as `0x${string}`,
    oracleId: params.oracleId,
    chainId: params.chainId,
    nativePerStableScaled: params.nativePerStableScaled,
    asOf: params.asOf,
    native: params.native,
    stable: params.stable,
    stableDecimals: params.stableDecimals,
  };
}

/**
 * Assert a quote is fresh enough. Exported so callers that manage
 * their own staleness policy (tighter than the sponsor default) can
 * wrap it.
 */
export function assertQuoteFresh(quote: PriceQuote, maxAgeMs: number, now: number = Date.now()): void {
  const ageMs = now - quote.asOf;
  if (ageMs > maxAgeMs) {
    throw new PaymasterSponsorError(
      "price-too-stale",
      `quote ${quote.id} is ${ageMs}ms old (max ${maxAgeMs}ms)`,
      { details: { quoteId: quote.id, ageMs, maxAgeMs } },
    );
  }
}
