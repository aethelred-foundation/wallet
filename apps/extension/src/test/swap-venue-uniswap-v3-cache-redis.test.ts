/**
 * Tests for `@aethelred/wallet-swap-venue-uniswap-v3-cache-redis`.
 *
 * Two layers:
 *
 *   1. **`RedisAllowanceCache` unit-level** — get/set/clear
 *      semantics against a fake `RedisLikeClient` backed by a
 *      `Map`. Covers payload encoding (JSON + bigint-as-string +
 *      schema version), key prefixing, optional `EX` TTL,
 *      `SCAN`-based clear, and the corruption-handling paths
 *      (malformed JSON, wrong-shape entry, wrong schema version,
 *      bad bigint string).
 *
 *   2. **Integration with `UniswapV3SwapVenue`** — wires the
 *      Redis cache into the real venue and verifies the same
 *      "skip approve when sufficient → cache hit on second swap →
 *      eth_call count stays at 1" loop that PR #98/99 validated
 *      with the in-memory cache. This proves the pluggable-cache
 *      contract holds for the Redis backend end-to-end.
 */

import { describe, expect, it } from "vitest";

import {
  UniswapV3SwapVenue,
  type Eth_RpcTransport,
} from "@aethelred/wallet-swap-venue-uniswap-v3";
import {
  RedisAllowanceCache,
  type RedisLikeClient,
} from "@aethelred/wallet-swap-venue-uniswap-v3-cache-redis";

// ─── Fake RedisLikeClient ──────────────────────────────────

interface FakeRedisCallLog {
  readonly setCalls: Array<{ key: string; value: string; args: ReadonlyArray<string | number> }>;
  readonly getCalls: Array<string>;
  readonly scanCalls: Array<{ cursor: string | number; args: ReadonlyArray<string | number> }>;
  readonly delCalls: Array<ReadonlyArray<string>>;
}

interface FakeRedisOptions {
  /** Maximum keys returned per SCAN batch (forces cursor iteration when smaller than total). */
  readonly scanBatchSize?: number;
  /** When true, get() throws once before succeeding; useful for fail-closed coverage. */
  readonly throwOnGet?: boolean;
}

function makeFakeRedis(opts: FakeRedisOptions = {}): {
  readonly client: RedisLikeClient;
  readonly store: Map<string, string>;
  readonly log: FakeRedisCallLog;
} {
  const store = new Map<string, string>();
  const log: FakeRedisCallLog = {
    setCalls: [],
    getCalls: [],
    scanCalls: [],
    delCalls: [],
  };
  const batchSize = opts.scanBatchSize ?? 100;

  const client: RedisLikeClient = {
    async get(key) {
      log.getCalls.push(key);
      if (opts.throwOnGet) throw new Error("simulated redis GET failure");
      return store.get(key) ?? null;
    },
    async set(key, value, ...args) {
      log.setCalls.push({ key, value, args });
      store.set(key, value);
      return "OK";
    },
    async scan(cursor, ...args) {
      log.scanCalls.push({ cursor, args });
      // Find MATCH pattern; default "*" if absent.
      const matchIdx = args.findIndex((x) => x === "MATCH");
      const pattern =
        matchIdx >= 0 && typeof args[matchIdx + 1] === "string"
          ? (args[matchIdx + 1] as string)
          : "*";

      // Glob to regex — only "*" wildcard (Redis SCAN supports more, but this fake covers our use).
      const regex = new RegExp(
        "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );

      // Real Redis SCAN cursor encodes hash-table-bucket position;
      // when the keyspace mutates between scans (e.g., DEL between
      // iterations), it tolerates the change and serves the
      // post-mutation keys on the next iteration. This fake models
      // that correctness property via a simpler "more / done"
      // cursor: "0" = start or final, anything else = "still more
      // matching keys exist post-deletion."
      const allMatching = Array.from(store.keys()).filter((k) => regex.test(k));
      const slice = allMatching.slice(0, batchSize);
      const next = slice.length < allMatching.length ? "1" : "0";
      return [next, slice];
    },
    async del(...keys) {
      log.delCalls.push(keys);
      let deleted = 0;
      for (const k of keys) {
        if (store.delete(k)) deleted++;
      }
      return deleted;
    },
  };

  return { client, store, log };
}

// ─── Layer 1: RedisAllowanceCache unit tests ──────────────

describe("RedisAllowanceCache: get/set roundtrip", () => {
  it("set then get returns the same entry (bigint allowance preserved)", async () => {
    const { client, store } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client });

    await cache.set("USDC:agent:router", { allowance: 12345n, recordedAt: 1_700_000_000_000 });
    const got = await cache.get("USDC:agent:router");

    expect(got).toEqual({ allowance: 12345n, recordedAt: 1_700_000_000_000 });
    expect(store.size).toBe(1);
  });

  it("get returns null for absent key", async () => {
    const { client } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client });
    expect(await cache.get("nope")).toBeNull();
  });

  it("preserves MAX_UINT256 (bigger than Number.MAX_SAFE_INTEGER)", async () => {
    const { client } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client });

    const MAX_UINT256 = (1n << 256n) - 1n;
    await cache.set("k", { allowance: MAX_UINT256, recordedAt: 1 });
    const got = await cache.get("k");

    expect(got?.allowance).toBe(MAX_UINT256);
  });

  it("preserves zero allowance", async () => {
    const { client } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client });

    await cache.set("k", { allowance: 0n, recordedAt: 5 });
    expect(await cache.get("k")).toEqual({ allowance: 0n, recordedAt: 5 });
  });
});

describe("RedisAllowanceCache: corruption handling (fail-closed via null)", () => {
  it("returns null for malformed JSON", async () => {
    const { client, store } = makeFakeRedis();
    store.set("aethelred:v3:allowance:k", "{not json");
    const cache = new RedisAllowanceCache({ client });
    expect(await cache.get("k")).toBeNull();
  });

  it("returns null for wrong schema version", async () => {
    const { client, store } = makeFakeRedis();
    store.set(
      "aethelred:v3:allowance:k",
      JSON.stringify({ v: 999, a: "100", r: 1_700_000_000_000 }),
    );
    const cache = new RedisAllowanceCache({ client });
    expect(await cache.get("k")).toBeNull();
  });

  it("returns null when allowance string isn't a valid bigint literal", async () => {
    const { client, store } = makeFakeRedis();
    store.set(
      "aethelred:v3:allowance:k",
      JSON.stringify({ v: 1, a: "not-a-number", r: 1_700_000_000_000 }),
    );
    const cache = new RedisAllowanceCache({ client });
    expect(await cache.get("k")).toBeNull();
  });

  it("returns null when payload is missing required fields", async () => {
    const { client, store } = makeFakeRedis();
    store.set("aethelred:v3:allowance:k", JSON.stringify({ v: 1, a: "100" })); // no `r`
    const cache = new RedisAllowanceCache({ client });
    expect(await cache.get("k")).toBeNull();
  });

  it("returns null when recordedAt isn't a finite number", async () => {
    const { client, store } = makeFakeRedis();
    store.set(
      "aethelred:v3:allowance:k",
      JSON.stringify({ v: 1, a: "100", r: "not-a-number" }),
    );
    const cache = new RedisAllowanceCache({ client });
    expect(await cache.get("k")).toBeNull();
  });

  it("returns null when payload is a non-object (e.g., a number)", async () => {
    const { client, store } = makeFakeRedis();
    store.set("aethelred:v3:allowance:k", JSON.stringify(42));
    const cache = new RedisAllowanceCache({ client });
    expect(await cache.get("k")).toBeNull();
  });
});

describe("RedisAllowanceCache: key prefix", () => {
  it("defaults to 'aethelred:v3:allowance:'", async () => {
    const { client, store } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client });
    await cache.set("k", { allowance: 1n, recordedAt: 0 });
    expect(store.has("aethelred:v3:allowance:k")).toBe(true);
  });

  it("custom prefix is applied to set, get, and clear", async () => {
    const { client, store, log } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client, keyPrefix: "myapp:cache:" });

    await cache.set("k1", { allowance: 1n, recordedAt: 0 });
    await cache.set("k2", { allowance: 2n, recordedAt: 0 });

    expect(store.has("myapp:cache:k1")).toBe(true);
    expect(store.has("myapp:cache:k2")).toBe(true);

    expect(await cache.get("k1")).toEqual({ allowance: 1n, recordedAt: 0 });

    await cache.clear();

    expect(store.size).toBe(0);
    // SCAN should have been called with MATCH "myapp:cache:*"
    const scanCall = log.scanCalls[0];
    expect(scanCall?.args).toContain("myapp:cache:*");
  });

  it("clear() does NOT touch keys outside the prefix", async () => {
    const { client, store } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client, keyPrefix: "myns:" });

    await cache.set("a", { allowance: 1n, recordedAt: 0 });
    store.set("other:unrelated", "preserve me");

    await cache.clear();

    expect(store.has("other:unrelated")).toBe(true);
    expect(store.has("myns:a")).toBe(false);
  });
});

describe("RedisAllowanceCache: TTL (EX option)", () => {
  it("set without ttlSeconds does NOT pass EX argument", async () => {
    const { client, log } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client });

    await cache.set("k", { allowance: 1n, recordedAt: 0 });
    expect(log.setCalls[0]?.args).toEqual([]);
  });

  it("set with ttlSeconds passes EX <seconds> as args", async () => {
    const { client, log } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client, ttlSeconds: 600 });

    await cache.set("k", { allowance: 1n, recordedAt: 0 });
    expect(log.setCalls[0]?.args).toEqual(["EX", 600]);
  });

  it("set with ttlSeconds=0 does NOT pass EX (treated as 'no Redis TTL')", async () => {
    const { client, log } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client, ttlSeconds: 0 });

    await cache.set("k", { allowance: 1n, recordedAt: 0 });
    expect(log.setCalls[0]?.args).toEqual([]);
  });

  it("set with fractional ttlSeconds rounds UP via Math.ceil", async () => {
    const { client, log } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client, ttlSeconds: 1.1 });

    await cache.set("k", { allowance: 1n, recordedAt: 0 });
    expect(log.setCalls[0]?.args).toEqual(["EX", 2]);
  });

  it("constructor rejects negative ttlSeconds", () => {
    const { client } = makeFakeRedis();
    expect(
      () => new RedisAllowanceCache({ client, ttlSeconds: -1 }),
    ).toThrow(/non-negative finite/i);
  });

  it("constructor rejects NaN ttlSeconds", () => {
    const { client } = makeFakeRedis();
    expect(
      () => new RedisAllowanceCache({ client, ttlSeconds: Number.NaN }),
    ).toThrow(/non-negative finite/i);
  });

  it("constructor rejects Infinity ttlSeconds", () => {
    const { client } = makeFakeRedis();
    expect(
      () => new RedisAllowanceCache({ client, ttlSeconds: Number.POSITIVE_INFINITY }),
    ).toThrow(/non-negative finite/i);
  });
});

describe("RedisAllowanceCache: clear() with SCAN cursor iteration", () => {
  it("clears all matching keys when total > scanBatchSize (multi-batch SCAN)", async () => {
    const { client, store, log } = makeFakeRedis({ scanBatchSize: 3 });
    const cache = new RedisAllowanceCache({ client });

    // Seed 7 entries so SCAN must iterate 3 batches (3 + 3 + 1).
    for (let i = 0; i < 7; i++) {
      await cache.set(`k${i}`, { allowance: BigInt(i), recordedAt: 0 });
    }
    expect(store.size).toBe(7);

    await cache.clear();
    expect(store.size).toBe(0);
    expect(log.scanCalls.length).toBeGreaterThanOrEqual(3); // multi-batch
  });

  it("returns immediately when nothing matches the prefix (one SCAN call)", async () => {
    const { client, log } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client });

    await cache.clear();
    expect(log.scanCalls.length).toBe(1);
    expect(log.delCalls.length).toBe(0);
  });
});

// ─── Layer 2: Integration with UniswapV3SwapVenue ────────

describe("RedisAllowanceCache: integration with UniswapV3SwapVenue", () => {
  // Reuse the venue's standard fixture shape (matching the
  // PR #98/99 cache tests in swap-venue-uniswap-v3.test.ts).

  const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
  const WETH = "0x4200000000000000000000000000000000000006" as `0x${string}`;
  const RECIPIENT = ("0x" + "bb".repeat(20)) as `0x${string}`;
  const QUOTER = ("0x" + "11".repeat(20)) as `0x${string}`;
  const ROUTER = ("0x" + "22".repeat(20)) as `0x${string}`;
  const AGENT_OWNER = ("0x" + "ee".repeat(20)) as `0x${string}`;

  function makeCountingAllowanceTransport(opts: {
    readonly existingAllowance: bigint;
  }): {
    readonly transport: Eth_RpcTransport;
    readonly stats: { allowanceCalls: number };
  } {
    const stats = { allowanceCalls: 0 };
    const transport: Eth_RpcTransport = {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        if (method !== "eth_call") return "0x" as unknown as T;
        const callObj = params[0] as { data: string };
        const data = callObj.data.toLowerCase();
        // ERC20 allowance(owner, spender) — selector 0xdd62ed3e
        if (data.startsWith("0xdd62ed3e")) {
          stats.allowanceCalls += 1;
          const padded = opts.existingAllowance.toString(16).padStart(64, "0");
          return ("0x" + padded) as unknown as T;
        }
        // QuoterV2 — irrelevant for these tests, but venue may still call.
        return "0x" as unknown as T;
      },
    };
    return { transport, stats };
  }

  function makeBuildParams(amountIn: bigint) {
    return {
      chainId: 8453 as const,
      sellAsset: USDC,
      sellAmount: amountIn,
      buyAsset: WETH,
      recipient: RECIPIENT,
      amountOutMinimum: 1n,
      venueData: {
        feeTier: 3000 as number,
        expectedBuyAmount: 99_000_000_000_000n,
        sqrtPriceX96After: 0n,
      },
      deadlineMs: Date.now() + 60_000,
    };
  }

  it("RedisAllowanceCache hit on second swap means only 1 eth_call across two swaps", async () => {
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n, // unlimited (MAX_UINT256)
    });
    const { client, store } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client, ttlSeconds: 600 });

    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCache: cache,
    });

    const a = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(a).toHaveLength(1); // approve skipped
    expect(stats.allowanceCalls).toBe(1);
    expect(store.size).toBe(1); // cache populated in Redis

    const b = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(b).toHaveLength(1);
    // Cache hit — second call did NOT add an allowance() RPC.
    expect(stats.allowanceCalls).toBe(1);
  });

  it("invalidateAllowanceCache forces fresh eth_call on next swap (clear via SCAN)", async () => {
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const { client, store, log } = makeFakeRedis();
    const cache = new RedisAllowanceCache({ client });

    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCache: cache,
    });

    // Swap 1 — populates cache
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(1);
    expect(store.size).toBe(1);

    // Invalidate
    await venue.invalidateAllowanceCache();
    expect(store.size).toBe(0);
    expect(log.scanCalls.length).toBeGreaterThanOrEqual(1);

    // Swap 2 — cache is empty, fresh eth_call
    await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(stats.allowanceCalls).toBe(2);
  });

  it("Redis throwing on get() degrades gracefully to fresh eth_call (fail-closed)", async () => {
    const { transport, stats } = makeCountingAllowanceTransport({
      existingAllowance: (1n << 256n) - 1n,
    });
    const { client } = makeFakeRedis({ throwOnGet: true });
    const cache = new RedisAllowanceCache({ client });

    const venue = new UniswapV3SwapVenue({
      chainId: 8453,
      quoterAddress: QUOTER,
      swapRouterAddress: ROUTER,
      transport,
      agentAddress: AGENT_OWNER,
      skipApproveWhenSufficient: true,
      allowanceCacheTtlMs: 60_000,
      allowanceCache: cache,
    });

    // Each swap should fall through to a fresh eth_call since
    // every Redis GET throws.
    const a = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(a).toHaveLength(1); // approve still skipped (eth_call returns big allowance)

    const b = await venue.buildSwapTxs(makeBuildParams(1_000_000n));
    expect(b).toHaveLength(1);

    // Both swaps independently called allowance() — no cache hits.
    expect(stats.allowanceCalls).toBe(2);
  });
});
