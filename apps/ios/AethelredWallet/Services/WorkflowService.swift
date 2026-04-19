import Foundation

/// Typed status of a multi-sig workflow.
public enum WorkflowStatus: String, Sendable, Codable, Equatable {
    case pending
    case awaitingQuorum = "awaiting-quorum"
    case approved
    case rejected
    case executed
    case expired
}

/// Workflow model — a multi-sig approval grouping.
public struct WorkflowRecord: Sendable, Equatable, Codable, Identifiable, Hashable {
    public let id: String
    public let workspaceId: String
    public let initiatorSubjectId: String
    public let intentKind: String
    public let summary: String
    public let quorumNeeded: Int
    public let approvals: [WorkflowApproval]
    public let status: WorkflowStatus
    public let createdAt: Int64
    public let expiresAt: Int64?

    public init(
        id: String,
        workspaceId: String,
        initiatorSubjectId: String,
        intentKind: String,
        summary: String,
        quorumNeeded: Int,
        approvals: [WorkflowApproval],
        status: WorkflowStatus,
        createdAt: Int64,
        expiresAt: Int64? = nil
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.initiatorSubjectId = initiatorSubjectId
        self.intentKind = intentKind
        self.summary = summary
        self.quorumNeeded = quorumNeeded
        self.approvals = approvals
        self.status = status
        self.createdAt = createdAt
        self.expiresAt = expiresAt
    }

    public var isTerminal: Bool {
        switch status {
        case .approved, .rejected, .executed, .expired: return true
        default: return false
        }
    }

    public var approvalCount: Int { approvals.filter { $0.decision == .approved }.count }
    public var remaining: Int { max(0, quorumNeeded - approvalCount) }
}

public struct WorkflowApproval: Sendable, Equatable, Codable, Hashable {
    public enum Decision: String, Sendable, Codable, Equatable {
        case approved, denied
    }

    public let subjectId: String
    public let decision: Decision
    public let occurredAt: Int64

    public init(subjectId: String, decision: Decision, occurredAt: Int64) {
        self.subjectId = subjectId
        self.decision = decision
        self.occurredAt = occurredAt
    }
}

/// Service that tracks in-flight approvals and exposes them to the UI.
public actor WorkflowService {

    private var workflows: [String: WorkflowRecord] = [:]
    private let now: @Sendable () -> Int64

    public init(now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) {
        self.now = now
    }

    public func upsert(_ workflow: WorkflowRecord) {
        workflows[workflow.id] = workflow
    }

    public func record(approval: WorkflowApproval, for id: String) -> WorkflowRecord? {
        guard var workflow = workflows[id], !workflow.isTerminal else { return workflows[id] }
        var approvals = workflow.approvals
        approvals.removeAll(where: { $0.subjectId == approval.subjectId })
        approvals.append(approval)
        let approved = approvals.filter { $0.decision == .approved }.count
        let status: WorkflowStatus = {
            if approval.decision == .denied { return .rejected }
            if approved >= workflow.quorumNeeded { return .approved }
            return .awaitingQuorum
        }()
        workflow = WorkflowRecord(
            id: workflow.id,
            workspaceId: workflow.workspaceId,
            initiatorSubjectId: workflow.initiatorSubjectId,
            intentKind: workflow.intentKind,
            summary: workflow.summary,
            quorumNeeded: workflow.quorumNeeded,
            approvals: approvals,
            status: status,
            createdAt: workflow.createdAt,
            expiresAt: workflow.expiresAt
        )
        workflows[id] = workflow
        return workflow
    }

    public func list() -> [WorkflowRecord] {
        workflows.values.sorted { $0.createdAt > $1.createdAt }
    }

    public func get(_ id: String) -> WorkflowRecord? { workflows[id] }
}
