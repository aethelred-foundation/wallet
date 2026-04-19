package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.CallReceived
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.CurrencyText
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.viewmodel.WalletStateViewModel

/**
 * Primary landing screen. Shows the portfolio hero, quick actions, and a
 * feed of recent signing activity.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun HomeScreen(
    onOpenAccounts: () -> Unit,
    onOpenSend: () -> Unit,
    onOpenReceive: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenApproval: () -> Unit,
    viewModel: WalletStateViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.app_name)) },
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.settings_title))
                    }
                },
            )
        },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            GlassCard(
                modifier = Modifier.fillMaxWidth(),
                padding = PaddingValues(24.dp),
                elevation = 2.dp,
            ) {
                Column {
                    Text(
                        text = stringResource(R.string.home_primary_balance_label),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                    CurrencyText(
                        amount = state.portfolioValueFormatted,
                        symbol = state.portfolioSymbol,
                    )
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                HomeAction(
                    label = stringResource(R.string.home_action_send),
                    icon = { Icon(Icons.AutoMirrored.Filled.Send, contentDescription = null) },
                    modifier = Modifier.weight(1f),
                    onClick = onOpenSend,
                )
                HomeAction(
                    label = stringResource(R.string.home_action_receive),
                    icon = { Icon(Icons.AutoMirrored.Filled.CallReceived, contentDescription = null) },
                    modifier = Modifier.weight(1f),
                    onClick = onOpenReceive,
                )
                HomeAction(
                    label = stringResource(R.string.home_action_swap),
                    icon = { Icon(Icons.Filled.SwapHoriz, contentDescription = null) },
                    modifier = Modifier.weight(1f),
                    onClick = onOpenApproval, // placeholder wiring — swap to dedicated screen later
                )
            }

            Text(
                text = stringResource(R.string.home_section_activity),
                style = MaterialTheme.typography.titleMedium,
            )

            if (state.recentActivity.isEmpty()) {
                Text(
                    text = stringResource(R.string.home_empty_activity),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.recentActivity) { item ->
                        GlassCard(modifier = Modifier.fillMaxWidth()) {
                            Column {
                                Text(item.title, style = MaterialTheme.typography.titleSmall)
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    item.subtitle,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(4.dp))
            FilledTonalButton(onClick = onOpenAccounts, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.accounts_title))
            }
        }
    }
}

@Composable
private fun HomeAction(
    label: String,
    icon: @Composable () -> Unit,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    FilledTonalButton(
        onClick = onClick,
        modifier = modifier,
    ) {
        icon()
        Spacer(Modifier.width(8.dp))
        Text(label)
    }
}
