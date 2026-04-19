import { AuditCapture } from "./event-capture";
import type { AuditEvent, EvidenceRecord } from "./types";

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `evd-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Assembles an EvidenceRecord from a chain of related audit events.
 * An evidence record groups all events related to a single intent
 * (request → policy → approval → sign → response) into one verifiable unit.
 */
export function buildEvidenceRecord(
  title: string,
  events: AuditEvent[]
): EvidenceRecord {
  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const chainValid = AuditCapture.verifyChain(sorted);

  return {
    id: generateId(),
    title,
    events: sorted,
    chainValid,
    createdAt: Date.now(),
  };
}

/**
 * Collects all events related to a specific intent ID from a list of events.
 */
export function collectIntentEvents(
  intentId: string,
  allEvents: AuditEvent[]
): AuditEvent[] {
  return allEvents.filter((e) => e.intentId === intentId);
}
