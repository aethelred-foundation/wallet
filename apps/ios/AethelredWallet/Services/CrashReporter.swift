import Foundation

/// Abstract crash reporter. Concrete implementations shadow Sentry /
/// Firebase Crashlytics integrations that the team wires in later.
public protocol CrashReporting: Sendable {
    /// Capture a non-fatal error with contextual metadata.
    func capture(error: Error, context: [String: String])
    /// Capture a non-error event — used for diagnostic breadcrumbs.
    func breadcrumb(name: String, data: [String: String])
    /// Flag the current user on the reporter.
    func setUser(subjectId: String?)
}

/// Default no-op reporter. Callers can record breadcrumbs through it
/// without ever wiring a real crash reporter in debug builds.
public struct NoopCrashReporter: CrashReporting {
    public init() {}
    public func capture(error _: Error, context _: [String: String]) {}
    public func breadcrumb(name _: String, data _: [String: String]) {}
    public func setUser(subjectId _: String?) {}
}

/// In-memory reporter used by tests.
public final class MemoryCrashReporter: CrashReporting, @unchecked Sendable {
    public enum Entry: Sendable, Equatable {
        case error(String, [String: String])
        case breadcrumb(String, [String: String])
        case user(String?)
    }

    private let lock = NSLock()
    public private(set) var entries: [Entry] = []

    public init() {}

    public func capture(error: Error, context: [String: String]) {
        lock.lock(); defer { lock.unlock() }
        entries.append(.error(String(describing: error), context))
    }

    public func breadcrumb(name: String, data: [String: String]) {
        lock.lock(); defer { lock.unlock() }
        entries.append(.breadcrumb(name, data))
    }

    public func setUser(subjectId: String?) {
        lock.lock(); defer { lock.unlock() }
        entries.append(.user(subjectId))
    }
}
