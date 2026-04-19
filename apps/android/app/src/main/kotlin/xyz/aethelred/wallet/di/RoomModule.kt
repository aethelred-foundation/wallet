package xyz.aethelred.wallet.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import xyz.aethelred.wallet.data.room.AethelredDatabase
import xyz.aethelred.wallet.data.room.dao.AccountDao
import xyz.aethelred.wallet.data.room.dao.ApprovalDao
import xyz.aethelred.wallet.data.room.dao.AuditEventDao
import xyz.aethelred.wallet.data.room.dao.CredentialDao
import xyz.aethelred.wallet.data.room.dao.NetworkDao
import xyz.aethelred.wallet.data.room.dao.PasskeyDao
import xyz.aethelred.wallet.data.room.dao.SessionDao
import xyz.aethelred.wallet.data.room.dao.TenantDao
import xyz.aethelred.wallet.data.room.dao.TransactionDao
import javax.inject.Singleton

/**
 * Hilt bindings for the Room database + every DAO.
 *
 * Keeps database construction in one place so a test replacement can
 * `@TestInstallIn` this module and supply an in-memory DB via
 * `Room.inMemoryDatabaseBuilder(...)`.
 */
@Module
@InstallIn(SingletonComponent::class)
public object RoomModule {

    @Provides
    @Singleton
    public fun provideDatabase(
        @ApplicationContext context: Context,
    ): AethelredDatabase = AethelredDatabase.build(context)

    @Provides
    public fun provideAccountDao(db: AethelredDatabase): AccountDao = db.accountDao()

    @Provides
    public fun provideTransactionDao(db: AethelredDatabase): TransactionDao = db.transactionDao()

    @Provides
    public fun provideAuditEventDao(db: AethelredDatabase): AuditEventDao = db.auditEventDao()

    @Provides
    public fun provideCredentialDao(db: AethelredDatabase): CredentialDao = db.credentialDao()

    @Provides
    public fun provideSessionDao(db: AethelredDatabase): SessionDao = db.sessionDao()

    @Provides
    public fun provideNetworkDao(db: AethelredDatabase): NetworkDao = db.networkDao()

    @Provides
    public fun provideApprovalDao(db: AethelredDatabase): ApprovalDao = db.approvalDao()

    @Provides
    public fun providePasskeyDao(db: AethelredDatabase): PasskeyDao = db.passkeyDao()

    @Provides
    public fun provideTenantDao(db: AethelredDatabase): TenantDao = db.tenantDao()
}
