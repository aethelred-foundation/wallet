# `@aethelred/wallet-swap-venue-uniswap-v3-cache-redis`

Redis-backed `AllowanceCache` implementation for [`@aethelred/wallet-swap-venue-uniswap-v3`](../swap-venue-uniswap-v3/). Plugs into the v3 venue's `allowanceCache` slot to share allowance state across multiple wallet processes — load-balanced API tiers, multi-region deployments, restart-resilient setups.

Closes the "future work: shared cache for multi-process deployments" hook from PR #98 and validates the pluggable-cache interface introduced in PR #99.

## Why this exists

PR #98 introduced an in-memory `Map<string, ...>` cache for ERC-20 `allowance(owner, spender)` lookups, saving one `eth_call` per swap when the agent has pre-approved. PR #99 extracted that storage behind a pluggable `AllowanceCache` interface.

This package is the canonical **multi-process** implementation. With it, an agent fleet of N wallet processes shares one Redis-backed cache: the first process's `allowance()` lookup populates the cache; processes 2…N skip the lookup entirely.

For single-process deployments, the v3 venue's default `InMemoryAllowanceCache` is enough — don't reach for Redis until you actually run multi-process.

## Design

**Zero hard runtime dependency on a Redis driver.** The cache accepts any client matching the `RedisLikeClient` interface (4 methods: `get`, `set`, `scan`, `del`). `ioredis` instances satisfy it natively; `node-redis` (v4+) needs a thin adapter (sketch below).

**Schema-versioned JSON payloads.** Each entry is stored as `{"v":1,"a":"<bigint as decimal string>","r":<unix-ms>}`. Future schema changes bump `v`; old wallet code reading new entries treats them as cache miss and falls through to fresh `eth_call` (forward-compatible).

**`SCAN`-based `clear()`.** Never uses `KEYS *` (which blocks the Redis event loop). Iterates `SCAN cursor MATCH <prefix>*` until cursor returns `"0"`, deleting matched keys per batch.

**Fail-closed semantics inherited from PR #99.** When `get()` / `set()` / `clear()` throw, the v3 venue treats it as a cache miss / no-op. A flaky Redis instance never breaks a swap — it just degrades to PR #97's "fresh `eth_call` every time" behavior.

## Usage

### With `ioredis` (most common)

```ts
import Redis from "ioredis";
import { RedisAllowanceCache } from "@aethelred/wallet-swap-venue-uniswap-v3-cache-redis";
import { UniswapV3SwapVenue } from "@aethelred/wallet-swap-venue-uniswap-v3";

const redis = new Redis(process.env.REDIS_URL!);

const cache = new RedisAllowanceCache({
  client: redis,
  // Distinguish chains in shared Redis — `aethelred:v3:base:allowance:`
  // vs `aethelred:v3:arb:allowance:`. Without distinct prefixes, keys
  // would collide and the wrong-chain allowance would get served.
  keyPrefix: "aethelred:v3:base:allowance:",
  // Defense-in-depth backend expiry. Set >= the venue's
  // allowanceCacheTtlMs (in seconds) — Redis evicts entries the
  // venue would have already considered stale, but never before.
  ttlSeconds: 600,
});

const venue = new UniswapV3SwapVenue({
  chainId: 8453,
  quoterAddress: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
  swapRouterAddress: "0x2626664c2603336E57B271c5C0b26F421741e481",
  transport: rpcTransport,
  agentAddress: AGENT,
  skipApproveWhenSufficient: true,
  allowanceCacheTtlMs: 300_000, // 5 minutes
  allowanceCache: cache,
});
```

### With `node-redis` v4+ (thin adapter)

`node-redis` v4 returns an object with slightly different SCAN semantics (`{ cursor, keys }` instead of `[cursor, keys]`). Wrap it:

```ts
import { createClient } from "redis";
import type { RedisLikeClient } from "@aethelred/wallet-swap-venue-uniswap-v3-cache-redis";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

const adapter: RedisLikeClient = {
  get: (key) => client.get(key),
  set: (key, value, ...args) => {
    // Translate variadic args to node-redis's options object.
    const opts: { EX?: number } = {};
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] === "EX") opts.EX = Number(args[i + 1]);
    }
    return client.set(key, value, opts);
  },
  scan: async (cursor, ...args) => {
    const matchIdx = args.findIndex((x) => x === "MATCH");
    const countIdx = args.findIndex((x) => x === "COUNT");
    const result = await client.scan(Number(cursor), {
      MATCH: matchIdx >= 0 ? String(args[matchIdx + 1]) : undefined,
      COUNT: countIdx >= 0 ? Number(args[countIdx + 1]) : undefined,
    });
    return [String(result.cursor), result.keys];
  },
  del: (...keys) => client.del(keys),
};

const cache = new RedisAllowanceCache({ client: adapter, ttlSeconds: 600 });
```

### Custom backend (Cloudflare KV, DynamoDB, in-process LRU, …)

Implement the four-method `RedisLikeClient` interface against any KV-shaped store. The cache only requires `get` / `set` / `scan` / `del` semantics — no Redis-specific commands.

## API

### `new RedisAllowanceCache(config)`

```ts
interface RedisAllowanceCacheConfig {
  /** Redis client instance (ioredis-shaped). */
  client: RedisLikeClient;

  /**
   * Prefix prepended to every cache key. Default
   * `"aethelred:v3:allowance:"`. Operators sharing one Redis across
   * multiple chains/venues set distinct prefixes per venue instance.
   */
  keyPrefix?: string;

  /**
   * Redis-side TTL via `SET key value EX <ttlSeconds>`. Optional
   * defense-in-depth eviction; set >= the venue's
   * `allowanceCacheTtlMs / 1000` so Redis doesn't expire entries
   * the venue still considers fresh.
   */
  ttlSeconds?: number;
}
```

### `RedisLikeClient` (interface to satisfy)

```ts
interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: ReadonlyArray<string | number>): Promise<unknown>;
  scan(cursor: string | number, ...args: ReadonlyArray<string | number>): Promise<readonly [string | number, ReadonlyArray<string>]>;
  del(...keys: ReadonlyArray<string>): Promise<number>;
}
```

## Tests

25 tests in `apps/extension/src/test/swap-venue-uniswap-v3-cache-redis.test.ts`:

**Layer 1 — `RedisAllowanceCache` unit (22 tests)**
- get/set roundtrip preserves bigint allowance + recordedAt
- absent key returns null
- MAX_UINT256 (>2^200) survives roundtrip
- zero allowance survives roundtrip
- malformed JSON → null (corrupt entry handling)
- wrong schema version → null (forward-compatibility)
- bad bigint string → null
- missing required fields → null
- non-finite recordedAt → null
- non-object payload → null
- key prefix defaults applied to set/get
- custom prefix scopes set/get/clear
- clear() does NOT touch keys outside prefix
- set without ttlSeconds passes no EX arg
- set with ttlSeconds passes `EX <seconds>` correctly
- ttlSeconds=0 disables EX
- fractional ttlSeconds rounds up via `Math.ceil`
- constructor rejects negative / NaN / Infinity ttlSeconds (3 tests)
- clear() iterates SCAN cursor across multiple batches
- clear() returns immediately when nothing matches (single SCAN call)

**Layer 2 — Integration with `UniswapV3SwapVenue` (3 tests)**
- Two swaps in a row → only 1 allowance() eth_call (cache hit on second)
- `invalidateAllowanceCache()` triggers SCAN-based clear; next swap re-fetches
- Redis throwing on `get()` degrades gracefully to fresh eth_call (fail-closed)

## Operational notes

**Cache coherence in multi-region deployments.** This package treats the Redis client as opaque — region pinning, replication topology, and consistency guarantees are the operator's choice (Redis Cluster, ElastiCache cross-region, etc.). The cache itself is stateless.

**Concurrent-write conflicts.** Two processes racing to populate the same key write the same value (within TTL). Last write wins, but neither value is wrong. The venue's `recordedAt` ensures stale reads are caught at TTL boundaries.

**Cache poisoning resistance.** A malicious or buggy actor that writes garbage into the namespace causes nothing worse than cache miss + fresh `eth_call` (via the corruption-handling paths above). The venue's behavior is identical to "no cache at all."

**Dropping the cache without restart.** `await venue.invalidateAllowanceCache()` triggers `SCAN MATCH <prefix>* + DEL` across the entire namespace. Use after revoking approvals out-of-band or when the off-chain state model has drifted from the chain.
