/**
 * Merkle-batching primitives — correctness tests.
 *
 * These tests cover the tamper-evidence contract of `MerkleBatch`:
 *  - Root construction matches the canonical SHA-256 "double-odd" rule
 *    used by BIP141-style trees.
 *  - Inclusion proofs verify independently, without the batch instance
 *    (which is how an external auditor would verify them).
 *  - Any tampering of the leaf, a sibling, or the advertised root breaks
 *    verification.
 *  - Proofs from one batch never collide with proofs from another.
 *  - Auto-finalization respects both the size and age thresholds.
 *  - The notarization adapter receives a finalized batch whose metadata
 *    matches what was published.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import {
  MerkleBatch,
  MerkleBatchError,
  verifyMerkleProof,
  type AuditEvent,
  type BatchNotarizationAdapter,
  type FinalizedBatch,
  type NotarizationReceipt,
} from "@aethelred/wallet-audit";

/**
 * Build a synthetic AuditEvent with a deterministic SHA-256 `eventHash`.
 * We hash a per-event tag so every event produced by the helper has a
 * different leaf; this keeps the "no hash collisions" behaviour honest
 * and mirrors how AuditCapture assigns hashes in production.
 */
function makeEvent(seq: number, tag = ""): AuditEvent {
  const hash = bytesToHex(
    sha256(new TextEncoder().encode(`event-${seq}-${tag}`)),
  );
  return {
    id: `evt-${seq}`,
    sequenceNumber: seq,
    timestamp: 1_700_000_000_000 + seq,
    kind: "request-received",
    subjectId: "subj-1",
    workspaceId: "ws-1",
    detail: { seq },
    previousHash:
      "0000000000000000000000000000000000000000000000000000000000000000",
    eventHash: hash,
  };
}

/** Reference hash for two leaves: sha256(hexToBytes(a) || hexToBytes(b)). */
function referenceHashPair(a: string, b: string): string {
  const la = hexToBytes(a);
  const lb = hexToBytes(b);
  const combined = new Uint8Array(la.length + lb.length);
  combined.set(la, 0);
  combined.set(lb, la.length);
  return bytesToHex(sha256(combined));
}

describe("MerkleBatch", () => {
  describe("root construction", () => {
    /**
     * A single-leaf tree has no interior nodes, so by convention the
     * root equals the leaf. Proves the degenerate case is handled.
     */
    it("single-event batch → root equals the event hash", () => {
      const batch = new MerkleBatch();
      const e = makeEvent(1);
      batch.add(e);
      const finalized = batch.finalize();
      expect(finalized).not.toBeNull();
      expect(finalized!.root).toBe(e.eventHash);
      expect(finalized!.leafCount).toBe(1);
    });

    /**
     * Two leaves combine into a single parent via
     * sha256(leftBytes || rightBytes). Proves the canonical pair-hashing
     * rule is implemented correctly.
     */
    it("two-event batch → root is sha256(hash1 || hash2)", () => {
      const batch = new MerkleBatch();
      const e1 = makeEvent(1);
      const e2 = makeEvent(2);
      batch.add(e1);
      batch.add(e2);
      const finalized = batch.finalize()!;
      expect(finalized.root).toBe(referenceHashPair(e1.eventHash, e2.eventHash));
    });

    /**
     * Odd-count trees duplicate the last node at every level that is
     * itself odd. We recompute the expected root with the same rule and
     * assert equality — proves the double-odd construction matches the
     * BIP141-style reference.
     */
    it("odd-count batch → last node is duplicated per level", () => {
      const batch = new MerkleBatch();
      const es = [makeEvent(1), makeEvent(2), makeEvent(3)];
      for (const e of es) batch.add(e);
      const finalized = batch.finalize()!;

      // Level 0 (leaves): h1, h2, h3
      // Level 1: H(h1||h2), H(h3||h3)
      const parent01 = referenceHashPair(es[0].eventHash, es[1].eventHash);
      const parent22 = referenceHashPair(es[2].eventHash, es[2].eventHash);
      // Level 2 (root): H(parent01 || parent22)
      const expectedRoot = referenceHashPair(parent01, parent22);
      expect(finalized.root).toBe(expectedRoot);
      expect(finalized.leafCount).toBe(3);
    });
  });

  describe("inclusion proofs", () => {
    /**
     * For every leaf in a batch, the stored proof must recompute the
     * finalized root. Proves the proof-building logic is symmetric with
     * the root-building logic — i.e. an auditor can actually verify
     * inclusion.
     */
    it("every event in a finalized batch has a proof that verifies", () => {
      const batch = new MerkleBatch();
      const events = Array.from({ length: 7 }, (_, i) => makeEvent(i + 1));
      for (const e of events) batch.add(e);
      const finalized = batch.finalize()!;

      for (const e of events) {
        const proof = batch.getProof(e.eventHash);
        expect(proof).toBeDefined();
        expect(proof!.root).toBe(finalized.root);
        expect(proof!.leaf).toBe(e.eventHash);
        expect(verifyMerkleProof(proof!)).toBe(true);
      }
    });

    /**
     * Mutating any sibling in a valid proof must invalidate it — this
     * is the core tamper-evidence guarantee. If this fails, a malicious
     * exporter could rewrite siblings to forge inclusion.
     */
    it("tampered sibling hash fails verification", () => {
      const batch = new MerkleBatch();
      const events = Array.from({ length: 4 }, (_, i) => makeEvent(i + 1));
      for (const e of events) batch.add(e);
      batch.finalize();

      const proof = batch.getProof(events[2].eventHash)!;
      expect(verifyMerkleProof(proof)).toBe(true);

      // Flip one character in the first sibling (staying within hex).
      const tamperedSibling =
        proof.siblings[0][0] === "0"
          ? "1" + proof.siblings[0].slice(1)
          : "0" + proof.siblings[0].slice(1);
      const tampered = {
        ...proof,
        siblings: [tamperedSibling, ...proof.siblings.slice(1)],
      };
      expect(verifyMerkleProof(tampered)).toBe(false);
    });

    /**
     * Mutating the advertised root must invalidate verification even if
     * every other field is correct. Proves the verifier actually checks
     * the root instead of trusting the proof blob.
     */
    it("tampered root fails verification", () => {
      const batch = new MerkleBatch();
      const events = Array.from({ length: 4 }, (_, i) => makeEvent(i + 1));
      for (const e of events) batch.add(e);
      batch.finalize();

      const proof = batch.getProof(events[0].eventHash)!;
      const tampered = {
        ...proof,
        root:
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      };
      expect(verifyMerkleProof(tampered)).toBe(false);
    });

    /**
     * Replacing the leaf hash (as an attacker would to swap the
     * underlying event) must fail verification — keeps the leaf bound
     * to the event body via the AuditCapture hash.
     */
    it("tampered leaf hash fails verification", () => {
      const batch = new MerkleBatch();
      const events = Array.from({ length: 5 }, (_, i) => makeEvent(i + 1));
      for (const e of events) batch.add(e);
      batch.finalize();

      const proof = batch.getProof(events[3].eventHash)!;
      const tampered = {
        ...proof,
        leaf: bytesToHex(sha256(new TextEncoder().encode("tampered"))),
      };
      expect(verifyMerkleProof(tampered)).toBe(false);
    });

    /**
     * A proof from batch A has root A; a proof from batch B has root B.
     * Swapping the root between proofs must fail — proves per-batch
     * isolation, i.e. roots don't accidentally collide across batches.
     */
    it("proof from batch A does not verify under batch B's root", () => {
      const batchA = new MerkleBatch();
      const eventsA = Array.from({ length: 3 }, (_, i) => makeEvent(i + 1, "A"));
      for (const e of eventsA) batchA.add(e);
      const finalizedA = batchA.finalize()!;

      const batchB = new MerkleBatch();
      const eventsB = Array.from({ length: 3 }, (_, i) =>
        makeEvent(i + 100, "B"),
      );
      for (const e of eventsB) batchB.add(e);
      const finalizedB = batchB.finalize()!;

      expect(finalizedA.root).not.toBe(finalizedB.root);

      const proofA = batchA.getProof(eventsA[1].eventHash)!;
      expect(verifyMerkleProof(proofA)).toBe(true);

      const crossed = { ...proofA, root: finalizedB.root };
      expect(verifyMerkleProof(crossed)).toBe(false);
    });
  });

  describe("batch lifecycle", () => {
    /**
     * Adding `maxBatchSize` events must auto-finalize without an
     * explicit `finalize()` call. Proves the size-trigger fires and
     * resets the open batch so subsequent adds start a fresh one.
     */
    it("auto-finalizes when maxBatchSize is reached", () => {
      const batch = new MerkleBatch({ maxBatchSize: 3 });
      batch.add(makeEvent(1));
      batch.add(makeEvent(2));
      expect(batch.getCurrentBatchSize()).toBe(2);

      batch.add(makeEvent(3));
      // Auto-finalization should have reset the open batch.
      expect(batch.getCurrentBatchSize()).toBe(0);

      // The proof for the 3rd event should now exist.
      const proof = batch.getProof(makeEvent(3).eventHash);
      expect(proof).toBeDefined();
      expect(verifyMerkleProof(proof!)).toBe(true);
    });

    /**
     * Finalizing an empty batch is a no-op that returns null. Prevents
     * downstream code from accidentally producing zero-leaf "batches"
     * and notarizing meaningless roots.
     */
    it("finalize() returns null when no events are pending", () => {
      const batch = new MerkleBatch();
      expect(batch.finalize()).toBeNull();
    });

    /**
     * Finalized metadata must reflect the actual sequence range of the
     * events in the batch. Auditors use these bounds to cross-check
     * against the underlying AuditStore.
     */
    it("finalized batch records first/last sequence numbers", () => {
      const batch = new MerkleBatch();
      batch.add(makeEvent(10));
      batch.add(makeEvent(11));
      batch.add(makeEvent(12));
      const finalized = batch.finalize()!;
      expect(finalized.firstSequenceNumber).toBe(10);
      expect(finalized.lastSequenceNumber).toBe(12);
      expect(finalized.leafCount).toBe(3);
    });

    /**
     * Adding the same event twice within one open batch must throw —
     * duplicates would break the O(1) proof lookup map since both
     * leaves would collide on the same key.
     */
    it("rejects duplicate eventHash within the same open batch", () => {
      const batch = new MerkleBatch();
      const e = makeEvent(1);
      batch.add(e);
      expect(() => batch.add(e)).toThrow(MerkleBatchError);
    });

    /**
     * Config sanity check: non-positive thresholds must fail fast at
     * construction. A zero batch size would deadlock add(); negative
     * age would auto-finalize every event into its own batch.
     */
    it("rejects invalid config at construction", () => {
      expect(() => new MerkleBatch({ maxBatchSize: 0 })).toThrow(
        MerkleBatchError,
      );
      expect(() => new MerkleBatch({ maxBatchAgeMs: 0 })).toThrow(
        MerkleBatchError,
      );
    });
  });

  describe("notarization", () => {
    beforeEach(() => {
      vi.useRealTimers();
    });

    /**
     * The adapter must receive exactly the `FinalizedBatch` the class
     * produced, and the returned receipt must flow back to the caller.
     * Proves the wiring between batch state and adapter is correct.
     */
    it("adapter receives the finalized batch with matching metadata", async () => {
      const batch = new MerkleBatch({ maxBatchSize: 16 });
      const events = Array.from({ length: 4 }, (_, i) => makeEvent(i + 1));
      for (const e of events) batch.add(e);
      const finalized = batch.finalize()!;

      const adapter: BatchNotarizationAdapter = {
        notarize: vi.fn(
          async (b: FinalizedBatch): Promise<NotarizationReceipt> => ({
            batchId: b.batchId,
            externalId: `0x${b.root}`,
            publishedAt: 42,
            verifyUrl: `https://example.invalid/${b.batchId}`,
          }),
        ),
      };
      batch.setNotarizationAdapter(adapter);

      const receipts = await batch.notarizeFinalized();
      expect(receipts).toHaveLength(1);
      expect(adapter.notarize).toHaveBeenCalledTimes(1);
      const passed = (adapter.notarize as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as FinalizedBatch;
      expect(passed.batchId).toBe(finalized.batchId);
      expect(passed.root).toBe(finalized.root);
      expect(passed.leafCount).toBe(finalized.leafCount);
      expect(passed.firstSequenceNumber).toBe(finalized.firstSequenceNumber);
      expect(passed.lastSequenceNumber).toBe(finalized.lastSequenceNumber);
      expect(receipts[0].externalId).toBe(`0x${finalized.root}`);
    });

    /**
     * Calling `notarizeFinalized` twice must not re-publish already
     * notarized batches — idempotence is a correctness requirement for
     * a production L1 adapter that charges per transaction.
     */
    it("notarization is idempotent across repeated calls", async () => {
      const batch = new MerkleBatch();
      batch.add(makeEvent(1));
      batch.finalize();

      const notarize = vi.fn(
        async (b: FinalizedBatch): Promise<NotarizationReceipt> => ({
          batchId: b.batchId,
          externalId: `0x${b.root}`,
          publishedAt: Date.now(),
        }),
      );
      batch.setNotarizationAdapter({ notarize });

      const first = await batch.notarizeFinalized();
      const second = await batch.notarizeFinalized();
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
      expect(notarize).toHaveBeenCalledTimes(1);
    });

    /**
     * Calling `notarizeFinalized` without an adapter must fail loudly —
     * silently succeeding would let a misconfigured wallet believe its
     * roots are notarized when they never left the process.
     */
    it("throws if no adapter is configured", async () => {
      const batch = new MerkleBatch();
      batch.add(makeEvent(1));
      batch.finalize();
      await expect(batch.notarizeFinalized()).rejects.toBeInstanceOf(
        MerkleBatchError,
      );
    });
  });

  describe("age-based auto-finalization", () => {
    /**
     * Once an open batch's age exceeds `maxBatchAgeMs`, the next `add`
     * call must finalize the old batch and open a fresh one for the
     * new event. Proves the age trigger fires without external timers.
     */
    it("finalizes the current batch when the age threshold is exceeded", () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date(1_700_000_000_000));
        const batch = new MerkleBatch({ maxBatchAgeMs: 1000, maxBatchSize: 1000 });
        batch.add(makeEvent(1));
        batch.add(makeEvent(2));
        expect(batch.getCurrentBatchSize()).toBe(2);

        // Advance past the age threshold — the next add should close
        // the previous batch before accepting the new event.
        vi.advanceTimersByTime(1500);
        batch.add(makeEvent(3));
        expect(batch.getCurrentBatchSize()).toBe(1);

        // The previous two events must have a proof now.
        const proof1 = batch.getProof(makeEvent(1).eventHash);
        const proof2 = batch.getProof(makeEvent(2).eventHash);
        expect(proof1).toBeDefined();
        expect(proof2).toBeDefined();
        expect(verifyMerkleProof(proof1!)).toBe(true);
        expect(verifyMerkleProof(proof2!)).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
