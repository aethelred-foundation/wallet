import BackgroundTasks
import Foundation

/// Background-task identifiers we schedule via `BGTaskScheduler`.
public enum BackgroundTaskId: String, Sendable, CaseIterable {
    case balanceRefresh = "network.aethelred.wallet.bg.balance-refresh"
    case pendingTxPoll = "network.aethelred.wallet.bg.pending-tx-poll"
    case auditBatchFinalize = "network.aethelred.wallet.bg.audit-batch-finalize"
}

/// Wrapper around `BGTaskScheduler` that centralizes the list of
/// background tasks the wallet registers. Consumers provide handlers
/// that receive a cancellation token and return early on expiry.
public final class BackgroundTaskScheduler: @unchecked Sendable {

    public typealias Handler = @Sendable (BackgroundTaskContext) async -> Void

    public struct BackgroundTaskContext: Sendable {
        public let taskId: BackgroundTaskId
        public let isCancelled: @Sendable () -> Bool
    }

    private let registrar: BGTaskRegistering
    private let scheduler: BGTaskScheduling

    public init(
        registrar: BGTaskRegistering = DefaultBGTaskRegistrar(),
        scheduler: BGTaskScheduling = DefaultBGTaskScheduler()
    ) {
        self.registrar = registrar
        self.scheduler = scheduler
    }

    /// Register a handler for each background task the wallet uses.
    public func register(_ handlers: [BackgroundTaskId: Handler]) {
        for (taskId, handler) in handlers {
            registrar.register(identifier: taskId.rawValue) { [weak self] task in
                Task {
                    let isCancelled: @Sendable () -> Bool = { task.expirationHandler != nil }
                    await handler(BackgroundTaskContext(taskId: taskId, isCancelled: isCancelled))
                    task.setTaskCompleted(success: true)
                }
                task.expirationHandler = {
                    task.setTaskCompleted(success: false)
                }
                self?.schedule(taskId, delay: 60 * 15)
            }
        }
    }

    /// Kick off the scheduler with initial submissions.
    public func bootstrap() {
        for taskId in BackgroundTaskId.allCases {
            schedule(taskId, delay: 60 * 15)
        }
    }

    /// Explicitly schedule a task for execution.
    public func schedule(_ taskId: BackgroundTaskId, delay: TimeInterval) {
        let request = BGAppRefreshTaskRequest(identifier: taskId.rawValue)
        request.earliestBeginDate = Date().addingTimeInterval(delay)
        scheduler.submit(request)
    }
}

/// Dependency wrappers around BGTaskScheduler so the scheduler is
/// testable without a real BGTaskScheduler instance.
public protocol BGTaskRegistering: Sendable {
    func register(identifier: String, handler: @escaping @Sendable (BGTask) -> Void)
}

public protocol BGTaskScheduling: Sendable {
    func submit(_ request: BGTaskRequest)
}

public struct DefaultBGTaskRegistrar: BGTaskRegistering {
    public init() {}

    public func register(identifier: String, handler: @escaping @Sendable (BGTask) -> Void) {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            handler(task)
        }
    }
}

public struct DefaultBGTaskScheduler: BGTaskScheduling {
    public init() {}

    public func submit(_ request: BGTaskRequest) {
        try? BGTaskScheduler.shared.submit(request)
    }
}
