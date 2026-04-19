package xyz.aethelred.wallet.data.room.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Verifiable credential row. The actual key material lives in hardware;
 * only the metadata is persisted here so the RegulatoryPassport screen
 * can render the list even while offline.
 */
@Entity(tableName = "credentials")
public data class StoredCredentialEntity(
    @PrimaryKey public val id: String,
    @ColumnInfo(name = "subject_id") public val subjectId: String,
    @ColumnInfo(name = "type") public val type: String,
    @ColumnInfo(name = "label") public val label: String,
    @ColumnInfo(name = "issued_at") public val issuedAt: Long,
    @ColumnInfo(name = "expires_at") public val expiresAt: Long?,
    @ColumnInfo(name = "issuer_did") public val issuerDid: String?,
    @ColumnInfo(name = "status") public val status: String,
    @ColumnInfo(name = "detail") public val detail: Map<String, String>,
)
