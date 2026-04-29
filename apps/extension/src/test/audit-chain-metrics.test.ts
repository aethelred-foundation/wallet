/**
 * Tests for the audit chain integrity metrics recorder (PR #107).
 *
 * Two layers:
 *
 *   1. **`AuditCapture.verifyChain` direct invocation** — verify
 *      the recorder is called with the correct details on each
 *      failure mode (hash mismatch / link mismatch / both
 *      simultaneously / valid chain), and that the noop default
 *      preserves backward compat.
 *
 *   2. **`buildEvidenceRecord` integration** — verify the recorder
 *      threads through correctly when set, and the
 *      `chainValid: false` flag still surfaces in the evidence
 *      record (the metric supplements but doesn't replace the
 *      flag).
 *
 * Codifies PR #103's runbook split: `chain_integrity_broken`
 * (tamper, P1) is distinct from `chain_link_mismatch` (gap,
 * P2/P1) — distinct events, distinct counters, distinct fixes.
 */

import { describe, expect, it } from "vitest";

import {
  AuditCapture,
  buildEvidenceRecord,
  NOOP_AUDIT_METRICS_RECORDER,
  type AuditChainBreakDetails,
  type AuditEvent,
  type AuditMetricsRecorder,
} from "@aethelred/wallet-audit";

// ─── Test fixtures ─────────────────────────────────────────

interface RecorderHistory {
  readonly recorder: AuditMetricsRecorder;
  readonly integrityBroken: ReadonlyArray<AuditChainBreakDetails>;
  readonly linkMismatch: ReadonlyArray<AuditChainBreakDetails>;
}

function makeRecorder(): RecorderHistory {
  const integrityBroken: AuditChainBreakDetails[] = [];
  const linkMismatch: AuditChainBreakDetails[] = [];
  const recorder: AuditMetricsRecorder = {
    recordChainIntegrityBroken(d) {
      integrityBroken.push(d);
    },
    recordChainLinkMismatch(d) {
      linkMismatch.push(d);
    },
  };
  return { recorder, integrityBroken, linkMismatch };
}

/**
 * Build a clean 3-event audit chain. The capture records events
 * in sequence, with proper hash linkage. Tests then introduce
 * targeted corruption to exercise the failure paths.
 */
function makeCleanChain(): AuditEvent[] {
  const cap = new AuditCapture();
  const events: AuditEvent[] = [];
  for (let i = 0; i < 3; i++) {
    events.push(
      cap.record({
        kind: "request-received",
        subjectId: "subj-test",
        workspaceId: "ws-test",
        detail: { step: i },
      }),
    );
  }
  return events;
}

// ─── Layer 1: AuditCapture.verifyChain ─────────────────────

describe("AuditCapture.verifyChain — metrics recorder (PR #107)", () => {
  it("valid chain: returns true; recorder NOT called", () => {
    const events = makeCleanChain();
    const { recorder, integrityBroken, linkMismatch } = makeRecorder();

    const valid = AuditCapture.verifyChain(events, recorder);
    expect(valid).toBe(true);
    expect(integrityBroken).toHaveLength(0);
    expect(linkMismatch).toHaveLength(0);
  });

  it("hash mismatch (tamper) → recordChainIntegrityBroken with offending event details", () => {
    const events = makeCleanChain();
    // Tamper with event[1]'s detail without recomputing the hash.
    const tampered: AuditEvent[] = events.map((e, i) =>
      i === 1 ? { ...e, detail: { step: 999 } } : e,
    );
    const { recorder, integrityBroken, linkMismatch } = makeRecorder();

    const valid = AuditCapture.verifyChain(tampered, recorder);
    expect(valid).toBe(false);
    expect(integrityBroken).toHaveLength(1);
    expect(linkMismatch).toHaveLength(0);
    expect(integrityBroken[0]).toEqual({
      failedEventId: events[1].id,
      sequenceNumber: events[1].sequenceNumber,
      workspaceId: "ws-test",
      subjectId: "subj-test",
    });
  });

  it("link mismatch (gap) → recordChainLinkMismatch with offending event details", () => {
    const events = makeCleanChain();
    // Drop event[1] — leaves events[0] and events[2]. event[2]'s
    // previousHash points to event[1]'s eventHash, which no longer
    // exists in the chain. Link check fires for event[2].
    const gapped = [events[0], events[2]];
    const { recorder, integrityBroken, linkMismatch } = makeRecorder();

    const valid = AuditCapture.verifyChain(gapped, recorder);
    expect(valid).toBe(false);
    expect(integrityBroken).toHaveLength(0);
    expect(linkMismatch).toHaveLength(1);
    expect(linkMismatch[0]).toEqual({
      failedEventId: events[2].id,
      sequenceNumber: events[2].sequenceNumber,
      workspaceId: "ws-test",
      subjectId: "subj-test",
    });
  });

  it("first-event-only chain: hash check still runs (single-event integrity)", () => {
    const events = makeCleanChain();
    const tampered: AuditEvent[] = [{ ...events[0], detail: { step: 999 } }];
    const { recorder, integrityBroken, linkMismatch } = makeRecorder();

    const valid = AuditCapture.verifyChain(tampered, recorder);
    expect(valid).toBe(false);
    expect(integrityBroken).toHaveLength(1);
    expect(linkMismatch).toHaveLength(0);
  });

  it("hash mismatch is reported BEFORE link mismatch when both apply on same event", () => {
    const events = makeCleanChain();
    // Tamper with event[1]'s detail. This makes:
    //   - event[1].eventHash != recompute(event[1])  (integrity)
    //   - event[2].previousHash still equals event[1].eventHash  (link OK at boundary 1→2)
    // The first failure encountered is the integrity break on event[1].
    const tampered: AuditEvent[] = events.map((e, i) =>
      i === 1 ? { ...e, detail: { step: 999 } } : e,
    );
    const { recorder, integrityBroken, linkMismatch } = makeRecorder();

    AuditCapture.verifyChain(tampered, recorder);
    expect(integrityBroken).toHaveLength(1);
    expect(linkMismatch).toHaveLength(0);
    // Confirm: the integrity break fired for event[1], NOT event[2].
    expect(integrityBroken[0].sequenceNumber).toBe(2); // event[1] is sequence 2
  });

  it("loop short-circuits on first failure (only ONE recorder call total)", () => {
    const events = makeCleanChain();
    // Tamper with TWO events. The loop should report only the first.
    const tampered: AuditEvent[] = events.map((e, i) =>
      i === 0 || i === 2 ? { ...e, detail: { step: 999 } } : e,
    );
    const { recorder, integrityBroken } = makeRecorder();

    AuditCapture.verifyChain(tampered, recorder);
    expect(integrityBroken).toHaveLength(1);
    // The first one (sequence 1) is reported.
    expect(integrityBroken[0].sequenceNumber).toBe(1);
  });

  it("default (no recorder) preserves pre-PR-#107 behavior — no observable side effects", () => {
    const events = makeCleanChain();
    const tampered: AuditEvent[] = events.map((e, i) =>
      i === 1 ? { ...e, detail: { step: 999 } } : e,
    );
    // Calling without a recorder must not throw and must return false.
    expect(() => AuditCapture.verifyChain(tampered)).not.toThrow();
    expect(AuditCapture.verifyChain(tampered)).toBe(false);
  });

  it("explicit NOOP_AUDIT_METRICS_RECORDER is callable as a no-op", () => {
    expect(() => {
      NOOP_AUDIT_METRICS_RECORDER.recordChainIntegrityBroken({
        failedEventId: "x",
        sequenceNumber: 1,
        workspaceId: "ws",
        subjectId: "subj",
      });
      NOOP_AUDIT_METRICS_RECORDER.recordChainLinkMismatch({
        failedEventId: "y",
        sequenceNumber: 2,
        workspaceId: "ws",
        subjectId: "subj",
      });
    }).not.toThrow();
  });

  it("empty chain: returns true; recorder NOT called", () => {
    const { recorder, integrityBroken, linkMismatch } = makeRecorder();
    const valid = AuditCapture.verifyChain([], recorder);
    expect(valid).toBe(true);
    expect(integrityBroken).toHaveLength(0);
    expect(linkMismatch).toHaveLength(0);
  });

  it("recorder receives correct workspaceId + subjectId from offending event", () => {
    // Build a chain where the offending event has DIFFERENT
    // workspace/subject than its neighbors — confirms the
    // recorder labels by the FAILED event's scope, not by some
    // chain-wide property.
    const cap = new AuditCapture();
    const ev1 = cap.record({
      kind: "request-received",
      subjectId: "subj-a",
      workspaceId: "ws-a",
      detail: {},
    });
    const ev2 = cap.record({
      kind: "request-received",
      subjectId: "subj-b", // different scope
      workspaceId: "ws-b",
      detail: {},
    });
    // Tamper event[1] (the subj-b event).
    const tampered = [ev1, { ...ev2, detail: { tampered: true } }];
    const { recorder, integrityBroken } = makeRecorder();
    AuditCapture.verifyChain(tampered, recorder);
    expect(integrityBroken[0]).toMatchObject({
      workspaceId: "ws-b",
      subjectId: "subj-b",
    });
  });
});

// ─── Layer 2: buildEvidenceRecord integration ──────────────

describe("buildEvidenceRecord — metrics recorder (PR #107)", () => {
  it("valid chain: chainValid=true, recorder NOT called", () => {
    const events = makeCleanChain();
    const { recorder, integrityBroken, linkMismatch } = makeRecorder();

    const evidence = buildEvidenceRecord("test", events, recorder);
    expect(evidence.chainValid).toBe(true);
    expect(integrityBroken).toHaveLength(0);
    expect(linkMismatch).toHaveLength(0);
  });

  it("tamper detected: chainValid=false AND recorder.recordChainIntegrityBroken fires", () => {
    const events = makeCleanChain();
    const tampered: AuditEvent[] = events.map((e, i) =>
      i === 1 ? { ...e, detail: { step: 999 } } : e,
    );
    const { recorder, integrityBroken, linkMismatch } = makeRecorder();

    const evidence = buildEvidenceRecord("test", tampered, recorder);
    expect(evidence.chainValid).toBe(false);
    expect(integrityBroken).toHaveLength(1);
    expect(linkMismatch).toHaveLength(0);
    // The metric is the OPS notification; the chainValid flag is
    // the consumer-facing surface. Both fire — consumers can
    // branch on either.
  });

  it("gap detected: chainValid=false AND recorder.recordChainLinkMismatch fires", () => {
    const events = makeCleanChain();
    const gapped = [events[0], events[2]]; // drop middle
    const { recorder, integrityBroken, linkMismatch } = makeRecorder();

    const evidence = buildEvidenceRecord("test", gapped, recorder);
    expect(evidence.chainValid).toBe(false);
    expect(integrityBroken).toHaveLength(0);
    expect(linkMismatch).toHaveLength(1);
  });

  it("recorder undefined: chainValid still surfaces correctly (backward compat)", () => {
    const events = makeCleanChain();
    const tampered: AuditEvent[] = events.map((e, i) =>
      i === 1 ? { ...e, detail: { step: 999 } } : e,
    );
    // No third arg — pre-PR-#107 call shape.
    const evidence = buildEvidenceRecord("test", tampered);
    expect(evidence.chainValid).toBe(false);
    // No throws, no observable side effects.
  });
});