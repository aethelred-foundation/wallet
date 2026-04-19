import Foundation

/// Persistent audit service that composes ``AuditCapture`` and
/// ``MerkleBatch`` into a single write path.
///
/// Every recorded event is appended to the chain, forwarded to the
/// merkle batcher, and pushed to a persistence port so the data
/// survives a cold launch.
public actor AuditService {

    public struct Outcome: Sendable {
        public let event: AuditEvent
        public let finalizedBatch: FinalizedBatch?

        public init(event: AuditEvent, finalizedBatch: FinalizedBatch?) {
            self.event = event
            self.finalizedBatch = finalizedBatch
        }
    }

    private let capture: AuditCapturing
    private let batch: MerkleBatch
    private let persistence: AuditPersisting

    public init(
        capture: AuditCapturing,
        batch: MerkleBatch = MerkleBatch(),
        persistence: AuditPersisting = NoopAuditPersistence()
    ) {
        self.capture = capture
        self.batch = batch
        self.persistence = persistence
    }

    /// Record an event and return the resulting chain entry. If the
    /// append causes a merkle batch to finalize it is surfaced here.
    @discardableResult
    public func record(
        kind: AuditEventKind,
        subjectId: String,
        workspaceId: String,
        detail: [String: String] = [:]
    ) async throws -> Outcome {
        let event = await capture.record(
            kind: kind,
            subjectId: subjectId,
            workspaceId: workspaceId,
            detail: detail
        )
        let finalized = try await batch.add(event)
        try await persistence.save(event: event)
        if let finalized {
            try await persistence.save(batch: finalized)
        }
        return Outcome(event: event, finalizedBatch: finalized)
    }

    /// Force a batch finalization — typically called before export.
    public func finalize() async throws -> FinalizedBatch? {
        let finalized = await batch.finalize()
        if let finalized {
            try await persistence.save(batch: finalized)
        }
        return finalized
    }

    /// Snapshot of every known event.
    public func events() async -> [AuditEvent] {
        await capture.snapshot()
    }
}

/// Persistence port for the audit service.
public protocol AuditPersisting: Sendable {
    func save(event: AuditEvent) async throws
    func save(batch: FinalizedBatch) async throws
    func load() async throws -> [AuditEvent]
}

/// Default no-op. Replaced by `AuditPersistenceActor` (SwiftData) when
/// the persistence layer is initialized.
public struct NoopAuditPersistence: AuditPersisting {
    public init() {}
    public func save(event _: AuditEvent) async throws {}
    public func save(batch _: FinalizedBatch) async throws {}
    public func load() async throws -> [AuditEvent] { [] }
}
