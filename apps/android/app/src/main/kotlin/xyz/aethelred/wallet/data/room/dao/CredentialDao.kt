package xyz.aethelred.wallet.data.room.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import xyz.aethelred.wallet.data.room.entities.StoredCredentialEntity

/** DAO backing the credential store. */
@Dao
public interface CredentialDao {
    /** Stream every credential ordered by issue time. */
    @Query("SELECT * FROM credentials ORDER BY issued_at DESC")
    public fun observeAll(): Flow<List<StoredCredentialEntity>>

    /** Filter to a specific credential type. */
    @Query("SELECT * FROM credentials WHERE type = :type ORDER BY issued_at DESC")
    public fun observeByType(type: String): Flow<List<StoredCredentialEntity>>

    /** Fetch a credential. */
    @Query("SELECT * FROM credentials WHERE id = :id LIMIT 1")
    public suspend fun findById(id: String): StoredCredentialEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun upsert(credential: StoredCredentialEntity)

    @Query("DELETE FROM credentials WHERE id = :id")
    public suspend fun deleteById(id: String)
}
