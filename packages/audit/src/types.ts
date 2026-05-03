/**
 * Audit types are JSON-serializable with stable schemas.
 * In Phase 2+, the Elixir event-ingestion and audit-fanout modules
 * will consume these same shapes via the wallet control-plane API.
 */

export type AuditEventKind =
  | "request-received"
  | "policy-evaluated"
  | "approval-requested"
  | "approval-decided"
  | "signing-executed"
  | "response-sent"
  | "session-created"
  | "session-revoked"
  | "workspace-switched"
  | "account-created"
  | "account-imported"
  | "key-generated"
  | "lock-state-changed"
  | "wallet-initialized"
  | "export-requested"
  // Credential / passkey lifecycle
  | "credential-enrolled"
  | "credential-verified"
  | "credential-verification-failed"
  | "credential-revoked"
  // Multi-jurisdictional compliance state matrix (PR #147)
  | "compliance-conflict-resolved"
  // Custodian SLA + insurance liability attestation (PR #148)
  | "custodian-liability-snapshot";

export interface AuditEvent {
  id: string;
  sequenceNumber: number;
  timestamp: number;
  kind: AuditEventKind;
  subjectId: string;
  workspaceId: string;
  appId?: string;
  sessionId?: string;
  intentId?: string;
  detail: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
}

export interface EvidenceRecord {
  id: string;
  title: string;
  events: AuditEvent[];
  chainValid: boolean;
  createdAt: number;
  exportedAt?: number;
}

export interface ExportPackage {
  version: string;
  exportedAt: number;
  events: AuditEvent[];
  integrityHash: string;
  chainStartSequence: number;
  chainEndSequence: number;
}

export interface AuditQuery {
  kind?: AuditEventKind;
  subjectId?: string;
  workspaceId?: string;
  intentId?: string;
  fromSequence?: number;
  toSequence?: number;
  limit?: number;
  offset?: number;
}
