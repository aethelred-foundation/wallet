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
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AllocationRing
import xyz.aethelred.wallet.ui.components.AllocationSlice
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.CurrencyText
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.components.TokenRow

/** Placeholder view-model outputs the real screen consumes. */
public data class PortfolioUi(
    public val totalValueFormatted: String,
    public val totalSymbol: String,
    public val slices: List<AllocationSlice>,
    public val holdings: List<TokenHolding>,
    public val stakingPositions: List<StakingPosition>,
    public val defiPositions: List<DefiPosition>,
)

/** One holdings row. */
public data class TokenHolding(
    public val symbol: String,
    public val name: String,
    public val priceFormatted: String,
    public val changePercent: String,
)

/** Staking position summary. */
public data class StakingPosition(
    public val id: String,
    public val protocol: String,
    public val amountFormatted: String,
    public val aprPercent: String,
)

/** DeFi LP / lending position. */
public data class DefiPosition(
    public val id: String,
    public val protocol: String,
    public val positionSummary: String,
    public val valueFormatted: String,
)

/**
 * Portfolio dashboard.
 *
 * Hero tile shows total value; below it, an allocation ring renders the
 * asset mix; then rows for holdings, staking, and DeFi positions.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun PortfolioScreen(
    portfolio: PortfolioUi,
    onBack: () -> Unit,
) {
    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.portfolio_title),
                onBack = onBack,
            )
        },
    ) { inner ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                GlassCard(modifier = Modifier.fillMaxWidth(), elevation = 2.dp) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = stringResource(R.string.portfolio_total_value),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        CurrencyText(
                            amount = portfolio.totalValueFormatted,
                            symbol = portfolio.totalSymbol,
                        )
                        Spacer(Modifier.height(12.dp))
                        AllocationRing(
                            slices = portfolio.slices,
                            centerLabel = portfolio.totalSymbol,
                        )
                    }
                }
            }

            item {
                Text(
                    text = stringResource(R.string.portfolio_section_allocation),
                    style = MaterialTheme.typography.titleMedium,
                )
            }

            items(portfolio.holdings, key = { it.symbol }) { holding ->
                TokenRow(
                    symbol = holding.symbol,
                    name = holding.name,
                    price = holding.priceFormatted,
                    changePercent = holding.changePercent,
                )
            }

            item {
                Text(
                    text = stringResource(R.string.portfolio_section_staking),
                    style = MaterialTheme.typography.titleMedium,
                )
            }

            items(portfolio.stakingPositions, key = { it.id }) { position ->
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        Text(position.protocol, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = "${position.amountFormatted}, APR ${position.aprPercent}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            item {
                Text(
                    text = stringResource(R.string.portfolio_section_defi),
                    style = MaterialTheme.typography.titleMedium,
                )
            }

            items(portfolio.defiPositions, key = { it.id }) { pos ->
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        Text(pos.protocol, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = pos.positionSummary,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(pos.valueFormatted, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}

/** Preview helper — generates a believable default without an RPC call. */
public fun samplePortfolio(): PortfolioUi = PortfolioUi(
    totalValueFormatted = "12,450.22",
    totalSymbol = "USD",
    slices = listOf(
        AllocationSlice("ETH", 0.55f, Color(0xFF627EEA)),
        AllocationSlice("BTC", 0.25f, Color(0xFFF7931A)),
        AllocationSlice("USDC", 0.15f, Color(0xFF2775CA)),
        AllocationSlice("Other", 0.05f, Color(0xFF8E8E93)),
    ),
    holdings = emptyList(),
    stakingPositions = emptyList(),
    defiPositions = emptyList(),
)
