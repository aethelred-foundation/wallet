package xyz.aethelred.wallet.data.room

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import xyz.aethelred.wallet.data.room.dao.AccountDao
import xyz.aethelred.wallet.data.room.dao.ApprovalDao
import xyz.aethelred.wallet.data.room.dao.AuditEventDao
import xyz.aethelred.wallet.data.room.dao.CredentialDao
import xyz.aethelred.wallet.data.room.dao.NetworkDao
import xyz.aethelred.wallet.data.room.dao.PasskeyDao
import xyz.aethelred.wallet.data.room.dao.SessionDao
import xyz.aethelred.wallet.data.room.dao.TenantDao
import xyz.aethelred.wallet.data.room.dao.TransactionDao
import xyz.aethelred.wallet.data.room.entities.StoredAccountEntity
import xyz.aethelred.wallet.data.room.entities.StoredApprovalEntity
import xyz.aethelred.wallet.data.room.entities.StoredAuditEventEntity
import xyz.aethelred.wallet.data.room.entities.StoredCredentialEntity
import xyz.aethelred.wallet.data.room.entities.StoredNetworkEntity
import xyz.aethelred.wallet.data.room.entities.StoredPasskeyCredentialEntity
import xyz.aethelred.wallet.data.room.entities.StoredSessionEntity
import xyz.aethelred.wallet.data.room.entities.StoredTenantProfileEntity
import xyz.aethelred.wallet.data.room.entities.StoredTransactionEntity

/**
 * Room database for the Aethelred Wallet.
 *
 * Version history:
 *  * v1 → initial schema (accounts + transactions).
 *  * v2 → added audit_events, credentials, sessions, networks, approvals,
 *         passkeys, tenants.
 */
@Database(
    entities = [
        StoredAccountEntity::class,
        StoredTransactionEntity::class,
        StoredAuditEventEntity::class,
        StoredCredentialEntity::class,
        StoredSessionEntity::class,
        StoredNetworkEntity::class,
        StoredApprovalEntity::class,
        StoredPasskeyCredentialEntity::class,
        StoredTenantProfileEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
@TypeConverters(Converters::class)
public abstract class AethelredDatabase : RoomDatabase() {

    /** DAO for the accounts table. */
    public abstract fun accountDao(): AccountDao

    /** DAO for the transactions table. */
    public abstract fun transactionDao(): TransactionDao

    /** DAO for the audit-event chain. */
    public abstract fun auditEventDao(): AuditEventDao

    /** DAO for credentials. */
    public abstract fun credentialDao(): CredentialDao

    /** DAO for active sessions. */
    public abstract fun sessionDao(): SessionDao

    /** DAO for the network registry snapshot. */
    public abstract fun networkDao(): NetworkDao

    /** DAO for in-flight approvals. */
    public abstract fun approvalDao(): ApprovalDao

    /** DAO for passkey metadata. */
    public abstract fun passkeyDao(): PasskeyDao

    /** DAO for tenants / workspaces. */
    public abstract fun tenantDao(): TenantDao

    public companion object {
        /** Database filename inside `databaseBuilder`'s path. */
        public const val DATABASE_NAME: String = "aethelred_wallet.db"

        /**
         * v1 → v2 migration stub. Creates the tables added in v2 when an
         * existing v1 installation is upgraded on-device.
         */
        public val MIGRATION_1_2: Migration = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS audit_events(
                        id TEXT NOT NULL PRIMARY KEY,
                        sequence_number INTEGER NOT NULL,
                        timestamp INTEGER NOT NULL,
                        kind TEXT NOT NULL,
                        subject_id TEXT NOT NULL,
                        workspace_id TEXT NOT NULL,
                        app_id TEXT,
                        session_id TEXT,
                        intent_id TEXT,
                        detail TEXT,
                        previous_hash TEXT NOT NULL,
                        event_hash TEXT NOT NULL,
                        batch_id TEXT,
                        shipped_at INTEGER
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS credentials(
                        id TEXT NOT NULL PRIMARY KEY,
                        subject_id TEXT NOT NULL,
                        type TEXT NOT NULL,
                        label TEXT NOT NULL,
                        issued_at INTEGER NOT NULL,
                        expires_at INTEGER,
                        issuer_did TEXT,
                        status TEXT NOT NULL,
                        detail TEXT
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS sessions(
                        topic TEXT NOT NULL PRIMARY KEY,
                        kind TEXT NOT NULL,
                        origin TEXT NOT NULL,
                        origin_icon_url TEXT,
                        namespaces TEXT,
                        accounts TEXT,
                        created_at INTEGER NOT NULL,
                        expires_at INTEGER NOT NULL,
                        last_used_at INTEGER,
                        metadata TEXT
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS networks(
                        chain_id INTEGER NOT NULL PRIMARY KEY,
                        namespace TEXT NOT NULL,
                        name TEXT NOT NULL,
                        short_name TEXT NOT NULL,
                        native_symbol TEXT NOT NULL,
                        native_name TEXT NOT NULL,
                        native_decimals INTEGER NOT NULL,
                        rpc_endpoints TEXT,
                        block_explorer_url TEXT NOT NULL,
                        icon_url TEXT NOT NULL,
                        is_testnet INTEGER NOT NULL,
                        supports_eip1559 INTEGER NOT NULL,
                        average_block_time INTEGER NOT NULL,
                        multicall3_address TEXT
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS approvals(
                        id TEXT NOT NULL PRIMARY KEY,
                        workflow_id TEXT,
                        originator TEXT NOT NULL,
                        intent TEXT NOT NULL,
                        intent_summary TEXT NOT NULL,
                        chain_id INTEGER NOT NULL,
                        amount_usd REAL,
                        risk_level TEXT NOT NULL,
                        policy_allowed INTEGER NOT NULL,
                        status TEXT NOT NULL,
                        received_at INTEGER NOT NULL,
                        decided_at INTEGER
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS passkeys(
                        credential_id TEXT NOT NULL PRIMARY KEY,
                        subject_id TEXT NOT NULL,
                        label TEXT NOT NULL,
                        aaguid TEXT,
                        enrolled_at INTEGER NOT NULL,
                        last_used_at INTEGER,
                        transport TEXT NOT NULL,
                        residence TEXT NOT NULL
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS tenants(
                        id TEXT NOT NULL PRIMARY KEY,
                        display_name TEXT NOT NULL,
                        kind TEXT NOT NULL,
                        region TEXT,
                        plan TEXT NOT NULL,
                        enrolled_at INTEGER NOT NULL,
                        control_plane_url TEXT NOT NULL,
                        feature_flags TEXT
                    )
                    """.trimIndent(),
                )
            }
        }

        /**
         * Build the database. Call once per process from a Hilt provider.
         *
         * Fallback-to-destructive is deliberately OFF so a version bump
         * without a migration crashes loudly during QA instead of silently
         * wiping user data.
         */
        public fun build(context: Context): AethelredDatabase =
            Room.databaseBuilder(context, AethelredDatabase::class.java, DATABASE_NAME)
                .addMigrations(MIGRATION_1_2)
                .build()
    }
}
