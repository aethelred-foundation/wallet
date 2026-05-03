/**
 * Audit-chain wiring for the dynamic compliance state matrix.
 *
 * The {@link JurisdictionalConflictResolver} produces a
 * {@link MatrixResolution} carrying a SHA-256 digest of the resolution
 * payload. That digest is meaningful only if it lands in the
 * tamper-evident audit chain — otherwise an attacker who suppressed
 * events could later claim "we never resolved that conflict."
 *
 * This module is the bridge: it takes a {@link MatrixResolution}
 * + an audit-event subject context and records a structured
 * `compliance-conflict-resolved` event via {@link AuditCapture}.
 *
 * Why a separate module:
 *   - The `wallet-audit` package owns the chain + verification logic
 *     and deliberately stays unaware of compliance domain types
 *     (no circular import).
 *   - The `wallet-compliance` package already depends on `wallet-audit`,
 *     so the bridge naturally lives here.
 *   - Consumers who don't want audit-chain integration can ignore
 *     this module entirely; the resolver still produces the digest
 *     for their own logging pipeline.
 */

import type { AuditCapture, AuditEvent } from "@aethelred/wallet-audit";

import type { MatrixResolution } from "./jurisdictional-conflict-resolver";

/**
 * Subject / scope context required by every audit event.
 *
 * - `subjectId`: the user / agent / treasurer the transaction belongs to
 * - `workspaceId`: tenant scope
 * - `appId` / `sessionId` / `intentId`: optional event-stream linkage
 */
export interface AuditSubjectContext {
  readonly subjectId: string;
  readonly workspaceId: string;
  readonly appId?: string;
  readonly sessionId?: string;
  readonly intentId?: string;
}

/**
 * Record a {@link MatrixResolution} as a `compliance-conflict-resolved`
 * audit event.
 *
 * The event's `detail` payload preserves enough information for an
 * auditor to verify the resolution post-hoc:
 *   - the original transaction id
 *   - the jurisdictions considered (sorted, canonical)
 *   - every conflict found
 *   - the resolution chosen for each conflict (winning jurisdiction,
 *     winning rule, hierarchy applied, rationale)
 *   - the SHA-256 digest of the resolution itself (separate from the
 *     audit-chain hash chain — auditors verify both independently)
 *   - the resolution timestamp
 *
 * Returns the recorded {@link AuditEvent} so callers can correlate
 * with downstream evidence builders.
 */
export function recordMatrixResolution(
  capture: AuditCapture,
  resolution: MatrixResolution,
  context: AuditSubjectContext,
): AuditEvent {
  return capture.record({
    kind: "compliance-conflict-resolved",
    subjectId: context.subjectId,
    workspaceId: context.workspaceId,
    appId: context.appId,
    sessionId: context.sessionId,
    intentId: context.intentId ?? resolution.transactionId,
    detail: {
      transactionId: resolution.transactionId,
      jurisdictions: resolution.jurisdictions,
      conflictsFound: resolution.conflictsFound,
      resolutions: resolution.resolutions,
      resolvedAt: resolution.resolvedAt,
      resolutionDigest: resolution.digest,
      // Counts surface cleanly in dashboards without parsing the
      // arrays — operators chart "% of transactions with N>0 conflicts"
      // directly.
      conflictCount: resolution.conflictsFound.length,
    },
  });
}
