package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.EmptyState
import xyz.aethelred.wallet.ui.components.SegmentedPillBar
import xyz.aethelred.wallet.ui.theme.IconTokens
import xyz.aethelred.wallet.ui.theme.LocalAethelredRadii

/** Display-only NFT row. */
public data class NftGridItem(
    public val id: String,
    public val label: String,
    public val collection: String,
)

/**
 * Digital assets grid — toggles between NFTs and verifiable credentials.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun DigitalAssetsScreen(
    nfts: List<NftGridItem>,
    credentials: List<CredentialUi>,
    onBack: () -> Unit,
    onNftClick: (String) -> Unit,
    onCredentialClick: (String) -> Unit,
) {
    var tab by remember { mutableIntStateOf(0) }
    val radii = LocalAethelredRadii.current

    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.digital_assets_title),
                onBack = onBack,
            )
        },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SegmentedPillBar(
                options = listOf(
                    stringResource(R.string.digital_assets_tab_nfts),
                    stringResource(R.string.digital_assets_tab_credentials),
                ),
                selectedIndex = tab,
                onSelect = { tab = it },
            )

            if (tab == 0) {
                if (nfts.isEmpty()) {
                    EmptyState(
                        icon = IconTokens.BrokenImage,
                        title = stringResource(R.string.digital_assets_empty_title),
                    )
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(nfts, key = { it.id }) { nft ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(radii.lg),
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(140.dp)
                                        .background(MaterialTheme.colorScheme.surfaceVariant),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(nft.label, style = MaterialTheme.typography.titleMedium)
                                }
                                Text(
                                    text = nft.collection,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            } else {
                if (credentials.isEmpty()) {
                    EmptyState(
                        icon = IconTokens.Identity,
                        title = stringResource(R.string.digital_assets_empty_title),
                    )
                } else {
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(2),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(credentials, key = { it.id }) { credential ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(radii.lg)
                                    .background(MaterialTheme.colorScheme.surfaceVariant)
                                    .padding(12.dp),
                            ) {
                                Text(credential.label, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    text = credential.issuer,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
