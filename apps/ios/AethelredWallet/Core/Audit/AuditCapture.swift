import CryptoKit
import Foundation

/// Records audit events for the wallet and produces a hash-linked chain.
///
/// Protocol-oriented so the app's core logic depends on the abstract
/// interface; tests substitute a collecting fake to assert which events
/// were emitted in a given flow.
public protocol AuditCapturing: Sendable {
    /// Record a new event. Returns the resulting ``AuditEvent`` so
    /// callers can attach its `eventHash` to a downstream batch.
    @discardableResult
    func record(
        kind: AuditEventKind,
        subjectId: String,
        workspaceId: String,
        appId: String?,
        sessionId: String?,
        intentId: String?,
        detail: [String: String]
    ) async -> AuditEvent

    /// Return every recorded event in order. The implementation may be
    /// backed by disk; callers treat the array as a snapshot.
    func snapshot() async -> [AuditEvent]

    /// Verify the hash chain of the current snapshot — each event's
    /// `previousHash` must equal the prior event's `eventHash`.
    func verifyChain() async -> Bool
}

extension AuditCapturing {
    /// Overload for call sites that don't care about optional IDs.
    @discardableResult
    public func record(
        kind: AuditEventKind,
        subjectId: String,
        workspaceId: String,
        detail: [String: String] = [:]
    ) async -> AuditEvent {
        await record(
            kind: kind,
            subjectId: subjectId,
            workspaceId: workspaceId,
            appId: nil,
            sessionId: nil,
            intentId: nil,
            detail: detail
        )
    }
}

/// Production implementation — an actor so concurrent callers can't race
/// on the sequence counter.
public actor AuditCapture: AuditCapturing {

    private var events: [AuditEvent] = []
    private var nextSequence: Int = 1
    private let now: @Sendable () -> Int64
    private let uuid: @Sendable () -> String

    public init(
        now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
        uuid: @escaping @Sendable () -> String = { UUID().uuidString }
    ) {
        self.now = now
        self.uuid = uuid
    }

    @discardableResult
    public func record(
        kind: AuditEventKind,
        subjectId: String,
        workspaceId: String,
        appId: String? = nil,
        sessionId: String? = nil,
        intentId: String? = nil,
        detail: [String: String] = [:]
    ) async -> AuditEvent {
        let previousHash = events.last?.eventHash
            ?? String(repeating: "0", count: 64)

        let partial = AuditEventCanonical(
            id: uuid(),
            sequenceNumber: nextSequence,
            timestamp: now(),
            kind: kind,
            subjectId: subjectId,
            workspaceId: workspaceId,
            appId: appId,
            sessionId: sessionId,
            intentId: intentId,
            detail: detail,
            previousHash: previousHash
        )

        let eventHash = Self.computeEventHash(partial)
        let event = AuditEvent(
            id: partial.id,
            sequenceNumber: partial.sequenceNumber,
            timestamp: partial.timestamp,
            kind: partial.kind,
            subjectId: partial.subjectId,
            workspaceId: partial.workspaceId,
            appId: partial.appId,
            sessionId: partial.sessionId,
            intentId: partial.intentId,
            detail: partial.detail,
            previousHash: partial.previousHash,
            eventHash: eventHash
        )
        events.append(event)
        nextSequence += 1
        return event
    }

    public func snapshot() async -> [AuditEvent] {
        events
    }

    public func verifyChain() async -> Bool {
        guard !events.isEmpty else { return true }
        var previousHash = String(repeating: "0", count: 64)
        for event in events {
            guard event.previousHash == previousHash else { return false }
            let partial = AuditEventCanonical(
                id: event.id,
                sequenceNumber: event.sequenceNumber,
                timestamp: event.timestamp,
                kind: event.kind,
                subjectId: event.subjectId,
                workspaceId: event.workspaceId,
                appId: event.appId,
                sessionId: event.sessionId,
                intentId: event.intentId,
                detail: event.detail,
                previousHash: event.previousHash
            )
            let expected = Self.computeEventHash(partial)
            if expected != event.eventHash { return false }
            previousHash = event.eventHash
        }
        return true
    }

    /// Canonical serialization + SHA-256 — matches the TypeScript
    /// reference implementation so events produced on device are
    /// verifiable by the Elixir event-ingestion service byte-for-byte.
    internal static func computeEventHash(_ partial: AuditEventCanonical) -> String {
        let json = canonicalJSON(of: partial)
        let digest = SHA256.hash(data: Data(json.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Stable, deterministic JSON encoding. Keys are sorted so two
    /// machines produce the same bytes.
    private static func canonicalJSON(of partial: AuditEventCanonical) -> String {
        var entries: [(String, String)] = [
            ("id", quote(partial.id)),
            ("sequenceNumber", String(partial.sequenceNumber)),
            ("timestamp", String(partial.timestamp)),
            ("kind", quote(partial.kind.rawValue)),
            ("subjectId", quote(partial.subjectId)),
            ("workspaceId", quote(partial.workspaceId))
        ]
        if let appId = partial.appId { entries.append(("appId", quote(appId))) }
        if let sessionId = partial.sessionId { entries.append(("sessionId", quote(sessionId))) }
        if let intentId = partial.intentId { entries.append(("intentId", quote(intentId))) }
        let detailKeys = partial.detail.keys.sorted()
        let detailBody = detailKeys.map { key in
            "\(quote(key)):\(quote(partial.detail[key] ?? ""))"
        }.joined(separator: ",")
        entries.append(("detail", "{\(detailBody)}"))
        entries.append(("previousHash", quote(partial.previousHash)))

        let body = entries.map { "\(quote($0.0)):\($0.1)" }.joined(separator: ",")
        return "{\(body)}"
    }

    private static func quote(_ string: String) -> String {
        "\"\(string.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
    }
}

/// Pre-hash representation of an audit event — everything except the
/// final `eventHash`. Declared internally so the hashing logic can
/// operate on a strongly-typed value.
internal struct AuditEventCanonical: Sendable {
    let id: String
    let sequenceNumber: Int
    let timestamp: Int64
    let kind: AuditEventKind
    let subjectId: String
    let workspaceId: String
    let appId: String?
    let sessionId: String?
    let intentId: String?
    let detail: [String: String]
    let previousHash: String
}

/// In-memory test helper that records every event emitted during a
/// flow. Not thread-safe — tests are single-actor.
public final class AuditRecordingSpy: AuditCapturing, @unchecked Sendable {
    public private(set) var captured: [AuditEvent] = []
    private let inner = AuditCapture()

    public init() {}

    @discardableResult
    public func record(
        kind: AuditEventKind,
        subjectId: String,
        workspaceId: String,
        appId: String?,
        sessionId: String?,
        intentId: String?,
        detail: [String: String]
    ) async -> AuditEvent {
        let event = await inner.record(
            kind: kind,
            subjectId: subjectId,
            workspaceId: workspaceId,
            appId: appId,
            sessionId: sessionId,
            intentId: intentId,
            detail: detail
        )
        captured.append(event)
        return event
    }

    public func snapshot() async -> [AuditEvent] {
        await inner.snapshot()
    }

    public func verifyChain() async -> Bool {
        await inner.verifyChain()
    }
}
