package xyz.aethelred.wallet.data.room.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import xyz.aethelred.wallet.data.room.entities.StoredAuditEventEntity

/** DAO backing the audit-event chain. */
@Dao
public interface AuditEventDao {
    /** Stream all events in sequence order (replay order). */
    @Query("SELECT * FROM audit_events ORDER BY sequence_number ASC")
    public fun observeAll(): Flow<List<StoredAuditEventEntity>>

    /** Events that haven't been shipped to the control plane yet. */
    @Query("SELECT * FROM audit_events WHERE shipped_at IS NULL ORDER BY sequence_number ASC")
    public suspend fun pendingShipment(): List<StoredAuditEventEntity>

    /** Insert — audit events are immutable. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    public suspend fun insert(event: StoredAuditEventEntity)

    /** Bulk insert for batch replays. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    public suspend fun insertAll(events: List<StoredAuditEventEntity>)

    /** Mark events shipped once the POST to the control plane succeeds. */
    @Query("UPDATE audit_events SET shipped_at = :shippedAt WHERE id IN (:ids)")
    public suspend fun markShipped(ids: List<String>, shippedAt: Long)

    /** Latest sequence number for chain-resume after process death. */
    @Query("SELECT MAX(sequence_number) FROM audit_events")
    public suspend fun latestSequence(): Long?
}
