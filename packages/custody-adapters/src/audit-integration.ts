/**
 * Audit-chain wiring for custodian liability snapshots.
 *
 * {@link captureLiabilitySnapshot} produces a {@link LiabilitySnapshotEvent}
 * with a SHA-256 digest binding the snapshot to its transaction. That
 * digest is meaningful only if the event lands in the tamper-evident
 * audit chain — otherwise an attacker who suppressed events could
 * later claim "we never captured the custodian's SLA state."
 *
 * This module is the bridge: it takes a {@link LiabilitySnapshotEvent}
 * + an audit-event subject context and records a structured
 * `custodian-liability-snapshot` event via {@link AuditCapture}.
 *
 * Why a separate module:
 *   - The `wallet-audit` package owns chain + verification logic and
 *     deliberately stays unaware of custody-domain types (no circular
 *     import).
 *   - Consumers who don't want audit-chain integration ignore this
 *     module entirely; the snapshot still produces its bound digest
 *     for their own logging pipeline.
 *
 * Critical invariant: `liabilityUnknown: true` events MUST still be
 * recorded. If the oracle is down, the audit chain still gets a
 * record proving the wallet TRIED to attest at this exact millisecond
 * — the alternative (dropping unknown events) would let attackers
 * suppress oracle-outage gaps from the audit trail.
 */

import type { AuditCapture, AuditEvent } from "@aethelred/wallet-audit";

import type { LiabilitySnapshotEvent } from "./liability-attestation";

/**
 * Subject / scope context required by every audit event.
 *
 * Mirrors the same shape the compliance package uses — every audit
 * event needs a subject + workspace + optional event-stream linkage.
 */
export interface AuditSubjectContext {
  readonly subjectId: string;
  readonly workspaceId: string;
  readonly appId?: string;
  readonly sessionId?: string;
  readonly intentId?: string;
}

/**
 * Record a {@link LiabilitySnapshotEvent} as a
 * `custodian-liability-snapshot` audit event.
 *
 * The event's `detail` payload preserves enough information for an
 * auditor to verify the snapshot post-hoc:
 *   - the transaction id this snapshot is bound to
 *   - the custodian id
 *   - the attestation snapshot (full custodian state) OR null
 *   - the `liabilityUnknown` flag — surfaces oracle-outage gaps
 *   - the `capturedAt` timestamp
 *   - the bound-to-transaction digest (separate from the audit-chain
 *     hash chain — auditors verify both independently)
 *
 * bigint values inside the snapshot (`insuranceCoverage`) are
 * preserved as bigints in the detail payload. The audit chain's hash
 * input uses `JSON.stringify`, which by default throws on bigint —
 * we serialize bigint to string here so the audit chain can hash the
 * payload without modification.
 *
 * Returns the recorded {@link AuditEvent} so callers can correlate
 * with downstream evidence builders.
 */
export function recordLiabilitySnapshot(
  capture: AuditCapture,
  snapshot: LiabilitySnapshotEvent,
  context: AuditSubjectContext,
): AuditEvent {
  return capture.record({
    kind: "custodian-liability-snapshot",
    subjectId: context.subjectId,
    workspaceId: context.workspaceId,
    appId: context.appId,
    sessionId: context.sessionId,
    intentId: context.intentId ?? snapshot.transactionId,
    detail: {
      transactionId: snapshot.transactionId,
      custodianId: snapshot.custodianId,
      // Coerce bigints in the attestation to strings so the audit
      // chain's `JSON.stringify(detail)` works. Auditors recover the
      // original bigint by parsing the string field. The choice of
      // suffixing with "n" matches the convention used inside the
      // liability-attestation module's own canonical-JSON serializer.
      attestation: snapshot.attestation
        ? attestationForAudit(snapshot.attestation)
        : null,
      liabilityUnknown: snapshot.liabilityUnknown,
      capturedAt: snapshot.capturedAt,
      // The bound-to-transaction digest is included verbatim — auditors
      // re-derive it from the original snapshot to verify correlation.
      snapshotDigest: snapshot.digest,
    },
  });
}

/**
 * Coerce bigint fields to lossless string representations for
 * `JSON.stringify` compatibility. The `n` suffix mirrors the
 * canonical-JSON serializer inside `liability-attestation.ts` so the
 * audit-chain detail is byte-identical to the digest input modulo
 * field ordering.
 */
function attestationForAudit(att: NonNullable<LiabilitySnapshotEvent["attestation"]>): {
  readonly custodianId: string;
  readonly slaStatus: string;
  readonly insuranceCoverage: string;
  readonly insuranceCurrency: string;
  readonly attestedAt: number;
  readonly oracleId: string;
  readonly signature?: string;
} {
  return {
    custodianId: att.custodianId,
    slaStatus: att.slaStatus,
    insuranceCoverage: `${att.insuranceCoverage}n`,
    insuranceCurrency: att.insuranceCurrency,
    attestedAt: att.attestedAt,
    oracleId: att.oracleId,
    ...(att.signature !== undefined ? { signature: att.signature } : {}),
  };
}
