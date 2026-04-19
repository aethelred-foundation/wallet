import Foundation
import SwiftData

/// Persisted audit event. Mirrors ``AuditEvent`` verbatim so the chain
/// can be replayed after a cold boot without losing sequence integrity.
@Model
public final class StoredAuditEvent {
    @Attribute(.unique) public var id: String
    public var sequenceNumber: Int
    public var timestamp: Int64
    public var kindRaw: String
    public var subjectId: String
    public var workspaceId: String
    public var appId: String?
    public var sessionId: String?
    public var intentId: String?
    public var detailJson: String
    public var previousHash: String
    public var eventHash: String

    public init(
        id: String,
        sequenceNumber: Int,
        timestamp: Int64,
        kindRaw: String,
        subjectId: String,
        workspaceId: String,
        appId: String? = nil,
        sessionId: String? = nil,
        intentId: String? = nil,
        detailJson: String,
        previousHash: String,
        eventHash: String
    ) {
        self.id = id
        self.sequenceNumber = sequenceNumber
        self.timestamp = timestamp
        self.kindRaw = kindRaw
        self.subjectId = subjectId
        self.workspaceId = workspaceId
        self.appId = appId
        self.sessionId = sessionId
        self.intentId = intentId
        self.detailJson = detailJson
        self.previousHash = previousHash
        self.eventHash = eventHash
    }

    /// Round-trip an AuditEvent into a persisted row.
    public static func from(_ event: AuditEvent) -> StoredAuditEvent {
        StoredAuditEvent(
            id: event.id,
            sequenceNumber: event.sequenceNumber,
            timestamp: event.timestamp,
            kindRaw: event.kind.rawValue,
            subjectId: event.subjectId,
            workspaceId: event.workspaceId,
            appId: event.appId,
            sessionId: event.sessionId,
            intentId: event.intentId,
            detailJson: Self.encodeDetail(event.detail),
            previousHash: event.previousHash,
            eventHash: event.eventHash
        )
    }

    /// Convert back to the domain ``AuditEvent`` shape.
    public func toDomain() -> AuditEvent? {
        guard let kind = AuditEventKind(rawValue: kindRaw) else { return nil }
        return AuditEvent(
            id: id,
            sequenceNumber: sequenceNumber,
            timestamp: timestamp,
            kind: kind,
            subjectId: subjectId,
            workspaceId: workspaceId,
            appId: appId,
            sessionId: sessionId,
            intentId: intentId,
            detail: Self.decodeDetail(detailJson),
            previousHash: previousHash,
            eventHash: eventHash
        )
    }

    internal static func encodeDetail(_ detail: [String: String]) -> String {
        guard let data = try? JSONEncoder().encode(detail),
              let string = String(data: data, encoding: .utf8) else { return "{}" }
        return string
    }

    internal static func decodeDetail(_ json: String) -> [String: String] {
        guard let data = json.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return decoded
    }
}
