/**
 * `@aethelred/wallet-swap-venue-uniswap-v3-cache-redis` —
 * Redis-backed `AllowanceCache` implementation for the v3 venue.
 *
 * Plugs into `@aethelred/wallet-swap-venue-uniswap-v3`'s
 * `allowanceCache` config slot to share allowance state across
 * multiple wallet processes — load-balanced API tiers,
 * multi-region deployments, restart-resilient setups. Closes the
 * "future work" hook from PR #98 and validates the pluggable-cache
 * interface introduced in PR #99.
 *
 * **Zero hard dependency on a Redis driver.** The cache accepts
 * any client matching the `RedisLikeClient` interface (4 methods:
 * `get`, `set`, `scan`, `del`). `ioredis` instances satisfy it
 * natively; `node-redis` (v4+) needs a thin adapter (sketch in
 * README).
 *
 * Typical wiring:
 *
 * ```ts
 * import Redis from "ioredis";
 * import { RedisAllowanceCache } from "@aethelred/wallet-swap-venue-uniswap-v3-cache-redis";
 * import { UniswapV3SwapVenue } from "@aethelred/wallet-swap-venue-uniswap-v3";
 *
 * const redis = new Redis(process.env.REDIS_URL!);
 * const cache = new RedisAllowanceCache({
 *   client: redis,
 *   keyPrefix: "aethelred:v3:base:allowance:", // distinguish chains in shared Redis
 *   ttlSeconds: 600, // defense-in-depth backend expiry (>= venue's allowanceCacheTtlMs / 1000)
 * });
 *
 * const venue = new UniswapV3SwapVenue({
 *   ...,
 *   skipApproveWhenSufficient: true,
 *   allowanceCacheTtlMs: 300_000,
 *   allowanceCache: cache,
 * });
 * ```
 *
 * @packageDocumentation
 */

import type {
  AllowanceCache,
  AllowanceCacheEntry,
} from "@aethelred/wallet-swap-venue-uniswap-v3";

// ─── RedisLikeClient ──────────────────────────────────────

/**
 * Minimal Redis client surface this package depends on. Modeled
 * after `ioredis`'s API; `node-redis` users wrap their client to
 * match (see README).
 *
 * The variadic `...args` on `set` and `scan` mirror the variadic
 * argument lists of Redis commands (`SET key value [EX seconds]`,
 * `SCAN cursor [MATCH pattern] [COUNT count]`). We pass these
 * through verbatim — driver-side parsing handles the actual
 * protocol encoding.
 *
 * Operators pass their existing client instance OR roll any
 * object satisfying this shape (test doubles, in-memory fakes,
 * cloud-cache adapters, etc.).
 */
export interface RedisLikeClient {
  /** `GET key` — returns the value as a string, or `null` if absent. */
  get(key: string): Promise<string | null>;

  /**
   * `SET key value [EX seconds] [NX] [XX] ...` — variadic for
   * compatibility with the full SET command syntax. Returns
   * driver-defined; we don't inspect the result.
   */
  set(
    key: string,
    value: string,
    ...args: ReadonlyArray<string | number>
  ): Promise<unknown>;

  /**
   * `SCAN cursor [MATCH pattern] [COUNT count]` — returns a tuple
   * of the next cursor (string `"0"` when iteration completes)
   * and the matched keys for this batch.
   *
   * Implementations matching `ioredis` return cursor as a string
   * (`"0"` to signal end). `node-redis` v4+ returns it as a
   * number; `RedisAllowanceCache.clear()` coerces both via
   * `String(cursor)`.
   */
  scan(
    cursor: string | number,
    ...args: ReadonlyArray<string | number>
  ): Promise<readonly [string | number, ReadonlyArray<string>]>;

  /** `DEL key [key ...]` — returns the number of keys actually deleted. */
  del(...keys: ReadonlyArray<string>): Promise<number>;
}

// ─── Config ────────────────────────────────────────────────

export interface RedisAllowanceCacheConfig {
  /** Redis client instance (ioredis, or anything matching `RedisLikeClient`). */
  readonly client: RedisLikeClient;

  /**
   * Prefix prepended to every cache key. Defaults to
   * `"aethelred:v3:allowance:"`. Operators sharing a single Redis
   * across multiple chains / venues should set distinct prefixes
   * (e.g., `"aethelred:v3:base:allowance:"` vs
   * `"aethelred:v3:arb:allowance:"`) — keys collide otherwise and
   * the wrong-chain allowance gets served.
   *
   * The prefix is also used by `clear()`'s `SCAN MATCH` pattern,
   * so changing it scopes the clear correctly without leaking into
   * unrelated application data.
   */
  readonly keyPrefix?: string;

  /**
   * Optional Redis-side TTL applied via the `EX` argument of
   * `SET`. When set, Redis evicts entries after this many seconds
   * regardless of whether the venue ever calls `clear()` —
   * defense in depth against orphaned entries surviving a venue
   * crash.
   *
   * The venue's own `allowanceCacheTtlMs` controls staleness
   * semantics; this Redis-side TTL should be **greater than or
   * equal to** `allowanceCacheTtlMs / 1000` so Redis doesn't evict
   * entries the venue would still consider fresh.
   *
   * Default: undefined (no Redis-side TTL — entries persist until
   * `clear()` or eviction policy).
   */
  readonly ttlSeconds?: number;
}

// ─── Implementation ────────────────────────────────────────

/**
 * Schema version embedded in the JSON payload. Bumped on
 * incompatible payload-shape changes; older versions are
 * treated as cache miss (forward-compatible — old wallet code
 * reading new entries falls through to fresh `eth_call`).
 */
const PAYLOAD_SCHEMA_VERSION = 1;

const DEFAULT_KEY_PREFIX = "aethelred:v3:allowance:";

/** SCAN batch size — tradeoff between roundtrips and per-call work. 100 is a sane default. */
const SCAN_BATCH_COUNT = 100;

interface SerializedEntry {
  /** Schema version. */
  readonly v: number;
  /** Allowance as a base-10 string (bigints don't survive JSON natively). */
  readonly a: string;
  /** `recordedAt` Unix ms. */
  readonly r: number;
}

/**
 * Redis-backed `AllowanceCache`. Stores entries as JSON under
 * `{keyPrefix}{venue-key}` keys. Bigint allowances are
 * serialized as base-10 strings (JSON has no native bigint).
 *
 * Lifecycle: the cache does NOT own the Redis client — operators
 * construct and dispose the client themselves. The cache neither
 * connects nor disconnects.
 */
export class RedisAllowanceCache implements AllowanceCache {
  private readonly client: RedisLikeClient;
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number | undefined;

  constructor(config: RedisAllowanceCacheConfig) {
    if (
      config.ttlSeconds !== undefined &&
      (!Number.isFinite(config.ttlSeconds) || config.ttlSeconds < 0)
    ) {
      throw new Error(
        `RedisAllowanceCache: ttlSeconds must be a non-negative finite number, got ${String(config.ttlSeconds)}`,
      );
    }

    this.client = config.client;
    this.keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.ttlSeconds = config.ttlSeconds;
  }

  async get(key: string): Promise<AllowanceCacheEntry | null> {
    const raw = await this.client.get(this.keyPrefix + key);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Corrupt entry — treat as cache miss. Next `set()` from the
      // venue's eth_call fall-through will overwrite cleanly.
      return null;
    }

    if (!isValidSerializedEntry(parsed)) return null;

    let allowance: bigint;
    try {
      allowance = BigInt(parsed.a);
    } catch {
      // Allowance string isn't a valid bigint literal.
      return null;
    }

    return {
      allowance,
      recordedAt: parsed.r,
    };
  }

  async set(key: string, entry: AllowanceCacheEntry): Promise<void> {
    const payload: SerializedEntry = {
      v: PAYLOAD_SCHEMA_VERSION,
      a: entry.allowance.toString(10),
      r: entry.recordedAt,
    };
    const value = JSON.stringify(payload);
    const fullKey = this.keyPrefix + key;

    if (this.ttlSeconds !== undefined && this.ttlSeconds > 0) {
      await this.client.set(fullKey, value, "EX", Math.ceil(this.ttlSeconds));
    } else {
      await this.client.set(fullKey, value);
    }
  }

  async clear(): Promise<void> {
    const matchPattern = this.keyPrefix + "*";
    let cursor: string = "0";

    do {
      const result = await this.client.scan(
        cursor,
        "MATCH",
        matchPattern,
        "COUNT",
        SCAN_BATCH_COUNT,
      );
      const nextCursor = String(result[0]);
      const keys = result[1];

      if (keys.length > 0) {
        await this.client.del(...keys);
      }

      // First iteration starts at "0"; SCAN returns to "0" when
      // the iteration is complete. The loop entry condition
      // (`cursor === "0"` AFTER at least one batch) handles this:
      // we always make at least one call (cursor begins as "0",
      // ends as "0" only after a full pass).
      if (nextCursor === "0") return;
      cursor = nextCursor;
      // eslint-disable-next-line no-constant-condition
    } while (true);
  }
}

// ─── Internal helpers ──────────────────────────────────────

function isValidSerializedEntry(x: unknown): x is SerializedEntry {
  if (typeof x !== "object" || x === null) return false;
  const obj = x as Record<string, unknown>;
  return (
    typeof obj.v === "number" &&
    obj.v === PAYLOAD_SCHEMA_VERSION &&
    typeof obj.a === "string" &&
    typeof obj.r === "number" &&
    Number.isFinite(obj.r)
  );
}
