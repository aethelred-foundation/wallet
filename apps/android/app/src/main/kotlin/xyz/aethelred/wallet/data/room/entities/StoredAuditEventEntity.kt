package xyz.aethelred.wallet.data.room.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Persistent audit-event row. Together the rows form the hash-linked
 * chain that `AuditCapture` produces at runtime.
 *
 * Persisting to Room means a process death never drops any events — the
 * control-plane fanout loop picks them up on next launch.
 */
@Entity(tableName = "audit_events")
public data class StoredAuditEventEntity(
    @PrimaryKey public val id: String,
    @ColumnInfo(name = "sequence_number") public val sequenceNumber: Long,
    @ColumnInfo(name = "timestamp") public val timestamp: Long,
    @ColumnInfo(name = "kind") public val kind: String,
    @ColumnInfo(name = "subject_id") public val subjectId: String,
    @ColumnInfo(name = "workspace_id") public val workspaceId: String,
    @ColumnInfo(name = "app_id") public val appId: String?,
    @ColumnInfo(name = "session_id") public val sessionId: String?,
    @ColumnInfo(name = "intent_id") public val intentId: String?,
    @ColumnInfo(name = "detail") public val detail: Map<String, String>,
    @ColumnInfo(name = "previous_hash") public val previousHash: String,
    @ColumnInfo(name = "event_hash") public val eventHash: String,
    @ColumnInfo(name = "batch_id") public val batchId: String?,
    @ColumnInfo(name = "shipped_at") public val shippedAt: Long?,
)
