package xyz.aethelred.wallet.data.room.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import xyz.aethelred.wallet.data.room.entities.StoredApprovalEntity

/** DAO for pending / historic approvals. */
@Dao
public interface ApprovalDao {
    @Query("SELECT * FROM approvals ORDER BY received_at DESC")
    public fun observeAll(): Flow<List<StoredApprovalEntity>>

    @Query("SELECT * FROM approvals WHERE status = 'pending' ORDER BY received_at DESC")
    public fun observePending(): Flow<List<StoredApprovalEntity>>

    @Query("SELECT * FROM approvals WHERE id = :id LIMIT 1")
    public suspend fun findById(id: String): StoredApprovalEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun upsert(approval: StoredApprovalEntity)

    @Query("UPDATE approvals SET status = :status, decided_at = :decidedAt WHERE id = :id")
    public suspend fun decide(id: String, status: String, decidedAt: Long)
}
