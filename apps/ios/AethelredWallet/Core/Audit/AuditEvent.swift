import Foundation

/// Audit-event kinds — shape-for-shape mirror of
/// `packages/audit/src/types.ts::AuditEventKind`.
///
/// The string values must match the TypeScript definitions exactly so
/// events produced by the iOS app can be replayed through the Elixir
/// event-ingestion pipeline without translation.
public enum AuditEventKind: String, Codable, Sendable, Equatable, CaseIterable {
    case requestReceived = "request-received"
    case policyEvaluated = "policy-evaluated"
    case approvalRequested = "approval-requested"
    case approvalDecided = "approval-decided"
    case signingExecuted = "signing-executed"
    case responseSent = "response-sent"
    case sessionCreated = "session-created"
    case sessionRevoked = "session-revoked"
    case workspaceSwitched = "workspace-switched"
    case accountCreated = "account-created"
    case accountImported = "account-imported"
    case keyGenerated = "key-generated"
    case lockStateChanged = "lock-state-changed"
    case walletInitialized = "wallet-initialized"
    case exportRequested = "export-requested"
    case credentialEnrolled = "credential-enrolled"
    case credentialVerified = "credential-verified"
    case credentialVerificationFailed = "credential-verification-failed"
    case credentialRevoked = "credential-revoked"
}

/// Mirror of `AuditEvent` in the TypeScript audit package. Fields use
/// the same names and ordering so JSON encoding is identical — tests in
/// `AuditCaptureTests.swift` assert round-trip compatibility against the
/// TS canonical envelope.
public struct AuditEvent: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let sequenceNumber: Int
    public let timestamp: Int64
    public let kind: AuditEventKind
    public let subjectId: String
    public let workspaceId: String
    public let appId: String?
    public let sessionId: String?
    public let intentId: String?
    public let detail: [String: String]
    public let previousHash: String
    public let eventHash: String

    public init(
        id: String,
        sequenceNumber: Int,
        timestamp: Int64,
        kind: AuditEventKind,
        subjectId: String,
        workspaceId: String,
        appId: String? = nil,
        sessionId: String? = nil,
        intentId: String? = nil,
        detail: [String: String] = [:],
        previousHash: String,
        eventHash: String
    ) {
        self.id = id
        self.sequenceNumber = sequenceNumber
        self.timestamp = timestamp
        self.kind = kind
        self.subjectId = subjectId
        self.workspaceId = workspaceId
        self.appId = appId
        self.sessionId = sessionId
        self.intentId = intentId
        self.detail = detail
        self.previousHash = previousHash
        self.eventHash = eventHash
    }
}

/// Evidence record — bundle of audit events exported for compliance.
public struct EvidenceRecord: Codable, Sendable, Equatable {
    public let id: String
    public let title: String
    public let events: [AuditEvent]
    public let chainValid: Bool
    public let createdAt: Int64
    public let exportedAt: Int64?
}

/// Export payload shape expected by the control plane.
public struct ExportPackage: Codable, Sendable, Equatable {
    public let version: String
    public let exportedAt: Int64
    public let events: [AuditEvent]
    public let integrityHash: String
    public let chainStartSequence: Int
    public let chainEndSequence: Int
}
