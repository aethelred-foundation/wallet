import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  type AuditMetricsRecorder,
  NOOP_AUDIT_METRICS_RECORDER,
} from "./metrics";
import type { AuditEvent, AuditEventKind } from "./types";

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `evt-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * AuditCapture creates tamper-evident audit events with hash chaining.
 * Each event's hash includes the previous event's hash, creating a
 * verifiable chain of evidence.
 *
 * Hash = SHA-256(sequenceNumber + timestamp + kind + detail + previousHash)
 */
export class AuditCapture {
  private sequenceNumber = 0;
  private previousHash = GENESIS_HASH;
  private readonly listeners: Array<(event: AuditEvent) => void> = [];

  record(opts: {
    kind: AuditEventKind;
    subjectId: string;
    workspaceId: string;
    appId?: string;
    sessionId?: string;
    intentId?: string;
    detail: Record<string, unknown>;
  }): AuditEvent {
    this.sequenceNumber += 1;
    const timestamp = Date.now();
    const id = generateId();

    const hashInput = [
      this.sequenceNumber.toString(),
      timestamp.toString(),
      opts.kind,
      JSON.stringify(opts.detail),
      this.previousHash,
    ].join("|");

    const eventHash = bytesToHex(sha256(new TextEncoder().encode(hashInput)));

    const event: AuditEvent = {
      id,
      sequenceNumber: this.sequenceNumber,
      timestamp,
      kind: opts.kind,
      subjectId: opts.subjectId,
      workspaceId: opts.workspaceId,
      appId: opts.appId,
      sessionId: opts.sessionId,
      intentId: opts.intentId,
      detail: opts.detail,
      previousHash: this.previousHash,
      eventHash,
    };

    this.previousHash = eventHash;

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Audit listeners must not break the capture pipeline
      }
    }

    return event;
  }

  onEvent(listener: (event: AuditEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  getSequenceNumber(): number {
    return this.sequenceNumber;
  }

  getPreviousHash(): string {
    return this.previousHash;
  }

  restoreState(sequenceNumber: number, previousHash: string): void {
    this.sequenceNumber = sequenceNumber;
    this.previousHash = previousHash;
  }

  /**
   * Verify a chain of audit events. Returns `true` when both
   * integrity properties hold across the entire range:
   *
   *   1. Each event's `eventHash` matches SHA-256 of its other
   *      fields (sequence, timestamp, kind, detail, previousHash).
   *   2. Each event's `previousHash` matches the prior event's
   *      `eventHash` (only checked for `i > 0`; the first event
   *      may chain off the genesis hash or off any prior chain
   *      tail not present in this slice).
   *
   * **Metrics integration (PR #107).** When `metrics` is supplied
   * AND a check fails, the recorder is invoked with details about
   * the offending event before this method returns `false`:
   *
   *   - Hash mismatch → `recordChainIntegrityBroken` (tamper signal)
   *   - Link mismatch → `recordChainLinkMismatch` (gap signal)
   *
   * Only the FIRST detected failure is reported (the loop
   * short-circuits). For full-chain auditing across multiple
   * gaps, callers iterate `verifyChain` over progressively
   * larger windows or partition the chain by sequence ranges.
   *
   * Backward compat: omitting `metrics` (or passing the
   * `NOOP_AUDIT_METRICS_RECORDER`) preserves pre-PR-#107 behavior
   * exactly — no observable side effects.
   */
  static verifyChain(
    events: AuditEvent[],
    metrics: AuditMetricsRecorder = NOOP_AUDIT_METRICS_RECORDER,
  ): boolean {
    if (events.length === 0) return true;

    const sorted = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    for (let i = 0; i < sorted.length; i++) {
      const event = sorted[i];
      const hashInput = [
        event.sequenceNumber.toString(),
        event.timestamp.toString(),
        event.kind,
        JSON.stringify(event.detail),
        event.previousHash,
      ].join("|");

      const expectedHash = bytesToHex(sha256(new TextEncoder().encode(hashInput)));
      if (event.eventHash !== expectedHash) {
        metrics.recordChainIntegrityBroken({
          failedEventId: event.id,
          sequenceNumber: event.sequenceNumber,
          workspaceId: event.workspaceId,
          subjectId: event.subjectId,
        });
        return false;
      }

      if (i > 0 && event.previousHash !== sorted[i - 1].eventHash) {
        metrics.recordChainLinkMismatch({
          failedEventId: event.id,
          sequenceNumber: event.sequenceNumber,
          workspaceId: event.workspaceId,
          subjectId: event.subjectId,
        });
        return false;
      }
    }

    return true;
  }
}
