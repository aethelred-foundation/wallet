import Foundation
import SwiftData

/// Model actor that wraps the SwiftData container with typed query
/// helpers. Every read/write on `StoredAccount`, `StoredTransaction`,
/// `StoredAuditEvent`, etc. should flow through this actor so
/// concurrency is serialized correctly.
@ModelActor
public actor WalletPersistenceActor {

    // MARK: Accounts

    public func upsertAccount(_ record: StoredAccount) throws {
        if let existing = try modelContext.fetch(
            FetchDescriptor<StoredAccount>(predicate: #Predicate<StoredAccount> { $0.id == record.id })
        ).first {
            existing.label = record.label
            existing.address = record.address
            existing.custodyMode = record.custodyMode
            existing.devicePolicy = record.devicePolicy
            existing.biometricGate = record.biometricGate
            existing.assuranceLevel = record.assuranceLevel
            existing.updatedAt = record.updatedAt
        } else {
            modelContext.insert(record)
        }
        try modelContext.save()
    }

    public func allAccounts() throws -> [StoredAccount] {
        try modelContext.fetch(FetchDescriptor<StoredAccount>(sortBy: [SortDescriptor(\.createdAt)]))
    }

    public func deleteAccount(id: String) throws {
        let descriptor = FetchDescriptor<StoredAccount>(predicate: #Predicate { $0.id == id })
        for account in try modelContext.fetch(descriptor) {
            modelContext.delete(account)
        }
        try modelContext.save()
    }

    // MARK: Transactions

    public func upsertTransaction(_ record: StoredTransaction) throws {
        let hash = record.hash
        if let existing = try modelContext.fetch(
            FetchDescriptor<StoredTransaction>(predicate: #Predicate { $0.hash == hash })
        ).first {
            existing.statusRaw = record.statusRaw
            existing.blockNumber = record.blockNumber
            existing.minedAt = record.minedAt
            existing.gasUsedHex = record.gasUsedHex
            existing.auditEventId = record.auditEventId
        } else {
            modelContext.insert(record)
        }
        try modelContext.save()
    }

    public func transactions(for address: String, chainId: Int?) throws -> [StoredTransaction] {
        let predicate: Predicate<StoredTransaction>
        let normalized = address.lowercased()
        if let chainId {
            predicate = #Predicate<StoredTransaction> {
                ($0.fromAddress.lowercased() == normalized || $0.toAddress.lowercased() == normalized)
                    && $0.chainId == chainId
            }
        } else {
            predicate = #Predicate<StoredTransaction> {
                $0.fromAddress.lowercased() == normalized || $0.toAddress.lowercased() == normalized
            }
        }
        var descriptor = FetchDescriptor<StoredTransaction>(predicate: predicate)
        descriptor.sortBy = [SortDescriptor(\.submittedAt, order: .reverse)]
        return try modelContext.fetch(descriptor)
    }

    // MARK: Audit events

    public func appendAuditEvent(_ record: StoredAuditEvent) throws {
        modelContext.insert(record)
        try modelContext.save()
    }

    public func allAuditEvents() throws -> [StoredAuditEvent] {
        try modelContext.fetch(FetchDescriptor<StoredAuditEvent>(sortBy: [SortDescriptor(\.sequenceNumber)]))
    }

    // MARK: Credentials

    public func upsertCredential(_ record: StoredCredential) throws {
        let id = record.id
        if let existing = try modelContext.fetch(
            FetchDescriptor<StoredCredential>(predicate: #Predicate { $0.id == id })
        ).first {
            existing.payload = record.payload
            existing.expiresAt = record.expiresAt
        } else {
            modelContext.insert(record)
        }
        try modelContext.save()
    }

    public func allCredentials() throws -> [StoredCredential] {
        try modelContext.fetch(FetchDescriptor<StoredCredential>(sortBy: [SortDescriptor(\.issuedAt, order: .reverse)]))
    }

    // MARK: Sessions

    public func upsertSession(_ record: StoredSession) throws {
        let id = record.id
        if let existing = try modelContext.fetch(
            FetchDescriptor<StoredSession>(predicate: #Predicate { $0.id == id })
        ).first {
            existing.topic = record.topic
            existing.expiry = record.expiry
        } else {
            modelContext.insert(record)
        }
        try modelContext.save()
    }

    public func allSessions() throws -> [StoredSession] {
        try modelContext.fetch(FetchDescriptor<StoredSession>(sortBy: [SortDescriptor(\.expiry, order: .reverse)]))
    }

    public func deleteSession(id: String) throws {
        let descriptor = FetchDescriptor<StoredSession>(predicate: #Predicate { $0.id == id })
        for session in try modelContext.fetch(descriptor) {
            modelContext.delete(session)
        }
        try modelContext.save()
    }
}

/// Audit persistence implementation backed by ``WalletPersistenceActor``.
public struct SwiftDataAuditPersistence: AuditPersisting {
    private let actor: WalletPersistenceActor

    public init(actor: WalletPersistenceActor) {
        self.actor = actor
    }

    public func save(event: AuditEvent) async throws {
        try await actor.appendAuditEvent(StoredAuditEvent.from(event))
    }

    public func save(batch _: FinalizedBatch) async throws {
        // Batch finalization is handled by the audit service itself;
        // this hook is available for a future index table.
    }

    public func load() async throws -> [AuditEvent] {
        try await actor.allAuditEvents().compactMap { $0.toDomain() }
    }
}
