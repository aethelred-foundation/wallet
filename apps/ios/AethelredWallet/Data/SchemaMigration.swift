import Foundation
import SwiftData

/// Schema versioning for SwiftData migrations.
///
/// The wallet pins its initial release to `v1`. Any additive change
/// (new `@Model`, new property on an existing model) should bump to
/// `v2` and add a `VersionedSchema` descriptor so a lightweight
/// migration plan is generated automatically.
public enum SchemaVersion {

    /// Initial schema shipped with the 0.1 release.
    public enum V1: VersionedSchema {
        public static var versionIdentifier: Schema.Version { Schema.Version(1, 0, 0) }

        public static var models: [any PersistentModel.Type] {
            [
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
        }
    }
}

/// Migration plan for the wallet schema — starts with only V1. Once
/// `V2` ships, add a stage that declares the lightweight rename /
/// additive operations.
public enum WalletMigrationPlan: SchemaMigrationPlan {
    public static var schemas: [any VersionedSchema.Type] {
        [SchemaVersion.V1.self]
    }

    public static var stages: [MigrationStage] {
        []
    }
}
