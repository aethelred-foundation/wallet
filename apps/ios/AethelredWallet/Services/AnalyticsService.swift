import Foundation

/// Privacy-preserving analytics events.
public enum AnalyticsEvent: Sendable, Equatable {
    case onboardingStepCompleted(step: String)
    case accountCreated(namespace: String)
    case transactionSent(chainId: Int)
    case transactionFailed(chainId: Int, reason: String)
    case swapExecuted(fromSymbol: String, toSymbol: String)
    case approvalApproved(intentKind: String)
    case approvalDenied(intentKind: String, reason: String)
    case dAppConnected(origin: String)
    case dAppDisconnected(origin: String)
    case screenViewed(name: String)
    case featureFlagFlipped(flag: String, value: Bool)
    case custom(name: String, properties: [String: String])
}

/// Opt-in analytics port. Production implementations are deliberately
/// in-house (no third-party SDK) — events flow through the audit chain
/// and are uploaded as aggregated batches.
public protocol AnalyticsPort: Sendable {
    func enable()
    func disable()
    func isEnabled() async -> Bool
    func record(_ event: AnalyticsEvent)
}

/// In-memory default implementation. Writes every event into an in-app
/// journal that the caller drains on its own cadence.
public actor AnalyticsService: AnalyticsPort {

    private var journal: [AnalyticsEvent] = []
    private var enabled: Bool

    public init(enabled: Bool = false) {
        self.enabled = enabled
    }

    public func enable() { enabled = true }
    public func disable() { enabled = false; journal.removeAll() }
    public func isEnabled() -> Bool { enabled }

    public func record(_ event: AnalyticsEvent) {
        guard enabled else { return }
        journal.append(event)
    }

    /// Drain the journal and return the buffered events.
    public func drain() -> [AnalyticsEvent] {
        let copy = journal
        journal.removeAll()
        return copy
    }
}
