package xyz.aethelred.wallet.ui.screens

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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.EmptyState
import xyz.aethelred.wallet.ui.components.SegmentedPillBar
import xyz.aethelred.wallet.ui.components.TransactionRow
import xyz.aethelred.wallet.ui.components.TxDirection
import xyz.aethelred.wallet.ui.theme.IconTokens

/**
 * Display-only transaction model rendered by [ActivityScreen].
 *
 * Real data flows in from the `TransactionDao` via
 * `ActivityViewModel.observe()`; the scaffold plumbs a placeholder list
 * so visual regression tests can run without a database.
 */
public data class ActivityItem(
    public val id: String,
    public val direction: TxDirection,
    public val title: String,
    public val subtitle: String,
    public val amountFormatted: String,
    public val timestamp: String,
)

/**
 * Transaction-history screen with filter pills.
 *
 * Filters map to the five [TxDirection] buckets; pull-to-refresh is
 * deferred to the Material3 pull-refresh composable once it ships stable.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun ActivityScreen(
    onBack: () -> Unit,
    onItemClick: (String) -> Unit,
    items: List<ActivityItem> = emptyList(),
) {
    var filterIndex by remember { mutableIntStateOf(0) }
    val filters = listOf(
        stringResource(R.string.activity_filter_all),
        stringResource(R.string.activity_filter_incoming),
        stringResource(R.string.activity_filter_outgoing),
        stringResource(R.string.activity_filter_pending),
        stringResource(R.string.activity_filter_failed),
    )

    val filtered = when (filterIndex) {
        1 -> items.filter { it.direction == TxDirection.Incoming }
        2 -> items.filter { it.direction == TxDirection.Outgoing }
        3 -> items.filter { it.direction == TxDirection.Pending }
        4 -> items.filter { it.direction == TxDirection.Failed }
        else -> items
    }

    Scaffold(
        topBar = {
            AppTopBar(title = stringResource(R.string.activity_title), onBack = onBack)
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
                options = filters,
                selectedIndex = filterIndex,
                onSelect = { filterIndex = it },
                modifier = Modifier.fillMaxWidth(),
            )

            if (filtered.isEmpty()) {
                EmptyState(
                    icon = IconTokens.History,
                    title = stringResource(R.string.activity_empty_title),
                    description = stringResource(R.string.activity_empty_description),
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(filtered) { item ->
                        TransactionRow(
                            direction = item.direction,
                            title = item.title,
                            subtitle = item.subtitle,
                            amountFormatted = item.amountFormatted,
                            timestamp = item.timestamp,
                            onClick = { onItemClick(item.id) },
                        )
                    }
                }
            }

            Text(
                text = stringResource(R.string.activity_refresh),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
