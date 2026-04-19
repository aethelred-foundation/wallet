package xyz.aethelred.wallet.data.room.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import xyz.aethelred.wallet.data.room.entities.StoredAccountEntity

/** Room DAO backing the accounts table. */
@Dao
public interface AccountDao {
    /** Stream every account ordered by [StoredAccountEntity.createdAt]. */
    @Query("SELECT * FROM accounts ORDER BY created_at ASC")
    public fun observeAll(): Flow<List<StoredAccountEntity>>

    /** One-shot read. Used by migration utilities and tests. */
    @Query("SELECT * FROM accounts")
    public suspend fun listAll(): List<StoredAccountEntity>

    /** Fetch a single account by id. */
    @Query("SELECT * FROM accounts WHERE id = :id LIMIT 1")
    public suspend fun findById(id: String): StoredAccountEntity?

    /** Upsert via IGNORE + update — Room 2.7 will expose first-class upsert. */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun upsert(account: StoredAccountEntity)

    /** Delete an account by id. */
    @Query("DELETE FROM accounts WHERE id = :id")
    public suspend fun deleteById(id: String)

    /** Hide (soft-delete) an account. Keeps audit events intact. */
    @Query("UPDATE accounts SET is_hidden = 1 WHERE id = :id")
    public suspend fun hide(id: String)
}
