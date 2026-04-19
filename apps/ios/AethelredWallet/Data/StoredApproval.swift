import Foundation
import SwiftData

/// Persisted approval row — used by the Approvals tab so quorum
/// progress survives restarts.
@Model
public final class StoredApproval {
    @Attribute(.unique) public var id: String
    public var workspaceId: String
    public var initiatorSubjectId: String
    public var intentKind: String
    public var summary: String
    public var quorumNeeded: Int
    public var approvalsJson: String
    public var statusRaw: String
    public var createdAt: Int64
    public var expiresAt: Int64?

    public init(
        id: String,
        workspaceId: String,
        initiatorSubjectId: String,
        intentKind: String,
        summary: String,
        quorumNeeded: Int,
        approvalsJson: String,
        statusRaw: String,
        createdAt: Int64,
        expiresAt: Int64? = nil
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.initiatorSubjectId = initiatorSubjectId
        self.intentKind = intentKind
        self.summary = summary
        self.quorumNeeded = quorumNeeded
        self.approvalsJson = approvalsJson
        self.statusRaw = statusRaw
        self.createdAt = createdAt
        self.expiresAt = expiresAt
    }
}
