package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.ActionTile
import xyz.aethelred.wallet.ui.components.AllocationRing
import xyz.aethelred.wallet.ui.components.AllocationSlice
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.AnimatedCounter
import xyz.aethelred.wallet.ui.components.CurrencyText
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.theme.BrandGradients
import xyz.aethelred.wallet.ui.theme.IconTokens

/** Snapshot of monthly spend + treasury mix. */
public data class PaymentsUi(
    public val monthSpendFormatted: String,
    public val monthSpendSymbol: String,
    public val monthSpendCounter: Long,
    public val treasurySlices: List<AllocationSlice>,
)

/**
 * Payments overview — Apple-Card-grade monthly hero card at the top, then
 * quick actions and a treasury allocation ring.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun PaymentsScreen(
    payments: PaymentsUi,
    onBack: () -> Unit,
    onPayContact: () -> Unit,
    onSendInvoice: () -> Unit,
    onScheduled: () -> Unit,
) {
    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.payments_title),
                onBack = onBack,
            )
        },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            GlassCard(modifier = Modifier.fillMaxWidth(), elevation = 2.dp) {
                Column {
                    Text(
                        text = stringResource(R.string.payments_hero_label),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                    CurrencyText(
                        amount = payments.monthSpendFormatted,
                        symbol = payments.monthSpendSymbol,
                    )
                    Spacer(Modifier.height(8.dp))
                    AnimatedCounter(
                        target = payments.monthSpendCounter,
                        style = MaterialTheme.typography.bodyMedium,
                        formatter = { "$it transactions" },
                    )
                }
            }

            Text(
                text = stringResource(R.string.payments_quick_actions),
                style = MaterialTheme.typography.titleMedium,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ActionTile(
                    label = stringResource(R.string.payments_action_pay),
                    icon = IconTokens.Send,
                    gradient = BrandGradients.success(),
                    onClick = onPayContact,
                    modifier = Modifier.weight(1f),
                )
                ActionTile(
                    label = stringResource(R.string.payments_action_invoice),
                    icon = IconTokens.Receipt,
                    gradient = BrandGradients.warning(),
                    onClick = onSendInvoice,
                    modifier = Modifier.weight(1f),
                )
                ActionTile(
                    label = stringResource(R.string.payments_action_scheduled),
                    icon = IconTokens.History,
                    gradient = BrandGradients.danger(),
                    onClick = onScheduled,
                    modifier = Modifier.weight(1f),
                )
            }

            Text(
                text = stringResource(R.string.payments_treasury),
                style = MaterialTheme.typography.titleMedium,
            )

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    AllocationRing(slices = payments.treasurySlices)
                }
            }
        }
    }
}
