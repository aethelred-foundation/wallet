package xyz.aethelred.wallet.data.room.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Row for an in-flight approval (single-sig or part of a multi-sig quorum).
 */
@Entity(tableName = "approvals")
public data class StoredApprovalEntity(
    @PrimaryKey public val id: String,
    @ColumnInfo(name = "workflow_id") public val workflowId: String?,
    @ColumnInfo(name = "originator") public val originator: String,
    @ColumnInfo(name = "intent") public val intent: String,
    @ColumnInfo(name = "intent_summary") public val intentSummary: String,
    @ColumnInfo(name = "chain_id") public val chainId: Long,
    @ColumnInfo(name = "amount_usd") public val amountUsd: Double?,
    @ColumnInfo(name = "risk_level") public val riskLevel: String,
    @ColumnInfo(name = "policy_allowed") public val policyAllowed: Boolean,
    @ColumnInfo(name = "status") public val status: String,
    @ColumnInfo(name = "received_at") public val receivedAt: Long,
    @ColumnInfo(name = "decided_at") public val decidedAt: Long?,
)
