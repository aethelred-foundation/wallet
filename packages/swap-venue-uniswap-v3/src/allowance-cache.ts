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
 * Configuration for `InMemoryAllowanceCache`. All fields optional —
 * default construction (`new InMemoryAllowanceCache()`) preserves
 * pre-PR-#104 behavior (unbounded Map).
 */
export interface InMemoryAllowanceCacheConfig {
  /**
   * Maximum number of entries before LRU eviction kicks in.
   *
   * **Default: undefined (unbounded).** Suitable for agents whose
   * (owner, spender, asset) key-space is naturally bounded — the
   * common case (one agent, one router, ≤ a few dozen tokens).
   *
   * **Set explicitly when:**
   *   - The agent touches an open-ended set of tokens over time
   *     (e.g., a portfolio bot trading the long tail).
   *   - The wallet process runs for weeks without restart and Map
   *     growth adds up.
   *   - Operators want a hard memory ceiling for capacity planning.
   *
   * **Eviction policy is LRU**, not FIFO: on `get()` of an existing
   * key, the entry is re-inserted at the tail of the Map, marking
   * it most-recently-used. On `set()` of an existing key, same.
   * When `set()` would push the size over `maxEntries`, the head of
   * the Map (least-recently-used) is dropped.
   *
   * Why LRU over FIFO: the v3 venue's allowance cache is read-heavy
   * with hot keys (the same `(agent, router, USDC)` pair fires on
   * every USDC swap). FIFO would evict hot keys based on insertion
   * order even when they're being hit repeatedly; LRU keeps them
   * warm as long as they're used.
   *
   * Bound: must be a positive integer. `0` and negative values
   * throw at construction (silently disabling the cache by
   * setting `maxEntries: 0` would be a footgun — operators
   * disable caching by leaving `allowanceCacheTtlMs` unset on the
   * venue, not by zero-bounding the cache).
   */
  readonly maxEntries?: number;
}

/**
 * Default in-process `AllowanceCache` implementation. Wraps a
 * `Map` with promise-returning methods so the interface is
 * uniform across all backends.
 *
 * **Memory bound (PR #104).** Without `maxEntries` configured, the
 * cache grows monotonically until `clear()` — fine for the common
 * case (one agent, one router, ≤ a few dozen tokens; ~100 entries
 * total). Long-running deployments touching open-ended token sets
 * pass `maxEntries` for an LRU-bounded ceiling.
 *
 * Production operators wanting cache state to survive restarts OR
 * shared across multi-process deployments plug a Redis backend
 * (`@aethelred/wallet-swap-venue-uniswap-v3-cache-redis`); the
 * Redis case bounds memory via Redis-server `maxmemory` policies
 * rather than the wallet-side `maxEntries`.
 */
export class InMemoryAllowanceCache implements AllowanceCache {
  private readonly map = new Map<string, AllowanceCacheEntry>();
  private readonly maxEntries: number | undefined;

  constructor(config: InMemoryAllowanceCacheConfig = {}) {
    if (config.maxEntries !== undefined) {
      if (
        !Number.isInteger(config.maxEntries) ||
        config.maxEntries <= 0
      ) {
        throw new Error(
          `InMemoryAllowanceCache: maxEntries must be a positive integer, got ${String(config.maxEntries)}`,
        );
      }
    }
    this.maxEntries = config.maxEntries;
  }

  async get(key: string): Promise<AllowanceCacheEntry | null> {
    const entry = this.map.get(key);
    if (entry === undefined) return null;
    if (this.maxEntries !== undefined) {
      // LRU bookkeeping: re-insert to move this key to the
      // iteration tail (= most-recently-used). Skipped for the
      // unbounded case so we don't pay the delete+set cost
      // when there's no eviction policy.
      this.map.delete(key);
      this.map.set(key, entry);
    }
    return entry;
  }

  async set(key: string, entry: AllowanceCacheEntry): Promise<void> {
    if (this.maxEntries === undefined) {
      this.map.set(key, entry);
      return;
    }

    // Bounded case: ensure the new entry lands at the tail (MRU)
    // by deleting any existing entry first. JavaScript's Map
    // preserves insertion order, so a delete+set on an existing
    // key moves it to the end.
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);

    // Evict from the head (LRU) until we're at-or-below cap.
    // The `while` loop handles the (rare) case where multiple
    // entries need eviction — currently impossible in practice
    // since `set` only adds one at a time, but defensive against
    // future code paths that might bulk-load.
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
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
