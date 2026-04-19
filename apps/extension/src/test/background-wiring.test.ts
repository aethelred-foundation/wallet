/**
 * Integration tests for the Round 2 primitives wired into the
 * background service worker.
 *
 * The real `background.ts` is a service-worker-scoped module that pulls
 * in Chrome runtime globals at import time, so directly importing it
 * from a vitest suite is not tractable. Instead, these tests exercise
 * the SAME primitives the background wires:
 *
 *   1. MerkleBatchCoordinator + AuditCapture — the coordinator that
 *      funnels every audit event into a Merkle batch, persists raw
 *      events + finalized batches, and fires a callback on finalization.
 *   2. PendingTxTracker + tx-replacement helpers — the end-to-end
 *      speed-up + cancel flow background's `tx-speed-up` / `tx-cancel`
 *      handlers orchestrate.
 *   3. TokenAllowanceResolver — the graceful-fail surface the
 *      `get-token-allowances` handler sits behind.
 *
 * Every test uses an in-memory storage adapter so runs are hermetic.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AuditCapture,
  verifyMerkleProof,
  type FinalizedBatch,
} from "@aethelred/wallet-audit";
import {
  PendingTxTracker,
  type PendingTxStorageAdapter,
  type TrackedPendingTransaction,
} from "@aethelred/wallet-chain";
import {
  computeReplacementGas,
  buildSpeedUpTransaction,
  buildCancelTransaction,
  type OriginalTransaction,
} from "@aethelred/wallet-core";
import {
  MerkleBatchCoordinator,
  type MerkleBatchStorageAdapter,
} from "../background/merkle-batch-coordinator";
import {
  TokenAllowanceResolver,
  TokenAllowanceResolverError,
} from "../background/token-allowance-resolver";

/* ─── Test fixtures ─────────────────────────────────────────── */

const SENDER = "0x2c7536e3605d9c16a7a3d7b1898e529396a65c23" as `0x${string}`;
const RECIPIENT = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const CHAIN_ID = 1;

/**
 * In-memory storage adapter shared by MerkleBatchCoordinator and
 * PendingTxTracker. Mirrors the `chrome.storage.local` shape minus the
 * extension-specific sugar.
 */
class MemoryAdapter
  implements MerkleBatchStorageAdapter, PendingTxStorageAdapter
{
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
  snapshot(): Map<string, string> {
    return new Map(this.store);
  }
}

/** Handy audit-event options the real background records. */
function emitAudit(capture: AuditCapture, index: number): void {
  capture.record({
    kind: "request-received",
    subjectId: "subj-1",
    workspaceId: "ws-1",
    detail: { sequence: index, method: "eth_sendTransaction" },
  });
}

function eip1559Tx(
  overrides?: Partial<OriginalTransaction>,
): OriginalTransaction {
  return {
    nonce: 42,
    to: RECIPIENT,
    value: 10n ** 18n,
    data: "0x",
    chainId: CHAIN_ID,
    type: "eip1559",
    maxFeePerGas: 20n * 10n ** 9n,
    maxPriorityFeePerGas: 2n * 10n ** 9n,
    gasLimit: 21_000n,
    ...overrides,
  };
}

function sampleTracked(
  overrides?: Partial<TrackedPendingTransaction>,
): TrackedPendingTransaction {
  return {
    txHash: "0xaaa1" as `0x${string}`,
    nonce: 42,
    fromAddress: SENDER,
    chainId: CHAIN_ID,
    submittedAt: 1_700_000_000_000,
    original: eip1559Tx(),
    ...overrides,
  };
}

/* ─── MerkleBatchCoordinator ────────────────────────────────── */

describe("MerkleBatchCoordinator — background wiring", () => {
  let capture: AuditCapture;
  let adapter: MemoryAdapter;

  beforeEach(() => {
    capture = new AuditCapture();
    adapter = new MemoryAdapter();
  });

  it("auto-finalizes once maxBatchSize events have been captured", async () => {
    const finalized: FinalizedBatch[] = [];
    const coordinator = new MerkleBatchCoordinator(
      capture,
      (batch) => {
        finalized.push(batch);
      },
      { maxBatchSize: 4, maxBatchAgeMs: 60_000 },
      adapter,
    );
    await coordinator.start();

    for (let i = 0; i < 4; i++) emitAudit(capture, i);

    // Allow any internal async persistence to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(finalized).toHaveLength(1);
    expect(finalized[0].leafCount).toBe(4);
    expect(finalized[0].root).toMatch(/^[0-9a-f]{64}$/);
    expect(coordinator.getFinalizedBatchCount()).toBe(1);
    expect(coordinator.getPendingEventCount()).toBe(0);
  });

  it("emits onBatchFinalized with sequence-number metadata", async () => {
    const callback = vi.fn();
    const coordinator = new MerkleBatchCoordinator(
      capture,
      callback,
      { maxBatchSize: 2, maxBatchAgeMs: 60_000 },
      adapter,
    );
    await coordinator.start();

    emitAudit(capture, 0);
    emitAudit(capture, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callback).toHaveBeenCalledTimes(1);
    const batch: FinalizedBatch = callback.mock.calls[0][0];
    expect(batch.firstSequenceNumber).toBe(1);
    expect(batch.lastSequenceNumber).toBe(2);
    expect(batch.leafCount).toBe(2);
    expect(Object.keys(batch.proofs)).toHaveLength(2);
  });

  it("getProof returns a verifiable inclusion proof for finalized events", async () => {
    const finalized: FinalizedBatch[] = [];
    const coordinator = new MerkleBatchCoordinator(
      capture,
      (batch) => {
        finalized.push(batch);
      },
      { maxBatchSize: 3 },
      adapter,
    );
    await coordinator.start();

    const hashes: string[] = [];
    capture.onEvent((e) => hashes.push(e.eventHash));
    for (let i = 0; i < 3; i++) emitAudit(capture, i);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(finalized).toHaveLength(1);
    for (const h of hashes) {
      const proof = coordinator.getProof(h);
      expect(proof).toBeDefined();
      expect(verifyMerkleProof(proof!)).toBe(true);
    }
  });

  it("flush() finalizes an open batch even when below the size threshold", async () => {
    const coordinator = new MerkleBatchCoordinator(
      capture,
      () => {},
      { maxBatchSize: 100, maxBatchAgeMs: 60_000 },
      adapter,
    );
    await coordinator.start();

    emitAudit(capture, 0);
    emitAudit(capture, 1);
    expect(coordinator.getPendingEventCount()).toBe(2);

    const finalized = await coordinator.flush();
    expect(finalized).not.toBeNull();
    expect(finalized!.leafCount).toBe(2);
    expect(coordinator.getPendingEventCount()).toBe(0);
  });

  it("flush() returns null when the open batch is empty", async () => {
    const coordinator = new MerkleBatchCoordinator(
      capture,
      () => {},
      { maxBatchSize: 100 },
      adapter,
    );
    await coordinator.start();
    const result = await coordinator.flush();
    expect(result).toBeNull();
  });

  it("persists raw events as-they-arrive (defensive against SW eviction)", async () => {
    const coordinator = new MerkleBatchCoordinator(
      capture,
      () => {},
      { maxBatchSize: 1000 },
      adapter,
    );
    await coordinator.start();
    emitAudit(capture, 0);
    emitAudit(capture, 1);
    emitAudit(capture, 2);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stored = await adapter.get("raw-audit-events");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  it("restores batch state from persistence on a fresh instance", async () => {
    const first = new MerkleBatchCoordinator(
      capture,
      () => {},
      { maxBatchSize: 2 },
      adapter,
    );
    await first.start();
    emitAudit(capture, 0);
    emitAudit(capture, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(first.getFinalizedBatchCount()).toBe(1);

    // Snapshot the storage to simulate SW death — new coordinator reads
    // persisted batches via hydrate().
    const replayCapture = new AuditCapture();
    const second = new MerkleBatchCoordinator(
      replayCapture,
      () => {},
      { maxBatchSize: 2 },
      adapter,
    );
    await second.start();
    expect(second.getFinalizedBatchCount()).toBe(1);
  });

  it("stop() unsubscribes from the audit capture stream", async () => {
    const callback = vi.fn();
    const coordinator = new MerkleBatchCoordinator(
      capture,
      callback,
      { maxBatchSize: 1 },
      adapter,
    );
    await coordinator.start();
    emitAudit(capture, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledTimes(1);

    coordinator.stop();
    emitAudit(capture, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(callback).toHaveBeenCalledTimes(1); // unchanged
  });

  it("getProof returns undefined for unknown event hashes", async () => {
    const coordinator = new MerkleBatchCoordinator(
      capture,
      () => {},
      { maxBatchSize: 2 },
      adapter,
    );
    await coordinator.start();
    const proof = coordinator.getProof(
      "0".repeat(64),
    );
    expect(proof).toBeUndefined();
  });
});

/* ─── tx-replacement flow ───────────────────────────────────── */

describe("tx-replacement flow — background wiring", () => {
  it("speed-up path marks original as replaced after broadcast", async () => {
    const adapter = new MemoryAdapter();
    const tracker = new PendingTxTracker(adapter);
    const original = sampleTracked();
    await tracker.add(original);

    // The background's tx-speed-up handler runs these steps inline:
    const list = await tracker.list();
    const match = list.find(
      (t) => t.txHash.toLowerCase() === original.txHash.toLowerCase(),
    );
    expect(match).toBeDefined();

    const suggestion = computeReplacementGas(match!.original);
    const replacement = buildSpeedUpTransaction(match!.original, suggestion);
    expect(replacement.nonce).toBe(original.original.nonce);
    expect(replacement.to).toBe(original.original.to);
    expect(replacement.value).toBe(original.original.value);

    // Simulate successful broadcast with a new hash.
    const replacementHash = "0xbbb2" as `0x${string}`;
    await tracker.markReplaced(original.txHash, replacementHash, "speed-up");

    const [after] = await tracker.list();
    expect(after.replacedBy).toBe(replacementHash);
    expect(after.replacementKind).toBe("speed-up");
  });

  it("cancel path replaces recipient with sender and zeroes value", async () => {
    const original = sampleTracked();
    const suggestion = computeReplacementGas(original.original);
    const cancel = buildCancelTransaction(
      original.original,
      original.fromAddress,
      suggestion,
    );
    expect(cancel.to.toLowerCase()).toBe(SENDER.toLowerCase());
    expect(cancel.value).toBe(0n);
    expect(cancel.data).toBe("0x");
    expect(cancel.nonce).toBe(original.original.nonce);
  });

  it("markConfirmed(replacementHash) evicts both the replacement and the original", async () => {
    const adapter = new MemoryAdapter();
    const tracker = new PendingTxTracker(adapter);
    await tracker.add(sampleTracked());
    // Register the replacement with its OWN row (what the real
    // execute-tx handler does after broadcasting the new hash).
    await tracker.add(
      sampleTracked({ txHash: "0xbbb2" as `0x${string}`, nonce: 42 }),
    );
    await tracker.markReplaced("0xaaa1", "0xbbb2", "cancel");
    await tracker.markConfirmed("0xbbb2");
    const remaining = await tracker.list();
    expect(remaining).toHaveLength(0);
  });
});

/* ─── TokenAllowanceResolver ─────────────────────────────────── */

describe("TokenAllowanceResolver — graceful-fail surface", () => {
  it("resolveAllowances returns [] without throwing", async () => {
    // RpcClient is untouched by the stub, so a structural fake is fine.
    const fakeRpc = { call: vi.fn() } as unknown as import("@aethelred/wallet-chain").RpcClient;
    const resolver = new TokenAllowanceResolver(fakeRpc);
    const result = await resolver.resolveAllowances(SENDER, CHAIN_ID);
    expect(result).toEqual([]);
  });

  it("subscribeApprovals returns a no-op unsubscribe", async () => {
    const fakeRpc = { call: vi.fn() } as unknown as import("@aethelred/wallet-chain").RpcClient;
    const resolver = new TokenAllowanceResolver(fakeRpc);
    const unsubscribe = resolver.subscribeApprovals(
      SENDER,
      CHAIN_ID,
      () => {},
    );
    expect(typeof unsubscribe).toBe("function");
    // The no-op unsubscribe must not throw.
    expect(() => unsubscribe()).not.toThrow();
  });

  it("resolveAllowances rejects malformed addresses with a typed error", async () => {
    const fakeRpc = { call: vi.fn() } as unknown as import("@aethelred/wallet-chain").RpcClient;
    const resolver = new TokenAllowanceResolver(fakeRpc);
    await expect(
      resolver.resolveAllowances("not-an-address", CHAIN_ID),
    ).rejects.toBeInstanceOf(TokenAllowanceResolverError);
  });

  it("resolveAllowances rejects invalid chainIds with a typed error", async () => {
    const fakeRpc = { call: vi.fn() } as unknown as import("@aethelred/wallet-chain").RpcClient;
    const resolver = new TokenAllowanceResolver(fakeRpc);
    await expect(
      resolver.resolveAllowances(SENDER, -1),
    ).rejects.toBeInstanceOf(TokenAllowanceResolverError);
  });
});
