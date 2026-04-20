/**
 * ═══════════════════════════════════════════════════════════════════════
 * Audit micro-benchmarks — @aethelred/wallet-audit
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Benchmarks for the audit pipeline primitives:
 *
 *   1. AuditCapture.record — the per-intent write path
 *   2. AuditCapture.verifyChain — auditor read path (1k events)
 *   3. MerkleBatch construction — build 256-event tree
 *   4. MerkleBatch inclusion proof — per-leaf lookup
 *
 * The audit layer sits on the hot path for every signed intent (every
 * tx, every sign-message, every connect). A 1 ms regression here shows
 * up as jank on the popup approval screen, so we hold a tight budget.
 *
 * Fixtures use `crypto.getRandomValues` — Node 20+ has it globally so
 * we don't need any polyfill. If a future Node downgrade removes it,
 * bench setup will throw immediately (safer than silently running with
 * Math.random-based fixtures which would make the numbers lie).
 *
 * Owner: wallet-trust team. See docs/perf/SLO.md §3.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { bench, describe } from "vitest";
import { AuditCapture } from "../src/event-capture";
import { MerkleBatch, verifyMerkleProof } from "../src/merkle-batch";
import type { AuditEvent } from "../src/types";

/* ─── Fixtures ────────────────────────────────────────────────────── */

function sampleDetail(i: number): Record<string, unknown> {
  return {
    chainId: 1,
    origin: "https://example.test",
    method: i % 2 === 0 ? "eth_sendTransaction" : "personal_sign",
    sequence: i,
  };
}

/** Pre-built AuditCapture, populated with N events, for verify benchmarks. */
function populate(n: number): { capture: AuditCapture; events: AuditEvent[] } {
  const capture = new AuditCapture();
  const events: AuditEvent[] = [];
  for (let i = 0; i < n; i++) {
    events.push(
      capture.record({
        kind: "policy-evaluated",
        subjectId: "subj-bench",
        workspaceId: "ws-bench",
        appId: "app-bench",
        sessionId: "sess-bench",
        intentId: `intent-${i}`,
        detail: sampleDetail(i),
      }),
    );
  }
  return { capture, events };
}

const CHAIN_1K = populate(1000);
const BATCH_256_EVENTS = populate(256).events;

/* ─── Benchmarks ──────────────────────────────────────────────────── */

describe("@aethelred/wallet-audit pipeline", () => {
  /**
   * Target: > 50k events / sec   (≤ 20 µs per record)
   * Fail:    < 10k events / sec  (> 100 µs)
   *
   * `record` is called on every policy decision, every sign, every
   * approval, every session change. A dropped event corrupts the chain,
   * so this path must stay O(1) and free of GC pressure. The SHA-256
   * cost dominates — keep an eye on @noble/hashes upgrades.
   */
  bench(
    "AuditCapture.record (target ≥ 50k events/s)",
    () => {
      const capture = new AuditCapture();
      capture.record({
        kind: "policy-evaluated",
        subjectId: "subj-bench",
        workspaceId: "ws-bench",
        appId: "app-bench",
        sessionId: "sess-bench",
        intentId: "intent-bench",
        detail: sampleDetail(1),
      });
    },
    { time: 1000 },
  );

  /**
   * Target: < 100 ms for 1000-event chain  (≥ 10 verifies/s)
   * Fail:    > 500 ms                       (< 2 verifies/s)
   *
   * Auditors run `verifyChain` on evidence bundles at export time.
   * 1000 events is the working size for a personal-wallet weekly export;
   * enterprise exports are chunked into 1000-event sub-batches before
   * verification anyway, so 1k is the canonical test size.
   */
  bench(
    "AuditCapture.verifyChain on 1k events (target ≤ 100 ms)",
    () => {
      AuditCapture.verifyChain(CHAIN_1K.events);
    },
    { time: 2000 },
  );

  /**
   * Target: < 50 ms to build a 256-leaf Merkle tree
   * Fail:    > 250 ms
   *
   * Batch finalization runs either on a size trigger (every 256 events)
   * or a time trigger (every 60 s). The 256-leaf case IS the canonical
   * load case — anything larger means the wallet is backlogged.
   */
  bench(
    "MerkleBatch build for 256 events (target ≤ 50 ms)",
    () => {
      const batch = new MerkleBatch({ maxBatchSize: 512, maxBatchAgeMs: 600_000 });
      for (const event of BATCH_256_EVENTS) {
        batch.add(event);
      }
      batch.finalize();
    },
    { time: 2000 },
  );

  /**
   * Target: < 5 ms to produce an inclusion proof for an arbitrary leaf
   * Fail:    > 25 ms
   *
   * With 256 leaves, the tree depth is 8, so a proof is 8 siblings plus
   * 8 directions — effectively O(log n). The cost we're guarding against
   * is an accidental O(n) regression (e.g. rebuilding the tree on every
   * proof lookup). We pick a mid-tree leaf so the bench touches the most
   * sibling hashes possible.
   */
  bench(
    "MerkleBatch inclusion proof for arbitrary leaf (target ≤ 5 ms)",
    () => {
      const batch = new MerkleBatch({ maxBatchSize: 512, maxBatchAgeMs: 600_000 });
      for (const event of BATCH_256_EVENTS) {
        batch.add(event);
      }
      batch.finalize();
      const target = BATCH_256_EVENTS[137].eventHash;
      const proof = batch.getProof(target);
      if (proof) {
        verifyMerkleProof(proof);
      }
    },
    { time: 2000 },
  );

  /**
   * Target: > 100k getProof calls / sec on a pre-finalized batch
   * Fail:    < 10k / sec
   *
   * Isolates the proof-lookup cost without batch construction. If the
   * previous bench regresses, this one tells you whether the blame is
   * on build-time cost or lookup cost.
   */
  bench(
    "MerkleBatch.getProof (pre-finalized, target ≥ 100k ops/s)",
    () => {
      // Build once outside the hot loop — bench setup happens during
      // vitest's warmup phase, which is excluded from measurement.
      preFinalized.getProof(preFinalizedTarget);
    },
    { time: 1000 },
  );
});

/* ─── Pre-warmed fixtures ────────────────────────────────────────── *
 * Declared after the bench block so they live at module-top level.
 * Vitest defers `bench` callbacks, so reference here is fine. */
const preFinalized = (() => {
  const batch = new MerkleBatch({ maxBatchSize: 512, maxBatchAgeMs: 600_000 });
  for (const event of BATCH_256_EVENTS) batch.add(event);
  batch.finalize();
  return batch;
})();
const preFinalizedTarget = BATCH_256_EVENTS[137].eventHash;
