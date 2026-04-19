package xyz.aethelred.wallet.core.identity

import kotlinx.serialization.Serializable

/**
 * User-visible representation of an account inside the wallet.
 *
 * This is the DTO the UI binds against — richer fields live on the full
 * domain object managed by `WalletStateRepository`. Keeping the UI DTO
 * narrow means a redaction bug cannot accidentally leak private-key
 * material into a compose recomposition.
 */
@Serializable
public data class WalletAccount(
    /** Internal identifier (UUID). */
    public val id: String,
    /** User-given nickname, e.g. "Treasury". */
    public val displayName: String,
    /** Lower-cased `0x…` EVM address. */
    public val address: String,
    /** Native balance formatted for display. */
    public val balanceFormatted: String,
    /** Ticker of the active network (e.g. "ETH"). */
    public val nativeSymbol: String,
    /** Chain-id currently selected for this account. */
    public val chainId: Long,
)
