package xyz.aethelred.wallet.data.room.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import xyz.aethelred.wallet.data.room.entities.StoredTransactionEntity

/** DAO backing the tx history. */
@Dao
public interface TransactionDao {
    /** Stream every tx ordered newest-first. */
    @Query("SELECT * FROM transactions ORDER BY submitted_at DESC")
    public fun observeAll(): Flow<List<StoredTransactionEntity>>

    /** Stream by account address — the AccountDetail screen subscribes here. */
    @Query(
        "SELECT * FROM transactions " +
            "WHERE from_address = :address OR to_address = :address " +
            "ORDER BY submitted_at DESC",
    )
    public fun observeByAddress(address: String): Flow<List<StoredTransactionEntity>>

    /** Pending transactions — worker + UI share this. */
    @Query("SELECT * FROM transactions WHERE status = 'pending' ORDER BY submitted_at ASC")
    public suspend fun pending(): List<StoredTransactionEntity>

    /** Upsert. */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun upsert(tx: StoredTransactionEntity)

    /** Update status once a receipt arrives. */
    @Query("UPDATE transactions SET status = :status, confirmed_at = :confirmedAt WHERE hash = :hash")
    public suspend fun updateStatus(hash: String, status: String, confirmedAt: Long?)
}
