/**
 * `AllowanceCache` — pluggable backing store for the v3 venue's
 * per-token allowance lookups (PR #98).
 *
 * The default `InMemoryAllowanceCache` uses an in-process Map —
 * fine for single-process deployments. Operators running multiple
 * wallet instances behind a load balancer (or wanting cache state
 * to survive restarts) implement this interface against Redis,
 * Cloud Memorystore, etc.
 *
 * Contract:
 *
 *   - `get(key)` returns the entry OR `null` if absent. May throw
 *     on backend errors; the venue treats throws as cache miss
 *     (fail-closed: fresh eth_call to allowance()). The cache is
 *     an optimization, never a correctness dependency.
 *
 *   - `set(key, entry)` overwrites existing. May throw; venue
 *     swallows the throw (write-through is best-effort, the
 *     pre-flight result is still correct without it).
 *
 *   - `clear()` drops all entries. May throw; venue swallows.
 *
 * **TTL is NOT the cache's concern.** The venue stamps
 * `recordedAt` on writes and computes staleness on reads using
 * its configured `allowanceCacheTtlMs`. Operators using Redis
 * MAY also set Redis's `EX` directive (defence in depth — older
 * entries get evicted by Redis even if the venue forgot to
 * delete them), but the venue doesn't depend on it.
 *
 * @example Redis backend (illustrative; not bundled in this package)
 *
 * ```ts
 * import { createClient } from "redis";
 *
 * const redis = createClient({ url: process.env.REDIS_URL });
 * await redis.connect();
 *
 * const cache: AllowanceCache = {
 *   async get(key) {
 *     const raw = await redis.get(`allowance:${key}`);
 *     return raw ? JSON.parse(raw, bigintReviver) : null;
 *   },
 *   async set(key, entry) {
 *     await redis.set(`allowance:${key}`, JSON.stringify(entry, bigintReplacer));
 *   },
 *   async clear() {
 *     for await (const k of redis.scanIterator({ MATCH: "allowance:*" })) {
 *       await redis.del(k);
 *     }
 *   },
 * };
 *
 * const venue = new UniswapV3SwapVenue({ ..., allowanceCache: cache });
 * ```
 */

export interface AllowanceCacheEntry {
  /** The cached allowance value (in token's smallest unit). */
  readonly allowance: bigint;
  /** Unix-ms timestamp when the entry was written. */
  readonly recordedAt: number;
}

export interface AllowanceCache {
  /**
   * Read the cached entry for `key`. Returns null when absent.
   * The venue interprets thrown errors as cache miss (fail-
   * closed: fall through to fresh eth_call).
   */
  get(key: string): Promise<AllowanceCacheEntry | null>;

  /**
   * Write `entry` under `key`, overwriting any existing entry.
   * The venue swallows thrown errors — write failures don't
   * break the swap, just deny the optimization for the next
   * lookup.
   */
  set(key: string, entry: AllowanceCacheEntry): Promise<void>;

  /**
   * Drop all entries. Called by
   * `UniswapV3SwapVenue.invalidateAllowanceCache()`. The venue
   * swallows thrown errors.
   *
   * Implementations with namespace-prefix keys (`allowance:*`)
   * may want to scope `clear()` to that prefix; venue-scoped
   * pollution into other application data isn't expected, but
   * defending against it is wise.
   */
  clear(): Promise<void>;
}

/**
 * Default in-process `AllowanceCache` implementation. Wraps a
 * `Map` with promise-returning methods so the interface is
 * uniform across all backends.
 *
 * Memory bound: the cache grows monotonically until `clear()`.
 * Per-token + per-(owner,spender) keys mean ~100 entries for
 * an agent trading 30 tokens across 3 venues. Production
 * operators with thousands of tokens should plug an LRU-bounded
 * Redis backend; this in-memory impl is the simple default.
 */
export class InMemoryAllowanceCache implements AllowanceCache {
  private readonly map = new Map<string, AllowanceCacheEntry>();

  async get(key: string): Promise<AllowanceCacheEntry | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, entry: AllowanceCacheEntry): Promise<void> {
    this.map.set(key, entry);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }

  /**
   * Test-only escape hatch — synchronously read the underlying
   * Map size. Production callers should NOT depend on this; it's
   * not part of the `AllowanceCache` interface.
   */
  size(): number {
    return this.map.size;
  }
}
