import { describe, expect, it } from "vitest";
import { AuditCapture, type AuditEvent } from "@aethelred/wallet-audit";
import { inspectAuditChainIntegrity } from "../background/audit-chain-integrity";

function makeEvents(): AuditEvent[] {
  const capture = new AuditCapture();
  const events: AuditEvent[] = [];
  capture.onEvent((event) => events.push(event));
  capture.record({
    kind: "wallet-initialized",
    subjectId: "subject-1",
    workspaceId: "workspace-1",
    detail: { source: "test" },
  });
  return events;
}

describe("inspectAuditChainIntegrity", () => {
  it("reports a complete valid chain as verified only after rehydration", () => {
    const events = makeEvents();
    expect(inspectAuditChainIntegrity(events, {
      state: "ready",
      sequence: 1,
      previousHash: events[0].eventHash,
    }, () => 1234)).toEqual({
      status: "verified",
      eventCount: 1,
      lastSequence: 1,
      checkedAt: 1234,
      message: expect.stringMatching(/complete stored audit chain passed/i),
    });
  });

  it("does not infer integrity while rehydration is pending", () => {
    const result = inspectAuditChainIntegrity(makeEvents(), { state: "pending" });
    expect(result.status).toBe("unavailable");
    expect(result.checkedAt).toBeNull();
  });

  it("surfaces lifecycle rehydration failure even with no events", () => {
    const result = inspectAuditChainIntegrity([], {
      state: "failed",
      error: "storage read failed",
    });
    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/rehydration failed.*storage read failed/i);
  });

  it("reports a tampered chain as failed", () => {
    const events = makeEvents();
    const tampered = [{ ...events[0], detail: { source: "tampered" } }];
    const result = inspectAuditChainIntegrity(tampered, {
      state: "ready",
      sequence: 1,
      previousHash: events[0].eventHash,
    });
    expect(result.status).toBe("failed");
    expect(result.message).toMatch(/failed sha-256/i);
  });
});
