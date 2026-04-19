import Foundation

/// Principal acting within a workspace.
///
/// Parallels the `Subject` type the control-plane exposes through
/// `@aethelred/wallet-connect`. Kept lightweight — the iOS app only
/// needs the identity needed to stamp audit events and evaluate
/// policies; deeper fields (ACL entries, credential bundle) come from
/// the backend.
public struct Subject: Codable, Sendable, Equatable, Identifiable {

    public let id: String
    public let displayName: String
    public let role: SubjectRole
    public let workspaceId: String
    public let createdAt: Int64

    public init(
        id: String,
        displayName: String,
        role: SubjectRole,
        workspaceId: String,
        createdAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) {
        self.id = id
        self.displayName = displayName
        self.role = role
        self.workspaceId = workspaceId
        self.createdAt = createdAt
    }
}

/// Roles a subject can hold within a workspace. Mirrors the
/// `WorkspaceRole` union in the TypeScript `wallet-connect` package.
public enum SubjectRole: String, Codable, Sendable, Equatable, CaseIterable {
    case owner
    case admin
    case operatorRole = "operator"
    case reviewer
    case viewer
}
