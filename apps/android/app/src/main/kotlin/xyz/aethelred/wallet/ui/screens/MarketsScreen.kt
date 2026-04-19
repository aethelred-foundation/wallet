package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.SegmentedPillBar
import xyz.aethelred.wallet.ui.components.SparklineChart
import xyz.aethelred.wallet.ui.components.TokenRow

/** One token displayed on the Markets screen. */
public data class MarketToken(
    public val symbol: String,
    public val name: String,
    public val priceFormatted: String,
    public val changePercent: String,
    public val sparkline: List<Double>,
)

/**
 * Markets browser. Search field + sort-by pill + list of tokens with
 * inline sparklines.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun MarketsScreen(
    tokens: List<MarketToken>,
    onBack: () -> Unit,
    onTokenClick: (String) -> Unit,
) {
    var search by remember { mutableStateOf("") }
    var sortIndex by remember { mutableIntStateOf(0) }

    val filtered = tokens
        .filter {
            search.isBlank() ||
                it.symbol.contains(search, ignoreCase = true) ||
                it.name.contains(search, ignoreCase = true)
        }
        .let { list ->
            when (sortIndex) {
                1 -> list.sortedByDescending { it.changePercent.removeSuffix("%").toDoubleOrNull() ?: 0.0 }
                2 -> list.sortedBy { it.changePercent.removeSuffix("%").toDoubleOrNull() ?: 0.0 }
                else -> list
            }
        }

    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.markets_title),
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
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                placeholder = { Text(stringResource(R.string.markets_search_hint)) },
                modifier = Modifier.fillMaxWidth(),
            )
            SegmentedPillBar(
                options = listOf(
                    stringResource(R.string.markets_sort_rank),
                    stringResource(R.string.markets_sort_gainers),
                    stringResource(R.string.markets_sort_losers),
                ),
                selectedIndex = sortIndex,
                onSelect = { sortIndex = it },
            )
            LazyColumn(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(filtered, key = { it.symbol }) { token ->
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        TokenRow(
                            symbol = token.symbol,
                            name = token.name,
                            price = token.priceFormatted,
                            changePercent = token.changePercent,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (token.sparkline.isNotEmpty()) {
                            SparklineChart(
                                values = token.sparkline,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(40.dp)
                                    .padding(horizontal = 16.dp),
                            )
                            Spacer(Modifier.height(8.dp))
                        }
                    }
                }
            }

            if (filtered.isEmpty()) {
                Text(
                    text = stringResource(R.string.markets_search_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
