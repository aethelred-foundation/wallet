package xyz.aethelred.wallet.data.room.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Room row for an on-device account.
 *
 * The mobile-wallet DTO in `core.identity` is what the UI renders; this
 * row is for persistence only. A mapper in the DAO turns one into the
 * other.
 *
 * @property id Internal UUID.
 * @property displayName User-given nickname.
 * @property address Lower-cased `0x…` hex address.
 * @property namespace Chain namespace discriminator (EIP155 / BIP122 / SOLANA).
 * @property custody "local" / "hardware" / "mpc" — tracked so UI can show
 *                   the correct badge.
 * @property assuranceLevel "strongbox" / "tee" / "software" — from the
 *                          [xyz.aethelred.wallet.core.crypto.StrongBoxKeyStore] probe.
 * @property preferredChainId Chain the user most recently selected for this account.
 * @property createdAt Epoch ms when the account was first added.
 */
@Entity(tableName = "accounts")
public data class StoredAccountEntity(
    @PrimaryKey public val id: String,
    @ColumnInfo(name = "display_name") public val displayName: String,
    @ColumnInfo(name = "address") public val address: String,
    @ColumnInfo(name = "namespace") public val namespace: String,
    @ColumnInfo(name = "custody") public val custody: String,
    @ColumnInfo(name = "assurance_level") public val assuranceLevel: String,
    @ColumnInfo(name = "preferred_chain_id") public val preferredChainId: Long,
    @ColumnInfo(name = "created_at") public val createdAt: Long,
    @ColumnInfo(name = "is_hidden", defaultValue = "0") public val isHidden: Boolean = false,
)
