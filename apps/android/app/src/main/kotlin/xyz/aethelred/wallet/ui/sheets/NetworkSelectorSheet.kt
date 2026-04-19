package xyz.aethelred.wallet.ui.sheets

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.BottomSheet
import xyz.aethelred.wallet.ui.components.SegmentedPillBar
import xyz.aethelred.wallet.ui.theme.IconTokens

/** Single network row. */
public data class NetworkOption(
    public val chainId: Long,
    public val name: String,
    public val namespace: NetworkNamespace,
    public val isTestnet: Boolean,
)

/** Namespace filter for the sheet's segmented pill. */
public enum class NetworkNamespace { Evm, Bitcoin, Solana, Cosmos }

/**
 * Modal sheet that lets the user pick the active network.
 *
 * Four segmented filters cover the cross-ecosystem namespaces the wallet
 * supports. The list re-filters reactively when the pill changes.
 */
@Composable
public fun NetworkSelectorSheet(
    networks: List<NetworkOption>,
    selectedChainId: Long,
    onSelect: (Long) -> Unit,
    onDismissRequest: () -> Unit,
) {
    var namespaceIndex by remember { mutableIntStateOf(0) }
    val namespaces = listOf(
        stringResource(R.string.network_selector_evm),
        stringResource(R.string.network_selector_bitcoin),
        stringResource(R.string.network_selector_solana),
        stringResource(R.string.network_selector_cosmos),
    )
    val filterEnum = when (namespaceIndex) {
        0 -> NetworkNamespace.Evm
        1 -> NetworkNamespace.Bitcoin
        2 -> NetworkNamespace.Solana
        else -> NetworkNamespace.Cosmos
    }
    val filtered = networks.filter { it.namespace == filterEnum }

    BottomSheet(
        onDismissRequest = onDismissRequest,
        title = stringResource(R.string.network_selector_title),
    ) {
        SegmentedPillBar(
            options = namespaces,
            selectedIndex = namespaceIndex,
            onSelect = { namespaceIndex = it },
        )
        Spacer(Modifier.height(12.dp))
        LazyColumn {
            items(filtered, key = { it.chainId }) { network ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(network.chainId) }
                        .padding(vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = IconTokens.Network,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurface,
                    )
                    Column(
                        modifier = Modifier
                            .padding(start = 12.dp)
                            .weight(1f),
                    ) {
                        Text(network.name, style = MaterialTheme.typography.titleMedium)
                        if (network.isTestnet) {
                            Text(
                                "Testnet",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (network.chainId == selectedChainId) {
                        Icon(
                            imageVector = IconTokens.Check,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        }
    }
}
