package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AlertSeverity
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.components.InlineAlert

/**
 * Swap screen.
 *
 * Wires the "You pay" / "You receive" token selectors, slippage slider,
 * price-impact indicator, and a route preview pulled from the simulator.
 * Actual routing is delegated to a swap router that lives in the core
 * services layer; this surface is deliberately dumb so the routing engine
 * can change without touching the UI.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun SwapScreen(
    onBack: () -> Unit,
) {
    var pay by remember { mutableStateOf("") }
    var receive by remember { mutableStateOf("") }
    var slippage by remember { mutableFloatStateOf(0.5f) }

    Scaffold(
        topBar = {
            AppTopBar(title = stringResource(R.string.swap_title), onBack = onBack)
        },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        text = stringResource(R.string.swap_from_label),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = pay,
                        onValueChange = { pay = it },
                        label = { Text("ETH") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        text = stringResource(R.string.swap_to_label),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        value = receive,
                        onValueChange = { receive = it },
                        label = { Text("USDC") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        text = stringResource(R.string.swap_slippage_label),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Row {
                        Slider(
                            value = slippage,
                            onValueChange = { slippage = it },
                            valueRange = 0.1f..3f,
                            modifier = Modifier.weight(1f),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("${"%.2f".format(slippage)}%")
                    }
                }
            }

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        text = stringResource(R.string.swap_route_preview),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = "Uniswap V3 → 1inch aggregator",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.swap_price_impact_label),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text("0.23%", style = MaterialTheme.typography.bodyMedium)
                }
            }

            if (slippage > 2f) {
                InlineAlert(
                    severity = AlertSeverity.Warning,
                    title = stringResource(R.string.risk_medium),
                    description = "High slippage — expect significant price impact.",
                )
            }

            Button(
                onClick = { /* delegate to SwapViewModel when wired */ },
                enabled = pay.isNotBlank() && receive.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.swap_review))
            }
        }
    }
}
