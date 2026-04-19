package xyz.aethelred.wallet.data.room.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey
import java.math.BigInteger

/**
 * Persisted transaction. Powers the Activity screen and pending-tx worker.
 *
 * Amounts live as hex-encoded [BigInteger] via the Converters so wei
 * values above `Long.MAX_VALUE` survive the round-trip.
 */
@Entity(tableName = "transactions")
public data class StoredTransactionEntity(
    @PrimaryKey public val hash: String,
    @ColumnInfo(name = "chain_id") public val chainId: Long,
    @ColumnInfo(name = "from_address") public val fromAddress: String,
    @ColumnInfo(name = "to_address") public val toAddress: String?,
    @ColumnInfo(name = "value_wei") public val valueWei: BigInteger,
    @ColumnInfo(name = "gas_limit") public val gasLimit: BigInteger,
    @ColumnInfo(name = "gas_used") public val gasUsed: BigInteger?,
    @ColumnInfo(name = "max_fee_per_gas") public val maxFeePerGas: BigInteger,
    @ColumnInfo(name = "priority_fee_per_gas") public val priorityFeePerGas: BigInteger,
    @ColumnInfo(name = "nonce") public val nonce: BigInteger,
    @ColumnInfo(name = "status") public val status: String,
    @ColumnInfo(name = "block_number") public val blockNumber: Long?,
    @ColumnInfo(name = "submitted_at") public val submittedAt: Long,
    @ColumnInfo(name = "confirmed_at") public val confirmedAt: Long?,
    @ColumnInfo(name = "audit_event_id") public val auditEventId: String?,
    @ColumnInfo(name = "memo") public val memo: String? = null,
    @ColumnInfo(name = "direction") public val direction: String,
)
