import Foundation
import SwiftData

/// Central registry of the app's SwiftData schema.
///
/// Includes every `@Model` type. When a new model is added it MUST be
/// appended to ``schema`` so the migration manager generates a correct
/// migration descriptor.
public enum PersistenceContainer {

    /// The canonical schema — every model type that participates in
    /// persistence.
    public static let schemaTypes: [any PersistentModel.Type] = [
        StoredAccount.self,
        StoredTransaction.self,
        StoredAuditEvent.self,
        StoredCredential.self,
        StoredSession.self,
        StoredNetwork.self,
        StoredApproval.self,
        StoredPasskeyCredential.self,
        StoredTenantProfile.self
    ]

    /// Build a production container. Uses the default store URL with a
    /// schema pinned to version 1.
    @MainActor
    public static func make() throws -> ModelContainer {
        let schema = Schema(schemaTypes)
        let configuration = ModelConfiguration(
            "AethelredWallet",
            schema: schema,
            isStoredInMemoryOnly: false
        )
        return try ModelContainer(for: schema, configurations: configuration)
    }

    /// Build an in-memory container for tests.
    @MainActor
    public static func makeInMemory() throws -> ModelContainer {
        let schema = Schema(schemaTypes)
        let configuration = ModelConfiguration(
            "AethelredWalletTests",
            schema: schema,
            isStoredInMemoryOnly: true
        )
        return try ModelContainer(for: schema, configurations: configuration)
    }
}
