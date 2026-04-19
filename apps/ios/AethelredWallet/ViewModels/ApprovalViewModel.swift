import Foundation
import SwiftUI

/// Decision state for a pending approval sheet.
public enum ApprovalState: Sendable, Equatable {
    case pending
    case approved
    case denied(reason: String)
    case error(String)
}

/// Drives ``ApprovalSheet``.
///
/// Owned by the view for the duration of an approval modal. Evaluates
/// the pending intent against the ``PolicyEngine`` the moment the sheet
/// appears, and exposes the computed verdict + the user's manual
/// decision back to the caller.
@MainActor
public final class ApprovalViewModel: ObservableObject {

    @Published public private(set) var state: ApprovalState = .pending
    @Published public private(set) var evaluation: PolicyEvaluationResult?

    public let context: PolicyContext
    public let summary: ApprovalSummary

    private let engine: PolicyEngine
    private let audit: AuditCapturing

    public init(
        context: PolicyContext,
        summary: ApprovalSummary,
        engine: PolicyEngine,
        audit: AuditCapturing
    ) {
        self.context = context
        self.summary = summary
        self.engine = engine
        self.audit = audit
    }

    /// Evaluate the policy engine synchronously and fold the result
    /// into the UI state. Call from `.onAppear`.
    public func bootstrap() async {
        let result = engine.evaluate(context: context)
        evaluation = result
        await audit.record(
            kind: .policyEvaluated,
            subjectId: context.subject.id,
            workspaceId: context.workspace.id,
            detail: [
                "outcome": result.outcome.rawValue,
                "matchedRuleCount": String(result.matchedRules.count)
            ]
        )
    }

    public func approve() async {
        state = .approved
        await audit.record(
            kind: .approvalDecided,
            subjectId: context.subject.id,
            workspaceId: context.workspace.id,
            detail: ["decision": "approved"]
        )
    }

    public func deny(reason: String) async {
        state = .denied(reason: reason)
        await audit.record(
            kind: .approvalDecided,
            subjectId: context.subject.id,
            workspaceId: context.workspace.id,
            detail: ["decision": "denied", "reason": reason]
        )
    }
}

/// Human-readable summary of the intent being approved.
public struct ApprovalSummary: Sendable, Equatable {
    public let title: String
    public let subtitle: String
    public let destination: String?
    public let assetSymbol: String?
    public let amount: Decimal?

    public init(
        title: String,
        subtitle: String,
        destination: String? = nil,
        assetSymbol: String? = nil,
        amount: Decimal? = nil
    ) {
        self.title = title
        self.subtitle = subtitle
        self.destination = destination
        self.assetSymbol = assetSymbol
        self.amount = amount
    }
}
