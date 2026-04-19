package xyz.aethelred.wallet.data.room.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Snapshot of the control-plane chain registry.
 *
 * Mirrors [xyz.aethelred.wallet.core.network.NetworkDefinition] so the
 * mobile app can run offline with the last-seen network catalogue, while
 * still refreshing from the control-plane when online.
 */
@Entity(tableName = "networks")
public data class StoredNetworkEntity(
    @PrimaryKey @ColumnInfo(name = "chain_id") public val chainId: Long,
    @ColumnInfo(name = "namespace") public val namespace: String,
    @ColumnInfo(name = "name") public val name: String,
    @ColumnInfo(name = "short_name") public val shortName: String,
    @ColumnInfo(name = "native_symbol") public val nativeSymbol: String,
    @ColumnInfo(name = "native_name") public val nativeName: String,
    @ColumnInfo(name = "native_decimals") public val nativeDecimals: Int,
    @ColumnInfo(name = "rpc_endpoints") public val rpcEndpoints: List<String>,
    @ColumnInfo(name = "block_explorer_url") public val blockExplorerUrl: String,
    @ColumnInfo(name = "icon_url") public val iconUrl: String,
    @ColumnInfo(name = "is_testnet") public val isTestnet: Boolean,
    @ColumnInfo(name = "supports_eip1559") public val supportsEip1559: Boolean,
    @ColumnInfo(name = "average_block_time") public val averageBlockTime: Int,
    @ColumnInfo(name = "multicall3_address") public val multicall3Address: String?,
)
