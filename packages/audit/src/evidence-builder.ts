import { AuditCapture } from "./event-capture";
import type { AuditMetricsRecorder } from "./metrics";
import type { AuditEvent, EvidenceRecord } from "./types";

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `evd-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Assembles an EvidenceRecord from a chain of related audit events.
 * An evidence record groups all events related to a single intent
 * (request → policy → approval → sign → response) into one verifiable unit.
 *
 * **Metrics integration (PR #107).** When `metrics` is supplied
 * AND the chain validation fails, the recorder receives a
 * `recordChainIntegrityBroken` or `recordChainLinkMismatch`
 * event before this function returns. The returned record's
 * `chainValid: false` flag is downstream-consumed by export
 * packages and regulator submissions; the metric is the
 * monitoring complement that surfaces the failure to ops.
 *
 * Backward compat: omitting `metrics` preserves pre-PR-#107
 * behavior exactly — no observable side effects.
 */
export function buildEvidenceRecord(
  title: string,
  events: AuditEvent[],
  metrics?: AuditMetricsRecorder,
): EvidenceRecord {
  const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const chainValid = AuditCapture.verifyChain(sorted, metrics);

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
