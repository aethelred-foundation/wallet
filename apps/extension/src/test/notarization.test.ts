/**
 * Notarization tests.
 *
 * Coverage:
 *
 *   1. ABI selectors: every selector derives from the stated
 *      signature (keccak256 first 4 bytes) — regression guard.
 *   2. Calldata encoders: exact-byte fixtures; zero-root rejected;
 *      zero-eventCount rejected; uint32 overflow rejected;
 *      malformed bytes32 rejected.
 *   3. Event decoders: BatchAnchored log → OnChainBatchRecord
 *      parses every field; non-matching topic0 returns null;
 *      extractAnchoredRecord throws if no matching log.
 *   4. OnChainAnchorAdapter:
 *        - Happy path: send → confirm → parse → return
 *          AnchoredReceipt.
 *        - Chain-id mismatch rejected at construction.
 *        - Submit failure wrapped as anchor-submit-failed.
 *        - Reverted receipt surfaces anchor-tx-reverted.
 *        - Missing BatchAnchored log surfaces anchor-receipt-missing.
 *        - Submitted-vs-emitted root mismatch caught.
 *        - Empty batch rejected.
 *        - Poll timeout surfaces anchor-confirmation-timeout.
 *   5. NotarizationScheduler:
 *        - start() + tick() runs finalize → notarize → onTick.
 *        - Empty batch tick returns result with no finalized/receipt.
 *        - Adapter throw surfaces in result.error, scheduler stays alive.
 *        - stop() cancels pending timer; subsequent start() throws.
 *        - Double start() throws scheduler-already-running.
 *        - TestClock drives ticks deterministically.
 *   6. AnchoredProof:
 *        - buildAnchoredProof rejects mismatch between proof.root
 *          and record.merkleRoot.
 *        - verifyAnchoredProof passes on legitimate proof.
 *        - verifyAnchoredProof detects tampered leaf.
 *        - compareRecords enumerates every mismatched field.
 */

import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

import { MerkleBatch, type AuditEvent } from "@aethelred/wallet-audit";
import {
  // abi
  SIG_ANCHOR,
  SIG_EVENT_BATCH_ANCHORED,
  SELECTOR_ANCHOR,
  TOPIC_BATCH_ANCHORED,
  // calldata
  encodeAnchor,
  parseBatchAnchoredLog,
  extractAnchoredRecord,
  // adapter
  OnChainAnchorAdapter,
  // scheduler
  NotarizationScheduler,
  TestClock,
  // inclusion
  buildAnchoredProof,
  verifyAnchoredProof,
  compareRecords,
  // errors + types
  NotarizationError,
  type AnchorChainProvider,
  type OnChainBatchRecord,
  type RawLog,
  type TxReceipt,
} from "@aethelred/wallet-notarization";

// ─── Fixtures ────────────────────────────────────────────

const CONTRACT = ("0x" + "c0".repeat(20)) as `0x${string}`;
const SUBMITTER = ("0x" + "aa".repeat(20)) as `0x${string}`;
const ROOT = ("0x" + "ab".repeat(32)) as `0x${string}`;
const TX_HASH = ("0x" + "11".repeat(32)) as `0x${string}`;
const CHAIN_ID = 8453;

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function makeAuditEvent(seq: number): AuditEvent {
  // The audit MerkleBatch validates eventHash as 64-char lowercase
  // hex. Derive stable hashes per seq so tests are deterministic.
  const eventHash = bytesToHex(sha256(utf8(`event-${seq}`)));
  const previousHash = bytesToHex(sha256(utf8(`prev-${seq}`)));
  return {
    id: `ev-${seq}`,
    sequenceNumber: seq,
    timestamp: 1_700_000_000_000 + seq,
    kind: "signing-executed",
    subjectId: "subj-1",
    workspaceId: "ws-1",
    detail: { amount: "1" },
    previousHash,
    eventHash,
  };
}

// A helper `RawLog` for a BatchAnchored event.
function makeAnchoredLog(
  batchId: bigint,
  merkleRoot: `0x${string}`,
  submitter: `0x${string}`,
  timestamp: bigint,
  eventCount: number,
): RawLog {
  const timestampPadded = "00".repeat(32 - 8) + timestamp.toString(16).padStart(16, "0");
  const eventCountPadded = "00".repeat(32 - 4) + eventCount.toString(16).padStart(8, "0");
  return {
    address: CONTRACT,
    topics: [
      TOPIC_BATCH_ANCHORED,
      ("0x" + batchId.toString(16).padStart(64, "0")) as `0x${string}`,
      ("0x" + "00".repeat(12) + submitter.slice(2)) as `0x${string}`,
      merkleRoot,
    ],
    data: ("0x" + timestampPadded + eventCountPadded) as `0x${string}`,
    blockNumber: 12345n,
    transactionHash: TX_HASH,
    logIndex: 0,
  };
}

// ─── ABI selectors ───────────────────────────────────────

describe("ABI selectors", () => {
  it("anchor selector matches keccak256(signature)[0..4]", () => {
    const expected = ("0x" + bytesToHex(keccak_256(utf8(SIG_ANCHOR)).slice(0, 4))) as `0x${string}`;
    expect(SELECTOR_ANCHOR).toBe(expected);
  });

  it("BatchAnchored topic0 matches keccak256(event signature)", () => {
    const expected = ("0x" + bytesToHex(keccak_256(utf8(SIG_EVENT_BATCH_ANCHORED)))) as `0x${string}`;
    expect(TOPIC_BATCH_ANCHORED).toBe(expected);
  });
});

// ─── Calldata encoders ──────────────────────────────────

describe("encodeAnchor", () => {
  it("produces selector + 2 padded words", () => {
    const data = encodeAnchor({ merkleRoot: ROOT, eventCount: 256 });
    // selector (4) + bytes32 (32) + uint32 padded to 32 = 68 bytes = 136 hex chars
    expect(data.length).toBe(2 + 8 + 2 * 64);
    expect(data.startsWith(SELECTOR_ANCHOR)).toBe(true);
    // Last byte of the 2nd word is 0x00, but last 4 bytes = 0x00000100 (256)
    expect(data.slice(-8)).toBe("00000100");
  });

  it("rejects zero root", () => {
    expect(() =>
      encodeAnchor({
        merkleRoot: ("0x" + "00".repeat(32)) as `0x${string}`,
        eventCount: 1,
      }),
    ).toThrow(NotarizationError);
  });

  it("rejects zero eventCount", () => {
    expect(() => encodeAnchor({ merkleRoot: ROOT, eventCount: 0 })).toThrow(
      NotarizationError,
    );
  });

  it("rejects uint32 overflow", () => {
    expect(() => encodeAnchor({ merkleRoot: ROOT, eventCount: 0x1_00000000 })).toThrow(
      NotarizationError,
    );
  });

  it("rejects malformed bytes32", () => {
    expect(() =>
      encodeAnchor({ merkleRoot: "0xdeadbeef" as `0x${string}`, eventCount: 1 }),
    ).toThrow(NotarizationError);
  });
});

// ─── Event decoder ──────────────────────────────────────

describe("parseBatchAnchoredLog + extractAnchoredRecord", () => {
  it("parses all fields", () => {
    const log = makeAnchoredLog(42n, ROOT, SUBMITTER, 1_700_000_000n, 256);
    const record = parseBatchAnchoredLog(log, CHAIN_ID);
    expect(record).not.toBeNull();
    expect(record!.batchId).toBe(42n);
    expect(record!.submitter.toLowerCase()).toBe(SUBMITTER.toLowerCase());
    expect(record!.merkleRoot).toBe(ROOT);
    expect(record!.eventCount).toBe(256);
    expect(record!.timestamp).toBe(1_700_000_000n);
    expect(record!.blockNumber).toBe(12345n);
    expect(record!.transactionHash).toBe(TX_HASH);
    expect(record!.chainId).toBe(CHAIN_ID);
    expect(record!.contract).toBe(CONTRACT);
  });

  it("returns null for non-matching topic0", () => {
    const log: RawLog = {
      address: CONTRACT,
      topics: [("0x" + "ff".repeat(32)) as `0x${string}`],
      data: "0x",
      blockNumber: 0n,
      transactionHash: TX_HASH,
      logIndex: 0,
    };
    expect(parseBatchAnchoredLog(log, CHAIN_ID)).toBeNull();
  });

  it("extractAnchoredRecord throws if no matching log", () => {
    expect(() => extractAnchoredRecord([], CHAIN_ID, CONTRACT)).toThrow(
      NotarizationError,
    );
  });

  it("extractAnchoredRecord ignores logs from other contracts", () => {
    const fromOther = makeAnchoredLog(1n, ROOT, SUBMITTER, 1n, 1);
    const otherContractLog: RawLog = {
      ...fromOther,
      address: ("0x" + "99".repeat(20)) as `0x${string}`,
    };
    expect(() =>
      extractAnchoredRecord([otherContractLog], CHAIN_ID, CONTRACT),
    ).toThrow(NotarizationError);
  });
});

// ─── OnChainAnchorAdapter ───────────────────────────────

describe("OnChainAnchorAdapter", () => {
  function makeProvider(
    opts: {
      sendImpl?: (req: { to: `0x${string}`; data: `0x${string}` }) => Promise<`0x${string}`>;
      receipts?: (txHash: `0x${string}`) => Promise<TxReceipt | null>;
    } = {},
  ): AnchorChainProvider {
    return {
      chainId: CHAIN_ID,
      async sendTransaction(req) {
        if (opts.sendImpl) return opts.sendImpl(req);
        return TX_HASH;
      },
      async getTransactionReceipt(txHash) {
        if (opts.receipts) return opts.receipts(txHash);
        return {
          transactionHash: txHash,
          blockNumber: 12345n,
          status: "success",
          logs: [makeAnchoredLog(7n, ROOT, SUBMITTER, 1_700_000_000n, 2)],
        };
      },
    };
  }

  function finalizedBatch() {
    // Use maxBatchSize > number of events so add() doesn't
    // auto-finalize; we finalize manually below.
    const batch = new MerkleBatch({ maxBatchSize: 100, maxBatchAgeMs: 60_000 });
    batch.add(makeAuditEvent(1));
    batch.add(makeAuditEvent(2));
    const finalized = batch.finalize();
    if (!finalized) throw new Error("expected finalize");
    return finalized;
  }

  it("rejects chain-id mismatch at construction", () => {
    expect(
      () =>
        new OnChainAnchorAdapter({
          provider: makeProvider(),
          contract: CONTRACT,
          chainId: 1,
        }),
    ).toThrow(NotarizationError);
  });

  it("happy path returns AnchoredReceipt with on-chain record", async () => {
    const adapter = new OnChainAnchorAdapter({
      provider: makeProvider(),
      contract: CONTRACT,
      chainId: CHAIN_ID,
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      now: () => 1_700_000_000_000,
      sleep: () => Promise.resolve(),
    });
    // Build a batch whose root happens to be ROOT — do that by
    // constructing a fake batch since MerkleBatch's real root won't
    // match. We inject via the FinalizedBatch shape directly.
    const fake = {
      ...finalizedBatch(),
      root: ROOT.slice(2),
      leafCount: 2,
    };
    const receipt = await adapter.notarize(fake);
    expect(receipt.externalId).toBe(TX_HASH);
    expect(receipt.record.batchId).toBe(7n);
    expect(receipt.record.merkleRoot).toBe(ROOT);
    expect(receipt.record.eventCount).toBe(2);
  });

  it("rejects empty batch", async () => {
    const adapter = new OnChainAnchorAdapter({
      provider: makeProvider(),
      contract: CONTRACT,
      chainId: CHAIN_ID,
    });
    const empty = { ...finalizedBatch(), leafCount: 0 };
    await expect(adapter.notarize(empty)).rejects.toMatchObject({
      code: "batch-empty",
    });
  });

  it("wraps send failure as anchor-submit-failed", async () => {
    const adapter = new OnChainAnchorAdapter({
      provider: makeProvider({
        async sendImpl() {
          throw new Error("rpc unreachable");
        },
      }),
      contract: CONTRACT,
      chainId: CHAIN_ID,
    });
    const fake = { ...finalizedBatch(), root: ROOT.slice(2), leafCount: 2 };
    await expect(adapter.notarize(fake)).rejects.toMatchObject({
      code: "anchor-submit-failed",
    });
  });

  it("surfaces reverted tx", async () => {
    const adapter = new OnChainAnchorAdapter({
      provider: makeProvider({
        async receipts(txHash) {
          return {
            transactionHash: txHash,
            blockNumber: 1n,
            status: "reverted",
            logs: [],
          };
        },
      }),
      contract: CONTRACT,
      chainId: CHAIN_ID,
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      sleep: () => Promise.resolve(),
    });
    const fake = { ...finalizedBatch(), root: ROOT.slice(2), leafCount: 2 };
    await expect(adapter.notarize(fake)).rejects.toMatchObject({
      code: "anchor-tx-reverted",
    });
  });

  it("surfaces missing BatchAnchored log as anchor-receipt-missing", async () => {
    const adapter = new OnChainAnchorAdapter({
      provider: makeProvider({
        async receipts(txHash) {
          return {
            transactionHash: txHash,
            blockNumber: 1n,
            status: "success",
            logs: [], // no event
          };
        },
      }),
      contract: CONTRACT,
      chainId: CHAIN_ID,
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      sleep: () => Promise.resolve(),
    });
    const fake = { ...finalizedBatch(), root: ROOT.slice(2), leafCount: 2 };
    await expect(adapter.notarize(fake)).rejects.toMatchObject({
      code: "anchor-receipt-missing",
    });
  });

  it("detects root mismatch between submitted and emitted", async () => {
    const adapter = new OnChainAnchorAdapter({
      provider: makeProvider({
        async receipts(txHash) {
          return {
            transactionHash: txHash,
            blockNumber: 1n,
            status: "success",
            logs: [
              makeAnchoredLog(
                1n,
                ("0x" + "cd".repeat(32)) as `0x${string}`, // different root
                SUBMITTER,
                1n,
                1,
              ),
            ],
          };
        },
      }),
      contract: CONTRACT,
      chainId: CHAIN_ID,
      pollIntervalMs: 1,
      pollTimeoutMs: 100,
      sleep: () => Promise.resolve(),
    });
    const fake = { ...finalizedBatch(), root: ROOT.slice(2), leafCount: 2 };
    await expect(adapter.notarize(fake)).rejects.toMatchObject({
      code: "anchor-receipt-malformed",
    });
  });

  it("polls until confirmed; times out if nothing ever lands", async () => {
    let elapsed = 0;
    const adapter = new OnChainAnchorAdapter({
      provider: makeProvider({
        async receipts() {
          return null;
        },
      }),
      contract: CONTRACT,
      chainId: CHAIN_ID,
      pollIntervalMs: 10,
      pollTimeoutMs: 30,
      now: () => elapsed,
      sleep: (ms) => {
        elapsed += ms;
        return Promise.resolve();
      },
    });
    const fake = { ...finalizedBatch(), root: ROOT.slice(2), leafCount: 2 };
    await expect(adapter.notarize(fake)).rejects.toMatchObject({
      code: "anchor-confirmation-timeout",
    });
  });
});

// ─── NotarizationScheduler ──────────────────────────────

describe("NotarizationScheduler", () => {
  function makeAdapter(opts: { throwOn?: "notarize" } = {}) {
    const calls: Array<{ batchId: string; root: string }> = [];
    const adapter = {
      async notarize(batch: ReturnType<MerkleBatch["finalize"]>) {
        if (!batch) throw new Error("no batch");
        calls.push({ batchId: batch.batchId, root: batch.root });
        if (opts.throwOn === "notarize") throw new Error("network down");
        return {
          batchId: batch.batchId,
          externalId: TX_HASH,
          publishedAt: 0,
        };
      },
    };
    return { adapter, calls };
  }

  it("tick() runs finalize → notarize → onTick", async () => {
    // >2 so add() doesn't auto-finalize; the scheduler's tick() will
    // call finalize() and notarize the pending batch.
    const batch = new MerkleBatch({ maxBatchSize: 100 });
    batch.add(makeAuditEvent(1));
    batch.add(makeAuditEvent(2));
    const { adapter, calls } = makeAdapter();
    const clock = new TestClock(0);
    const observed: Array<string | undefined> = [];
    const scheduler = new NotarizationScheduler({
      batch,
      adapter,
      clock,
      intervalMs: 100,
      onTick: (r) => observed.push(r.receipt?.externalId),
    });
    const result = await scheduler.tick();
    expect(result.receipt?.externalId).toBe(TX_HASH);
    expect(calls.length).toBe(1);
    expect(observed).toEqual([TX_HASH]);
  });

  it("tick() with empty batch: no finalized, no receipt, no error", async () => {
    const batch = new MerkleBatch({ maxBatchSize: 100 });
    // auto-finalize on age? no — we leave it short. finalize() on
    // empty batch returns null.
    const { adapter } = makeAdapter();
    const clock = new TestClock(0);
    const scheduler = new NotarizationScheduler({
      batch,
      adapter,
      clock,
    });
    const result = await scheduler.tick();
    expect(result.finalized).toBeUndefined();
    expect(result.receipt).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("adapter throw surfaces in result.error without crashing scheduler", async () => {
    const batch = new MerkleBatch({ maxBatchSize: 100 });
    batch.add(makeAuditEvent(1));
    const { adapter } = makeAdapter({ throwOn: "notarize" });
    const clock = new TestClock(0);
    const scheduler = new NotarizationScheduler({
      batch,
      adapter,
      clock,
    });
    const result = await scheduler.tick();
    expect(result.error).toBeDefined();
    expect(result.receipt).toBeUndefined();
    expect(scheduler.currentState).toBe("idle");
  });

  it("start() + stop() lifecycle with TestClock ticks", async () => {
    const batch = new MerkleBatch({ maxBatchSize: 100 });
    batch.add(makeAuditEvent(1));
    batch.add(makeAuditEvent(2));
    const { adapter, calls } = makeAdapter();
    const clock = new TestClock(0);
    const scheduler = new NotarizationScheduler({
      batch,
      adapter,
      clock,
      intervalMs: 100,
    });
    scheduler.start();
    expect(clock.nextFireAt()).toBe(100);
    clock.advance(100);
    // Let the async tick chain settle.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls.length).toBe(1);
    scheduler.stop();
    expect(scheduler.currentState).toBe("stopped");
  });

  it("double start throws scheduler-already-running", () => {
    const batch = new MerkleBatch({ maxBatchSize: 2 });
    const { adapter } = makeAdapter();
    const clock = new TestClock(0);
    const scheduler = new NotarizationScheduler({
      batch,
      adapter,
      clock,
    });
    scheduler.start();
    expect(() => scheduler.start()).toThrow(NotarizationError);
    scheduler.stop();
  });

  it("start after stop throws scheduler-stopped", () => {
    const batch = new MerkleBatch({ maxBatchSize: 2 });
    const { adapter } = makeAdapter();
    const clock = new TestClock(0);
    const scheduler = new NotarizationScheduler({
      batch,
      adapter,
      clock,
    });
    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.start()).toThrow(NotarizationError);
  });
});

// ─── AnchoredProof ──────────────────────────────────────

describe("AnchoredProof", () => {
  function realBatchAndProof() {
    const batch = new MerkleBatch({ maxBatchSize: 100 });
    const ev1 = makeAuditEvent(1);
    const ev2 = makeAuditEvent(2);
    batch.add(ev1);
    batch.add(ev2);
    const finalized = batch.finalize();
    if (!finalized) throw new Error("expected finalize");
    // The audit package keys proofs by eventHash, not by id.
    const proof = finalized.proofs[ev1.eventHash];
    if (!proof) throw new Error("expected proof");
    return { finalized, proof, eventId: ev1.id };
  }

  function makeRecord(root: string, overrides: Partial<OnChainBatchRecord> = {}): OnChainBatchRecord {
    return {
      batchId: 1n,
      submitter: SUBMITTER,
      merkleRoot: (root.startsWith("0x") ? root : `0x${root}`) as `0x${string}`,
      eventCount: 2,
      timestamp: 1_700_000_000n,
      blockNumber: 12345n,
      transactionHash: TX_HASH,
      chainId: CHAIN_ID,
      contract: CONTRACT,
      ...overrides,
    };
  }

  it("buildAnchoredProof accepts matching root", () => {
    const { proof, eventId } = realBatchAndProof();
    const record = makeRecord(proof.root);
    const bundle = buildAnchoredProof({ proof, record, eventId });
    expect(bundle.eventId).toBe(eventId);
    expect(bundle.record.merkleRoot.toLowerCase()).toBe(
      (proof.root.startsWith("0x") ? proof.root : `0x${proof.root}`).toLowerCase(),
    );
  });

  it("buildAnchoredProof rejects root mismatch", () => {
    const { proof, eventId } = realBatchAndProof();
    const record = makeRecord(("0x" + "ff".repeat(32)) as `0x${string}`);
    expect(() => buildAnchoredProof({ proof, record, eventId })).toThrow(
      NotarizationError,
    );
  });

  it("verifyAnchoredProof passes on legitimate bundle", () => {
    const { proof, eventId } = realBatchAndProof();
    const record = makeRecord(proof.root);
    const bundle = buildAnchoredProof({ proof, record, eventId });
    expect(() => verifyAnchoredProof(bundle)).not.toThrow();
  });

  it("verifyAnchoredProof detects tampered leaf", () => {
    const { proof, eventId } = realBatchAndProof();
    const record = makeRecord(proof.root);
    const tamperedLeaf = bytesToHex(sha256(utf8("different event")));
    const bundle = buildAnchoredProof({
      proof: { ...proof, leaf: tamperedLeaf },
      record,
      eventId,
    });
    expect(() => verifyAnchoredProof(bundle)).toThrow(NotarizationError);
  });

  it("compareRecords enumerates every mismatched field", () => {
    const a = makeRecord(ROOT);
    const b = makeRecord(ROOT, {
      batchId: 2n,
      merkleRoot: ("0x" + "ff".repeat(32)) as `0x${string}`,
      eventCount: 5,
    });
    const result = compareRecords(a, b);
    expect(result.matches).toBe(false);
    expect(result.mismatches).toContain("batchId");
    expect(result.mismatches).toContain("merkleRoot");
    expect(result.mismatches).toContain("eventCount");
  });

  it("compareRecords returns matches=true for identical records", () => {
    const a = makeRecord(ROOT);
    const b = makeRecord(ROOT);
    expect(compareRecords(a, b).matches).toBe(true);
  });
});
