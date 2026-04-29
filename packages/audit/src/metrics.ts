/**
 * `AuditMetricsRecorder` — pluggable telemetry interface for the
 * audit chain's integrity checks (PR #107).
 *
 * The audit chain is the wallet's tamper-evidence property: every
 * event references the previous event's hash, forming a linked
 * chain. `AuditCapture.verifyChain` walks the chain checking two
 * properties at each step:
 *
 *   1. **Hash integrity** — `event.eventHash` equals SHA-256 of
 *      its other fields (sequence, timestamp, kind, detail,
 *      previousHash).
 *   2. **Link integrity** — `event[n].previousHash` equals
 *      `event[n-1].eventHash`.
 *
 * When either check fails, the recorder is invoked with details
 * about the offending event. Consumers wire this to their meter
 * (`@aethelred/wallet-observability`, OpenTelemetry SDK, prom-
 * client) to surface the corresponding runbook alert:
 *
 *   - `recordChainIntegrityBroken` ↔ `audit.chain_integrity_broken`
 *     metric (P1 — tamper signal; the stored hash was modified
 *     after capture, OR a serialization bug corrupted it).
 *   - `recordChainLinkMismatch` ↔ `audit.chain_link_mismatch`
 *     metric (P2/P1 — gap signal; an event was lost between
 *     capture and persist, OR deleted out-of-band, OR FIFO
 *     eviction happened without inserting the synthetic marker).
 *
 * See [`docs/runbooks/audit-trail-gap.md`](../../../docs/runbooks/audit-trail-gap.md)
 * (PR #103) for the operational playbook these metrics drive.
 *
 * **Interface design rationale.** The audit package keeps a
 * narrow dependency surface (no hard dep on
 * `@aethelred/wallet-observability`). Defining a tiny 2-method
 * interface here lets operators bridge to their meter
 * implementation without coupling the audit package to any of
 * them. Same pattern as PR #102's
 * `AllowanceCacheMetricsRecorder` and PR #99's `AllowanceCache`.
 *
 * @example Wiring to `@aethelred/wallet-observability`
 *
 * ```ts
 * import { InMemoryMeter } from "@aethelred/wallet-observability";
 * import {
 *   buildEvidenceRecord,
 *   type AuditMetricsRecorder,
 * } from "@aethelred/wallet-audit";
 *
 * const meter = new InMemoryMeter();
 * const tamper = meter.counter(
 *   "audit_chain_integrity_broken_total",
 *   "Audit events whose stored hash didn't match recompute (tamper)",
 * );
 * const gaps = meter.counter(
 *   "audit_chain_link_mismatch_total",
 *   "Audit events whose previousHash didn't match neighbor's eventHash (gap)",
 * );
 *
 * const recorder: AuditMetricsRecorder = {
 *   recordChainIntegrityBroken: ({ subjectId, workspaceId }) =>
 *     tamper.add(1, { subject_id: subjectId, workspace_id: workspaceId }),
 *   recordChainLinkMismatch: ({ subjectId, workspaceId }) =>
 *     gaps.add(1, { subject_id: subjectId, workspace_id: workspaceId }),
 * };
 *
 * const evidence = buildEvidenceRecord("intent-evidence", events, recorder);
 * ```
 */

/**
 * Details about a chain-integrity failure. Passed to the
 * recorder so consumers can label metrics by chain scope and
 * trace the offending event in audit storage if needed.
 */
export interface AuditChainBreakDetails {
  /** ID of the event whose check failed. */
  readonly failedEventId: string;
  /** Sequence number of the failed event. */
  readonly sequenceNumber: number;
  /** Workspace scope of the chain (always present per the AuditEvent contract). */
  readonly workspaceId: string;
  /** Subject scope of the chain (always present per the AuditEvent contract). */
  readonly subjectId: string;
}

/**
 * Details about an audit-storage failure (PR #108). Passed to
 * the recorder so consumers can label metrics by which of the
 * three storage call sites failed and (where available) which
 * event was being persisted.
 */
export interface AuditStorageFailureDetails {
  /**
   * Which storage operation failed. Each maps to a different
   * call site in `AuditStore`:
   *
   *   - `"initialize"` — `AuditStore.initialize()` couldn't read
   *     the persisted event list / metadata. Both encrypted and
   *     plain reads attempted (in that order); this fires only
   *     when BOTH paths fail.
   *   - `"persist"` — `AuditStore.persist()` couldn't write the
   *     event list / metadata after a new `append`. The event
   *     is in memory but not durable; on process crash, the
   *     event would be lost (Hypothesis A in the runbook).
   *   - `"rotateKey"` — `AuditStore.rotateKey()` couldn't write
   *     the existing event list under the new master key. The
   *     old encrypted store is preserved; rotation is reverted.
   */
  readonly operation: "initialize" | "persist" | "rotateKey";

  /**
   * When `operation === "persist"`, the sequence number of the
   * event that failed to persist. Operators correlate to
   * application logs by `subject_id × sequenceNumber`.
   *
   * Undefined for `"initialize"` / `"rotateKey"` (those don't
   * single out an event).
   */
  readonly sequenceNumber?: number;
}

export interface AuditMetricsRecorder {
  /**
   * `event.eventHash` did not match the SHA-256 recomputed from
   * the event's other fields. Indicates either:
   *   - The event was modified after capture (tamper)
   *   - A serialization bug corrupted the stored hash
   *
   * Per the runbook (`docs/runbooks/audit-trail-gap.md` §5),
   * a single occurrence is **always P1** — the stronger signal
   * vs the gap-only `recordChainLinkMismatch`.
   */
  recordChainIntegrityBroken(details: AuditChainBreakDetails): void;

  /**
   * `event[n].previousHash` did not match `event[n-1].eventHash`.
   * Indicates one of:
   *   - An event was lost between capture and persist
   *   - An event was deleted out-of-band from storage
   *   - FIFO eviction occurred without inserting the synthetic
   *     marker that preserves chain continuity
   *   - Two `AuditCapture` instances raced and produced
   *     conflicting sequence numbers
   *
   * P2 default; escalates to P1 on systemic recurrence (≥ 5 in
   * 5 min) or within an active SOC-2/GDPR evidence window.
   */
  recordChainLinkMismatch(details: AuditChainBreakDetails): void;

  /**
   * `AuditStore.persist()` or `AuditStore.rotateKey()` couldn't
   * complete a `set()` against the underlying storage adapter
   * (PR #108). The event/state is in-memory but not durable.
   *
   * Maps to `audit.storage_write_failed` in
   * `OBSERVABILITY_SCOPE.md`. Sustained recurrence is the
   * leading indicator of Hypothesis A in the audit-trail-gap
   * runbook (silent storage write loss → eventual chain gap).
   */
  recordStorageWriteFailed(details: AuditStorageFailureDetails): void;

  /**
   * `AuditStore.initialize()` couldn't read the persisted event
   * list / metadata from any configured storage path
   * (encrypted-then-plain fallback chain exhausted).
   *
   * Maps to `audit.storage_read_failed`. Single occurrence is
   * P2; sustained recurrence (multiple processes failing to
   * read on startup) implies a wider storage-backend issue and
   * escalates to P1.
   */
  recordStorageReadFailed(details: AuditStorageFailureDetails): void;
}

/**
 * Default `AuditMetricsRecorder` — a no-op. `verifyChain`,
 * `buildEvidenceRecord`, and `AuditStore` use this when no
 * recorder is supplied, eliminating `if (recorder)` branches
 * at every call site.
 */
export const NOOP_AUDIT_METRICS_RECORDER: AuditMetricsRecorder = Object.freeze({
  recordChainIntegrityBroken() {},
  recordChainLinkMismatch() {},
  recordStorageWriteFailed() {},
  recordStorageReadFailed() {},
});
