package xyz.aethelred.wallet.data.room.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Persisted FIDO2 passkey metadata.
 *
 * Lets the SecurityScreen render every authenticator bound to this
 * wallet instance without hitting the control-plane on every paint.
 * The raw attestation blob and public keys live server-side.
 */
@Entity(tableName = "passkeys")
public data class StoredPasskeyCredentialEntity(
    @PrimaryKey @ColumnInfo(name = "credential_id") public val credentialId: String,
    @ColumnInfo(name = "subject_id") public val subjectId: String,
    @ColumnInfo(name = "label") public val label: String,
    @ColumnInfo(name = "aaguid") public val aaguid: String?,
    @ColumnInfo(name = "enrolled_at") public val enrolledAt: Long,
    @ColumnInfo(name = "last_used_at") public val lastUsedAt: Long?,
    @ColumnInfo(name = "transport") public val transport: String,
    @ColumnInfo(name = "residence") public val residence: String,
)
