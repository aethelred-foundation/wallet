import { AuditCapture, type AuditEvent } from "@aethelred/wallet-audit";

export type AuditChainRehydrationState =
  | { state: "pending" }
  | { state: "ready"; sequence: number; previousHash: string }
  | { state: "failed"; error: string };

export interface AuditChainIntegrityResult {
  status: "verified" | "failed" | "empty" | "unavailable";
  eventCount: number;
  lastSequence: number | null;
  checkedAt: number | null;
  message: string;
}

/**
 * Inspect the complete in-memory store only after lifecycle rehydration has
 * completed. A non-empty event list is never evidence of integrity by itself.
 */
export function inspectAuditChainIntegrity(
  events: AuditEvent[],
  rehydration: AuditChainRehydrationState,
  now: () => number = Date.now,
): AuditChainIntegrityResult {
  const lastSequence = events.length > 0
    ? Math.max(...events.map((event) => event.sequenceNumber))
    : null;

  if (rehydration.state === "failed") {
    return {
      status: "failed",
      eventCount: events.length,
      lastSequence,
      checkedAt: null,
      message: `Audit-chain rehydration failed: ${rehydration.error}`,
    };
  }

  if (rehydration.state !== "ready") {
    return {
      status: "unavailable",
      eventCount: events.length,
      lastSequence,
      checkedAt: null,
      message: "Audit-chain rehydration status is unavailable.",
    };
  }

  if (events.length === 0) {
    return {
      status: "empty",
      eventCount: 0,
      lastSequence: null,
      checkedAt: now(),
      message: "No audit records are available to verify.",
    };
  }

  const checkedAt = now();
  if (!AuditCapture.verifyChain(events)) {
    return {
      status: "failed",
      eventCount: events.length,
      lastSequence,
      checkedAt,
      message: "The stored audit chain failed SHA-256 hash or link verification.",
    };
  }

  return {
    status: "verified",
    eventCount: events.length,
    lastSequence,
    checkedAt,
    message: "The complete stored audit chain passed SHA-256 hash and link verification.",
  };
}
