/**
 * Property-based tests for the audit hash-chain.
 * ──────────────────────────────────────────────
 * Properties verified:
 *
 *  1. Integrity — any sequence of events recorded through AuditCapture
 *     passes `verifyChain()`.
 *  2. Tamper sensitivity — mutating ANY event's detail after recording
 *     breaks verification.
 *  3. Sequence-number tamper — reordering a single pair of sequence
 *     numbers breaks verification.
 *  4. Hash tamper — flipping one bit of any event's eventHash breaks
 *     verification.
 *  5. Empty chain — the empty list verifies as true (vacuous truth),
 *     matching the implementation's early return.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { AuditCapture, type AuditEvent } from "@aethelred/wallet-audit";

const kindsArb = fc.constantFrom(
  "request-received",
  "policy-evaluated",
  "approval-requested",
  "approval-decided",
  "signing-executed",
  "response-sent",
);

const opsArb = fc.array(
  fc.record({
    kind: kindsArb,
    detail: fc.record({
      amount: fc.integer({ min: 0, max: 1_000_000 }),
      note: fc.string({ maxLength: 24 }),
    }),
  }),
  { minLength: 1, maxLength: 16 },
);

function recordAll(
  ops: ReadonlyArray<{ kind: string; detail: Record<string, unknown> }>,
): AuditEvent[] {
  const capture = new AuditCapture();
  const events: AuditEvent[] = [];
  for (const op of ops) {
    events.push(
      capture.record({
        kind: op.kind as AuditEvent["kind"],
        subjectId: "subj-1",
        workspaceId: "ws-1",
        detail: op.detail,
      }),
    );
  }
  return events;
}

describe("AuditCapture chain properties", () => {
  it("verifies a freshly recorded chain", () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        const events = recordAll(ops);
        expect(AuditCapture.verifyChain(events)).toBe(true);
      }),
    );
  });

  it("detail mutation breaks verification", () => {
    fc.assert(
      fc.property(opsArb, fc.integer({ min: 0 }), (ops, idxSeed) => {
        const events = recordAll(ops);
        const idx = idxSeed % events.length;
        const tampered = events.map((e, i) =>
          i === idx ? { ...e, detail: { ...e.detail, __injected: "mutated" } } : e,
        );
        expect(AuditCapture.verifyChain(tampered)).toBe(false);
      }),
    );
  });

  it("sequence-number swap breaks verification", () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        fc.pre(ops.length >= 2);
        const events = recordAll(ops);
        const swapped = [...events];
        swapped[0] = { ...events[0], sequenceNumber: events[1].sequenceNumber };
        swapped[1] = { ...events[1], sequenceNumber: events[0].sequenceNumber };
        expect(AuditCapture.verifyChain(swapped)).toBe(false);
      }),
    );
  });

  it("hash flip breaks verification", () => {
    fc.assert(
      fc.property(opsArb, fc.integer({ min: 0 }), (ops, idxSeed) => {
        const events = recordAll(ops);
        const idx = idxSeed % events.length;
        const tampered = events.map((e, i) => {
          if (i !== idx) return e;
          const flippedChar = e.eventHash[0] === "a" ? "b" : "a";
          return { ...e, eventHash: flippedChar + e.eventHash.slice(1) };
        });
        expect(AuditCapture.verifyChain(tampered)).toBe(false);
      }),
    );
  });

  it("empty chain verifies vacuously", () => {
    expect(AuditCapture.verifyChain([])).toBe(true);
  });
});
