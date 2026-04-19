import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
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

  static verifyChain(events: AuditEvent[]): boolean {
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
      if (event.eventHash !== expectedHash) return false;

      if (i > 0 && event.previousHash !== sorted[i - 1].eventHash) return false;
    }

    return true;
  }
}
