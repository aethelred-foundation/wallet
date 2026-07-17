/**
 * Unit + integration tests for the MV3 service-worker lifecycle
 * orchestrator and its per-subsystem stages.
 *
 * These tests exercise every branch of the production-blocking SW
 * lifecycle fix:
 *   - Fresh install (onInstalled → seed state + schema marker)
 *   - Update from prior version (onInstalled with previousVersion)
 *   - Browser restart (onStartup — rehydrate every stage)
 *   - Wake-from-idle on first message (onMessage → ensureBooted gates)
 *   - Suspend mid-batch (onSuspend flushes open Merkle batch)
 *   - Crash recovery — force-kill without onSuspend still leaves a
 *     consistent view
 *   - Race on concurrent cold-start messages (50 callers → 1 boot)
 *   - Idempotency — triple-invocation
 *   - 5 s suspend budget — 100 events still fit
 *   - Migration idempotency
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BasicTracer,
  Logger,
  NoopSpanProcessor,
} from "@aethelred/wallet-observability";
import { AuditCapture, AuditStore } from "@aethelred/wallet-audit";
import { MerkleBatchCoordinator } from "../background/merkle-batch-coordinator";
import { SwLifecycle } from "../background/sw-lifecycle";
import type { LifecycleContext } from "../background/sw-lifecycle";
import {
  APPROVAL_STORAGE_KEY,
  CREDENTIAL_STORE_KEY,
  CURRENT_SCHEMA_VERSION,
  NONCE_STORAGE_KEY,
  SCHEMA_VERSION_STORAGE_KEY,
  WC_SESSION_STORAGE_KEY,
  WORKFLOW_STORAGE_KEY,
  buildAuditChainRehydrationStage,
  buildCredentialStoreStage,
  buildMerkleBatchRestorationStage,
  buildNonceManagerStage,
  buildPendingApprovalsStage,
  buildPendingTxTrackerStage,
  buildStoragePersistenceStage,
  buildVelocityTrackerStage,
  buildWalletConnectSessionStage,
  buildWorkflowEngineStage,
} from "../background/stages";

/* ─── Test doubles ─────────────────────────────────────────────── */

/** A minimal chrome.storage.local-shaped adapter backed by a Map. */
class MemoryAdapter {
  private readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  has(key: string): boolean {
    return this.store.has(key);
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}

/** Minimal chrome.storage.session-shaped adapter. */
class MemorySessionAdapter {
  private readonly store = new Map<string, unknown>();
  async get(key: string): Promise<Record<string, unknown>> {
    return this.store.has(key) ? { [key]: this.store.get(key) } : {};
  }
  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      this.store.set(k, v);
    }
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function makeLoggerAndTracer(): { logger: Logger; tracer: BasicTracer } {
  return {
    logger: new Logger({
      component: "test-sw-lifecycle",
      sinks: [],
      minLevel: "error",
    }),
    tracer: new BasicTracer({ processor: new NoopSpanProcessor() }),
  };
}

/* ─── SwLifecycle orchestrator ────────────────────────────────── */

describe("SwLifecycle", () => {
  let logger: Logger;
  let tracer: BasicTracer;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
  });

  it("registers stages and sorts them by priority", () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage({ name: "c", priority: 30 });
    lifecycle.registerStage({ name: "a", priority: 10 });
    lifecycle.registerStage({ name: "b", priority: 20 });
    const stages = lifecycle.listStages();
    expect(stages.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  it("overwrites a stage registered under the same name", () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage({ name: "x", priority: 10 });
    const onStartup = vi.fn(async () => {});
    lifecycle.registerStage({ name: "x", priority: 10, onStartup });
    expect(lifecycle.listStages()).toHaveLength(1);
    expect(lifecycle.listStages()[0].onStartup).toBe(onStartup);
  });

  it("boot() is idempotent — concurrent callers share the same promise", async () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    const onStartup = vi.fn(async () => {});
    lifecycle.registerStage({ name: "a", priority: 0, onStartup });

    const [ctx1, ctx2, ctx3] = await Promise.all([
      lifecycle.boot(),
      lifecycle.boot(),
      lifecycle.boot(),
    ]);
    expect(ctx1).toBe(ctx2);
    expect(ctx2).toBe(ctx3);
    expect(onStartup).toHaveBeenCalledTimes(1);
  });

  it("runs onInstalled only when an install trigger is recorded", async () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    const onInstalled = vi.fn(async () => {});
    const onStartup = vi.fn(async () => {});
    lifecycle.registerStage({ name: "a", priority: 0, onInstalled, onStartup });

    // No trigger — onInstalled should NOT run.
    await lifecycle.boot();
    expect(onInstalled).toHaveBeenCalledTimes(0);
    expect(onStartup).toHaveBeenCalledTimes(1);
  });

  it("runs onInstalled + sets isFirstInstall=true on fresh install", async () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    const onInstalled = vi.fn(async (_ctx: LifecycleContext) => {});
    lifecycle.registerStage({ name: "a", priority: 0, onInstalled });

    lifecycle.recordInstallTrigger({ reason: "install" });
    const ctx = await lifecycle.boot();
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(ctx.isFirstInstall).toBe(true);
    expect(ctx.isUpdate).toBe(false);
    expect(ctx.previousVersion).toBeNull();
  });

  it("passes previousVersion when the trigger is an update", async () => {
    const lifecycle = new SwLifecycle(logger, tracer, { currentVersion: "0.9.0" });
    const onInstalled = vi.fn(async (_ctx: LifecycleContext) => {});
    lifecycle.registerStage({ name: "a", priority: 0, onInstalled });

    lifecycle.recordInstallTrigger({ reason: "update", previousVersion: "0.8.5" });
    const ctx = await lifecycle.boot();
    expect(ctx.isUpdate).toBe(true);
    expect(ctx.isFirstInstall).toBe(false);
    expect(ctx.previousVersion).toBe("0.8.5");
    expect(ctx.currentVersion).toBe("0.9.0");
  });

  it("ensureBooted() fires every stage's onMessage hook on every call", async () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    const onMessage = vi.fn(async () => {});
    lifecycle.registerStage({ name: "a", priority: 0, onMessage });

    await lifecycle.ensureBooted();
    await lifecycle.ensureBooted();
    await lifecycle.ensureBooted();
    expect(onMessage).toHaveBeenCalledTimes(3);
  });

  it("fifty concurrent ensureBooted() calls share a single boot", async () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    const onStartup = vi.fn(async () => {
      // Simulate a 20 ms rehydration
      await new Promise((r) => setTimeout(r, 20));
    });
    lifecycle.registerStage({ name: "a", priority: 0, onStartup });

    const calls = Array.from({ length: 50 }, () => lifecycle.ensureBooted());
    const results = await Promise.all(calls);
    expect(onStartup).toHaveBeenCalledTimes(1);
    // All 50 resolved to the same context instance
    for (const r of results) expect(r).toBe(results[0]);
  });

  it("swallows stage errors in non-strict mode so the boot continues", async () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    const first = vi.fn(async () => {
      throw new Error("boom");
    });
    const second = vi.fn(async () => {});
    lifecycle.registerStage({ name: "first", priority: 10, onStartup: first });
    lifecycle.registerStage({ name: "second", priority: 20, onStartup: second });

    await expect(lifecycle.boot()).resolves.toBeDefined();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("propagates stage errors in strict mode", async () => {
    const lifecycle = new SwLifecycle(logger, tracer, { strictBoot: true });
    const first = vi.fn(async () => {
      throw new Error("boom");
    });
    lifecycle.registerStage({ name: "first", priority: 10, onStartup: first });

    await expect(lifecycle.boot()).rejects.toThrow("boom");
  });

  it("shutdown() fires onSuspend hooks in reverse priority order", async () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    await lifecycle.boot();
    const order: string[] = [];
    lifecycle.registerStage({
      name: "a",
      priority: 10,
      onSuspend: async () => {
        order.push("a");
      },
    });
    lifecycle.registerStage({
      name: "b",
      priority: 20,
      onSuspend: async () => {
        order.push("b");
      },
    });
    // Need to boot AFTER stage registration so they apply.
    // Re-boot by disposing and creating a new lifecycle.
    const l2 = new SwLifecycle(logger, tracer);
    l2.registerStage({
      name: "a",
      priority: 10,
      onSuspend: async () => {
        order.push("a");
      },
    });
    l2.registerStage({
      name: "b",
      priority: 20,
      onSuspend: async () => {
        order.push("b");
      },
    });
    await l2.boot();
    order.length = 0;
    await l2.shutdown();
    expect(order).toEqual(["b", "a"]);
  });

  it("shutdown() before boot() is a safe no-op", async () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    await expect(lifecycle.shutdown()).resolves.toBeUndefined();
  });

  it("triple-invoking a stage is idempotent end-state", async () => {
    const state = { counter: 0, hydrated: false };
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage({
      name: "idempotent",
      priority: 0,
      onStartup: async () => {
        // A well-written stage never increments per boot — it observes
        // the current state and makes it conform to a target.
        if (!state.hydrated) {
          state.counter = 5;
          state.hydrated = true;
        }
      },
    });
    await lifecycle.boot();
    await lifecycle.boot();
    await lifecycle.boot();
    expect(state.counter).toBe(5);
  });
});

/* ─── Storage persistence stage (priority 0) ─────────────────── */

describe("storage-persistence stage", () => {
  let logger: Logger;
  let tracer: BasicTracer;
  let storage: MemoryAdapter;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
    storage = new MemoryAdapter();
  });

  it("seeds the schema version on fresh install", async () => {
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(buildStoragePersistenceStage({ storage }));
    lifecycle.recordInstallTrigger({ reason: "install" });
    await lifecycle.boot();
    expect(await storage.get(SCHEMA_VERSION_STORAGE_KEY)).toBe(
      String(CURRENT_SCHEMA_VERSION),
    );
  });

  it("runs a v1 → v2 migration when hydrating pre-v2 storage", async () => {
    await storage.set(SCHEMA_VERSION_STORAGE_KEY, "1");
    await storage.set("audit-events-v1", JSON.stringify([{ old: true }]));

    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(buildStoragePersistenceStage({ storage }));
    await lifecycle.boot();

    // v1 key was migrated + deleted
    expect(await storage.get("audit-events-v1")).toBeNull();
    expect(await storage.get("audit-events")).toBe(
      JSON.stringify([{ old: true }]),
    );
    expect(await storage.get(SCHEMA_VERSION_STORAGE_KEY)).toBe(
      String(CURRENT_SCHEMA_VERSION),
    );
  });

  it("migration is idempotent — running twice yields the same state", async () => {
    await storage.set(SCHEMA_VERSION_STORAGE_KEY, "1");
    await storage.set("audit-events-v1", JSON.stringify([{ old: true }]));

    const stage1 = buildStoragePersistenceStage({ storage });
    const stage2 = buildStoragePersistenceStage({ storage });
    const l1 = new SwLifecycle(logger, tracer);
    const l2 = new SwLifecycle(logger, tracer);
    l1.registerStage(stage1);
    l2.registerStage(stage2);
    await l1.boot();
    const snapshotAfterFirst = storage.snapshot();
    await l2.boot();
    expect(storage.snapshot()).toEqual(snapshotAfterFirst);
  });

  it("keeps the prior version when a migration throws", async () => {
    await storage.set(SCHEMA_VERSION_STORAGE_KEY, "1");
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(
      buildStoragePersistenceStage({
        storage,
        migrations: [
          {
            fromVersion: 1,
            apply: async () => {
              throw new Error("migration-boom");
            },
          },
        ],
      }),
    );
    await lifecycle.boot();
    // Still on v1 — we refused to advance.
    expect(await storage.get(SCHEMA_VERSION_STORAGE_KEY)).toBe("1");
  });
});

/* ─── Audit chain rehydration stage ───────────────────────────── */

describe("audit-chain rehydration stage", () => {
  let logger: Logger;
  let tracer: BasicTracer;
  let storage: MemoryAdapter;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
    storage = new MemoryAdapter();
  });

  it("restores the audit chain head from the persisted store", async () => {
    // Build an AuditCapture + AuditStore with a recorded history.
    const originalCapture = new AuditCapture();
    const originalStore = new AuditStore(storage);
    originalCapture.onEvent((ev) => {
      originalStore.append(ev).catch(() => {});
    });
    for (let i = 0; i < 3; i++) {
      originalCapture.record({
        kind: "request-received",
        subjectId: "s1",
        workspaceId: "w1",
        detail: { i },
      });
    }
    // Wait for the async append to settle
    await new Promise((r) => setTimeout(r, 10));
    const persistedSeq = originalCapture.getSequenceNumber();
    const persistedHash = originalCapture.getPreviousHash();

    // New capture + store pointed at the SAME underlying storage:
    const freshCapture = new AuditCapture();
    const freshStore = new AuditStore(storage);
    const lifecycle = new SwLifecycle(logger, tracer);
    let rehydratedState: { sequence: number; previousHash: string } | null = null;
    lifecycle.registerStage(
      buildAuditChainRehydrationStage({
        auditCapture: freshCapture,
        auditStore: freshStore,
        onRehydrated: (s) => {
          rehydratedState = s;
        },
      }),
    );
    await lifecycle.boot();

    expect(rehydratedState).not.toBeNull();
    expect(freshCapture.getSequenceNumber()).toBe(persistedSeq);
    expect(freshCapture.getPreviousHash()).toBe(persistedHash);
  });
});

/* ─── Merkle batch restoration stage ─────────────────────────── */

describe("merkle-batch restoration stage", () => {
  let logger: Logger;
  let tracer: BasicTracer;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
  });

  it("onSuspend flushes an open batch of 5 events", async () => {
    const storage = new MemoryAdapter();
    const capture = new AuditCapture();
    const coordinator = new MerkleBatchCoordinator(
      capture,
      () => {},
      { maxBatchSize: 100, maxBatchAgeMs: 60_000 },
      storage,
    );

    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(
      buildMerkleBatchRestorationStage({ coordinator }),
    );
    await lifecycle.boot();

    for (let i = 0; i < 5; i++) {
      capture.record({
        kind: "request-received",
        subjectId: "s1",
        workspaceId: "w1",
        detail: { i },
      });
    }
    await new Promise((r) => setTimeout(r, 0));

    expect(coordinator.getPendingEventCount()).toBe(5);
    await lifecycle.shutdown();
    expect(coordinator.getPendingEventCount()).toBe(0);
    expect(coordinator.getFinalizedBatchCount()).toBe(1);
  });

  it("onSuspend budget — 100 events flush inside 5 seconds", async () => {
    const storage = new MemoryAdapter();
    const capture = new AuditCapture();
    const coordinator = new MerkleBatchCoordinator(
      capture,
      () => {},
      { maxBatchSize: 1000, maxBatchAgeMs: 60_000 },
      storage,
    );

    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(
      buildMerkleBatchRestorationStage({ coordinator }),
    );
    await lifecycle.boot();

    for (let i = 0; i < 100; i++) {
      capture.record({
        kind: "request-received",
        subjectId: "s1",
        workspaceId: "w1",
        detail: { i },
      });
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(coordinator.getPendingEventCount()).toBe(100);

    const started = Date.now();
    await lifecycle.shutdown();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5_000);
    expect(coordinator.getPendingEventCount()).toBe(0);
  });
});

/* ─── Pending approvals stage ─────────────────────────────────── */

describe("pending-approvals stage", () => {
  let logger: Logger;
  let tracer: BasicTracer;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
  });

  it("discards pending approvals that cannot be resumed after startup", async () => {
    const session = new MemorySessionAdapter();
    const expiresAt = Date.now() + 60_000;
    await session.set({
      [APPROVAL_STORAGE_KEY]: [
        {
          summary: {
            id: "app-1",
            kind: "signing",
            app: { id: "x", name: "x", origin: "x", trustLevel: "unverified" },
            appRequestLabel: "x",
            status: "pending",
            createdAt: Date.now(),
            detail: { kind: "sign-message" },
          },
          intentRequest: {},
          createdAt: Date.now(),
          expiresAt,
        },
      ],
    });

    const pendingApprovals = new Map();
    const { stage } = buildPendingApprovalsStage({
      pendingApprovals,
      sessionStorage: session,
    });
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(stage);
    await lifecycle.boot();

    expect(pendingApprovals.size).toBe(0);
    expect(await session.get(APPROVAL_STORAGE_KEY)).toEqual({});
  });

  it("skips expired entries during rehydration", async () => {
    const session = new MemorySessionAdapter();
    await session.set({
      [APPROVAL_STORAGE_KEY]: [
        {
          summary: {
            id: "expired",
            kind: "signing",
            app: { id: "x", name: "x", origin: "x", trustLevel: "unverified" },
            appRequestLabel: "x",
            status: "pending",
            createdAt: 0,
            detail: { kind: "sign-message" },
          },
          intentRequest: {},
          createdAt: 0,
          expiresAt: 1, // long expired
        },
      ],
    });

    const pendingApprovals = new Map();
    const { stage } = buildPendingApprovalsStage({
      pendingApprovals,
      sessionStorage: session,
    });
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(stage);
    await lifecycle.boot();
    expect(pendingApprovals.size).toBe(0);
  });

  it("persist() removes legacy snapshots instead of serializing dead resolvers", async () => {
    const session = new MemorySessionAdapter();
    const pendingApprovals = new Map();
    pendingApprovals.set("only", {
      summary: {
        id: "only",
        kind: "signing",
        app: { id: "x", name: "x", origin: "x", trustLevel: "unverified" },
        appRequestLabel: "x",
        status: "pending",
        createdAt: 0,
        detail: { kind: "sign-message" },
      },
      intentRequest: {},
      createdAt: 0,
      expiresAt: Date.now() + 10_000,
      resolve: () => {},
    });
    const { persist } = buildPendingApprovalsStage({
      pendingApprovals,
      sessionStorage: session,
    });
    await session.set({ [APPROVAL_STORAGE_KEY]: [{ id: "legacy" }] });
    await persist();
    expect(await session.get(APPROVAL_STORAGE_KEY)).toEqual({});
    expect(pendingApprovals.size).toBe(1);
  });

  it("rejects and clears in-memory approvals before suspension", async () => {
    const session = new MemorySessionAdapter();
    const decisions: string[] = [];
    const pendingApprovals = new Map();
    pendingApprovals.set("pending", {
      summary: {
        id: "pending",
        kind: "signing",
        app: { id: "x", name: "x", origin: "x", trustLevel: "unverified" },
        appRequestLabel: "x",
        status: "pending",
        createdAt: 0,
        detail: { kind: "sign-message" },
      },
      intentRequest: {},
      createdAt: 0,
      expiresAt: Date.now() + 10_000,
      resolve: (decision: string) => decisions.push(decision),
    });
    const { stage } = buildPendingApprovalsStage({
      pendingApprovals,
      sessionStorage: session,
    });
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(stage);
    await lifecycle.boot();
    await lifecycle.shutdown();

    expect(decisions).toEqual(["rejected"]);
    expect(pendingApprovals.size).toBe(0);
    expect(await session.get(APPROVAL_STORAGE_KEY)).toEqual({});
  });
});

/* ─── Nonce manager stage ─────────────────────────────────────── */

describe("nonce-manager stage", () => {
  let logger: Logger;
  let tracer: BasicTracer;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
  });

  it("persists on suspend and restores on startup", async () => {
    const storage = new MemoryAdapter();
    const host1 = new Map<string, number>();
    host1.set("0xabc", 7);

    const stage1 = buildNonceManagerStage({
      storage,
      getTxManager: () => ({ nonceCache: host1 } as unknown as import("../background/stages").NonceHost),
      getActiveChainId: () => 1,
    });
    const l1 = new SwLifecycle(logger, tracer);
    l1.registerStage(stage1);
    await l1.boot();
    await l1.shutdown();

    const raw = await storage.get(NONCE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).byAddress["0xabc"]["1"]).toBe(7);

    // Fresh TxManager-like cache; lifecycle restores from disk.
    const host2 = new Map<string, number>();
    const stage2 = buildNonceManagerStage({
      storage,
      getTxManager: () => ({ nonceCache: host2 } as unknown as import("../background/stages").NonceHost),
      getActiveChainId: () => 1,
    });
    const l2 = new SwLifecycle(logger, tracer);
    l2.registerStage(stage2);
    await l2.boot();
    expect(host2.get("0xabc")).toBe(7);
  });
});

/* ─── Pending tx tracker stage ────────────────────────────────── */

describe("pending-tx-tracker stage", () => {
  let logger: Logger;
  let tracer: BasicTracer;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
  });

  it("marks confirmed pending txs and flags stuck ones", async () => {
    const now = Date.now();
    const markConfirmed = vi.fn(async () => {});
    const onStuck = vi.fn();
    const tracker = {
      list: async () => [
        {
          txHash: "0xaaa" as `0x${string}`,
          chainId: 1,
          submittedAt: now - 60_000, // 1 min old
        },
        {
          txHash: "0xbbb" as `0x${string}`,
          chainId: 1,
          submittedAt: now - 60 * 60 * 1000, // 1 h old — stuck
        },
      ],
      markConfirmed,
    };
    const receiptProbe = {
      getTransactionReceipt: async (hash: `0x${string}`) =>
        hash === "0xaaa" ? { status: "0x1", blockNumber: "0x1" } : null,
    };
    const stage = buildPendingTxTrackerStage({
      tracker,
      getReceiptProbe: () => receiptProbe,
      onStuck,
    });
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(stage);
    await lifecycle.boot();

    expect(markConfirmed).toHaveBeenCalledWith("0xaaa");
    expect(onStuck).toHaveBeenCalledWith("0xbbb", expect.any(Number));
  });
});

/* ─── Credential store stage ──────────────────────────────────── */

describe("credential-store stage", () => {
  let logger: Logger;
  let tracer: BasicTracer;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
  });

  it("persists and restores credential snapshots", async () => {
    const storage = new MemoryAdapter();
    const sample = [{ id: "cred-1", extra: "value" }];
    const store1 = {
      toSnapshot: () => sample,
      loadFromSnapshot: vi.fn(),
    };
    const stage1 = buildCredentialStoreStage({
      storage,
      getStore: () => store1,
    });
    const l1 = new SwLifecycle(logger, tracer);
    l1.registerStage(stage1);
    await l1.boot();
    await l1.shutdown();

    const raw = await storage.get(CREDENTIAL_STORE_KEY);
    expect(JSON.parse(raw!)).toEqual(sample);

    const store2 = {
      toSnapshot: () => [],
      loadFromSnapshot: vi.fn(),
    };
    const stage2 = buildCredentialStoreStage({
      storage,
      getStore: () => store2,
    });
    const l2 = new SwLifecycle(logger, tracer);
    l2.registerStage(stage2);
    await l2.boot();
    expect(store2.loadFromSnapshot).toHaveBeenCalledWith(sample);
  });

  it("reports malformed credential snapshots instead of treating them as no passkeys", async () => {
    const storage = new MemoryAdapter();
    await storage.set(CREDENTIAL_STORE_KEY, "{broken");
    const onHydrationState = vi.fn();
    const loadFromSnapshot = vi.fn();
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(buildCredentialStoreStage({
      storage,
      getStore: () => ({ toSnapshot: () => [], loadFromSnapshot }),
      onHydrationState,
    }));

    await lifecycle.boot();

    expect(loadFromSnapshot).not.toHaveBeenCalled();
    expect(onHydrationState).toHaveBeenCalledWith(expect.objectContaining({
      status: "invalid",
    }));
  });

  it("reports storage read failures so passkey enforcement can fail closed", async () => {
    const onHydrationState = vi.fn();
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(buildCredentialStoreStage({
      storage: {
        get: async () => { throw new Error("storage unavailable"); },
        set: async () => {},
        delete: async () => {},
      },
      getStore: () => ({ toSnapshot: () => [], loadFromSnapshot: vi.fn() }),
      onHydrationState,
    }));

    await lifecycle.boot();

    expect(onHydrationState).toHaveBeenCalledWith({
      status: "error",
      error: "storage unavailable",
    });
  });
});

/* ─── WalletConnect session stage ─────────────────────────────── */

describe("walletconnect-session stage", () => {
  let logger: Logger;
  let tracer: BasicTracer;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
  });

  it("normalizes the SDK-shaped session and rehydrates on startup", async () => {
    const storage = new MemoryAdapter();
    const sdkShapedSession = {
      topic: "t1",
      peer: { metadata: { name: "dApp", url: "https://example.com" } },
      expiry: Math.floor(Date.now() / 1000) + 3600, // seconds, future
      namespaces: { eip155: { chains: ["eip155:1"], accounts: ["eip155:1:0xabc"] } },
    };
    const manager1 = {
      getActiveSessions: () => [sdkShapedSession],
    };
    const stage1 = buildWalletConnectSessionStage({
      storage,
      getManager: () => manager1,
    });
    const l1 = new SwLifecycle(logger, tracer);
    l1.registerStage(stage1);
    await l1.boot();
    await l1.shutdown();

    const raw = await storage.get(WC_SESSION_STORAGE_KEY);
    const parsed = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].topic).toBe("t1");
    expect(parsed[0].peer).toEqual({ name: "dApp", url: "https://example.com" });
    expect(parsed[0].chainIds).toEqual(["eip155:1"]);

    const rehydrateSessions = vi.fn(
      async (snapshots: Array<{ topic: string }>) => {
        void snapshots;
      },
    );
    const manager2 = {
      getActiveSessions: () => [],
      rehydrateSessions,
    };
    const stage2 = buildWalletConnectSessionStage({
      storage,
      getManager: () => manager2,
    });
    const l2 = new SwLifecycle(logger, tracer);
    l2.registerStage(stage2);
    await l2.boot();

    expect(rehydrateSessions).toHaveBeenCalledTimes(1);
    const arg = rehydrateSessions.mock.calls[0][0];
    expect(arg[0].topic).toBe("t1");
  });
});

/* ─── Workflow engine stage ───────────────────────────────────── */

describe("workflow-engine stage", () => {
  let logger: Logger;
  let tracer: BasicTracer;

  beforeEach(() => {
    const deps = makeLoggerAndTracer();
    logger = deps.logger;
    tracer = deps.tracer;
  });

  it("restores the engine snapshot on startup", async () => {
    const storage = new MemoryAdapter();
    const requests = [{ id: "req-1" } as never];
    const limits = [{ id: "lim-1" } as never];
    const loadFromSnapshot = vi.fn();
    const engine = {
      loadFromSnapshot,
      toSnapshot: () => ({ requests: [], limits: [] }),
    };

    await storage.set(
      WORKFLOW_STORAGE_KEY,
      JSON.stringify({ requests, limits, savedAt: Date.now() }),
    );

    const stage = buildWorkflowEngineStage({ engine, storage });
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(stage);
    await lifecycle.boot();
    expect(loadFromSnapshot).toHaveBeenCalledWith(requests, limits);
  });
});

/* ─── Velocity tracker stage ─────────────────────────────────── */

describe("velocity-tracker stage", () => {
  it("skips when no subject is active", async () => {
    const { logger, tracer } = makeLoggerAndTracer();
    const getVelocity = vi.fn(async () => ({ count24h: 0, valueUsd24h: 0 }));
    const stage = buildVelocityTrackerStage({
      tracker: { getVelocity },
      getActiveSubjectId: () => null,
    });
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(stage);
    await lifecycle.boot();
    expect(getVelocity).not.toHaveBeenCalled();
  });

  it("force-hydrates the cache for the active subject", async () => {
    const { logger, tracer } = makeLoggerAndTracer();
    const getVelocity = vi.fn(async () => ({ count24h: 3, valueUsd24h: 42 }));
    const stage = buildVelocityTrackerStage({
      tracker: { getVelocity },
      getActiveSubjectId: () => "subject-42",
    });
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(stage);
    await lifecycle.boot();
    expect(getVelocity).toHaveBeenCalledWith("subject-42");
  });
});

/* ─── Integration: all stages together, crash recovery ──────── */

describe("SwLifecycle — crash recovery + cold-start budget", () => {
  it("without onSuspend, durable state is still consistent on next wake", async () => {
    const { logger, tracer } = makeLoggerAndTracer();
    const storage = new MemoryAdapter();

    // Session 1 — SW does work, then is force-killed (no shutdown() call).
    {
      const capture = new AuditCapture();
      const store = new AuditStore(storage);
      capture.onEvent((ev) => {
        store.append(ev).catch(() => {});
      });
      const coordinator = new MerkleBatchCoordinator(
        capture,
        () => {},
        { maxBatchSize: 2, maxBatchAgeMs: 60_000 },
        storage,
      );
      const lifecycle = new SwLifecycle(logger, tracer);
      lifecycle.registerStage(buildStoragePersistenceStage({ storage }));
      lifecycle.registerStage(
        buildAuditChainRehydrationStage({ auditCapture: capture, auditStore: store }),
      );
      lifecycle.registerStage(
        buildMerkleBatchRestorationStage({ coordinator }),
      );
      await lifecycle.boot();

      // Emit 2 events that auto-finalize (maxBatchSize=2).
      capture.record({ kind: "request-received", subjectId: "s1", workspaceId: "w1", detail: { i: 0 } });
      capture.record({ kind: "request-received", subjectId: "s1", workspaceId: "w1", detail: { i: 1 } });
      await new Promise((r) => setTimeout(r, 10));
      // Simulate crash — no `lifecycle.shutdown()` call.
      lifecycle.dispose();
    }

    // Session 2 — fresh boot.
    {
      const capture = new AuditCapture();
      const store = new AuditStore(storage);
      const coordinator = new MerkleBatchCoordinator(
        capture,
        () => {},
        { maxBatchSize: 2, maxBatchAgeMs: 60_000 },
        storage,
      );
      const lifecycle = new SwLifecycle(logger, tracer);
      lifecycle.registerStage(buildStoragePersistenceStage({ storage }));
      lifecycle.registerStage(
        buildAuditChainRehydrationStage({ auditCapture: capture, auditStore: store }),
      );
      lifecycle.registerStage(
        buildMerkleBatchRestorationStage({ coordinator }),
      );
      await lifecycle.boot();

      // Audit chain head is restored — sequenceNumber >= 2.
      expect(capture.getSequenceNumber()).toBeGreaterThanOrEqual(2);
      // Finalized batch survived the crash — coordinator sees it on hydrate.
      expect(coordinator.getFinalizedBatchCount()).toBeGreaterThanOrEqual(1);
    }
  });

  it("ensureBooted() cold-start budget is under 500 ms with all stages", async () => {
    const { logger, tracer } = makeLoggerAndTracer();
    const storage = new MemoryAdapter();

    const capture = new AuditCapture();
    const store = new AuditStore(storage);
    const coordinator = new MerkleBatchCoordinator(
      capture,
      () => {},
      { maxBatchSize: 256, maxBatchAgeMs: 60_000 },
      storage,
    );
    const lifecycle = new SwLifecycle(logger, tracer);
    lifecycle.registerStage(buildStoragePersistenceStage({ storage }));
    lifecycle.registerStage(
      buildAuditChainRehydrationStage({ auditCapture: capture, auditStore: store }),
    );
    lifecycle.registerStage(
      buildMerkleBatchRestorationStage({ coordinator }),
    );
    const pendingApprovals = new Map();
    const { stage: pendingApprovalsStage } = buildPendingApprovalsStage({
      pendingApprovals,
      sessionStorage: new MemorySessionAdapter(),
    });
    lifecycle.registerStage(pendingApprovalsStage);
    lifecycle.registerStage(
      buildNonceManagerStage({
        storage,
        getTxManager: () => ({}) as never,
        getActiveChainId: () => 1,
      }),
    );
    lifecycle.registerStage(
      buildPendingTxTrackerStage({
        tracker: { list: async () => [], markConfirmed: async () => {} },
        getReceiptProbe: () => null,
      }),
    );
    lifecycle.registerStage(
      buildCredentialStoreStage({
        storage,
        getStore: () => ({ toSnapshot: () => [], loadFromSnapshot: () => {} }),
      }),
    );
    lifecycle.registerStage(
      buildWalletConnectSessionStage({
        storage,
        getManager: () => null,
      }),
    );
    lifecycle.registerStage(
      buildVelocityTrackerStage({
        tracker: { getVelocity: async () => ({ count24h: 0, valueUsd24h: 0 }) },
        getActiveSubjectId: () => null,
      }),
    );
    lifecycle.registerStage(
      buildWorkflowEngineStage({
        engine: {
          loadFromSnapshot: () => {},
          toSnapshot: () => ({ requests: [], limits: [] }),
        },
        storage,
      }),
    );

    const started = Date.now();
    await lifecycle.ensureBooted();
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500);

    // Second call is effectively free — the boot is cached.
    const started2 = Date.now();
    await lifecycle.ensureBooted();
    const elapsed2 = Date.now() - started2;
    expect(elapsed2).toBeLessThan(100);
  });
});
