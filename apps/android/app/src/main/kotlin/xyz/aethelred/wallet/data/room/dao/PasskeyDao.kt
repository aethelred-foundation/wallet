package xyz.aethelred.wallet.data.room.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import xyz.aethelred.wallet.data.room.entities.StoredPasskeyCredentialEntity

/** DAO for FIDO2 passkey metadata. */
@Dao
public interface PasskeyDao {
    @Query("SELECT * FROM passkeys ORDER BY enrolled_at DESC")
    public fun observeAll(): Flow<List<StoredPasskeyCredentialEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun upsert(passkey: StoredPasskeyCredentialEntity)

    @Query("DELETE FROM passkeys WHERE credential_id = :credentialId")
    public suspend fun deleteById(credentialId: String)

    @Query("UPDATE passkeys SET last_used_at = :usedAt WHERE credential_id = :credentialId")
    public suspend fun stampLastUsed(credentialId: String, usedAt: Long)
}
