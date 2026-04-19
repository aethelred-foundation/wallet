package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.EmptyState
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.theme.IconTokens

/** Catalog entry displayed on the Hub. */
public data class HubEntryUi(
    public val id: String,
    public val name: String,
    public val summary: String,
    public val url: String,
)

/** dApp catalog / hub. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun HubScreen(
    entries: List<HubEntryUi>,
    onBack: () -> Unit,
    onOpen: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.hub_title),
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
            Text(
                text = stringResource(R.string.hub_featured),
                style = MaterialTheme.typography.titleMedium,
            )
            if (entries.isEmpty()) {
                EmptyState(
                    icon = IconTokens.Apps,
                    title = stringResource(R.string.hub_empty),
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(entries, key = { it.id }) { entry ->
                        GlassCard(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onOpen(entry.url) },
                        ) {
                            Column {
                                Text(entry.name, style = MaterialTheme.typography.titleMedium)
                                Text(
                                    text = entry.summary,
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
