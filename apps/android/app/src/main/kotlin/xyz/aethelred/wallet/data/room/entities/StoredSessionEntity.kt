package xyz.aethelred.wallet.data.room.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Active session row — covers WalletConnect pairings and agent
 * delegations.
 *
 * @property kind One of: `walletconnect`, `delegation`, `passkey`.
 */
@Entity(tableName = "sessions")
public data class StoredSessionEntity(
    @PrimaryKey public val topic: String,
    @ColumnInfo(name = "kind") public val kind: String,
    @ColumnInfo(name = "origin") public val origin: String,
    @ColumnInfo(name = "origin_icon_url") public val originIconUrl: String?,
    @ColumnInfo(name = "namespaces") public val namespaces: List<String>,
    @ColumnInfo(name = "accounts") public val accounts: List<String>,
    @ColumnInfo(name = "created_at") public val createdAt: Long,
    @ColumnInfo(name = "expires_at") public val expiresAt: Long,
    @ColumnInfo(name = "last_used_at") public val lastUsedAt: Long?,
    @ColumnInfo(name = "metadata") public val metadata: Map<String, String>,
)
