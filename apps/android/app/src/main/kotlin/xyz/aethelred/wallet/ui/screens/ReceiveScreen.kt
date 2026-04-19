package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.theme.AethelredTypography
import xyz.aethelred.wallet.viewmodel.WalletStateViewModel

/**
 * Receive flow — renders the primary account address (placeholder QR slot)
 * and a chain-specific warning so users don't accidentally broadcast
 * to the wrong network.
 *
 * QR rendering is deferred to a dedicated `zxing-android-embedded` or
 * Coil-based bitmap encoder in a follow-up PR. Keeping the dep footprint
 * tight in this scaffold.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun ReceiveScreen(
    onBack: () -> Unit,
    viewModel: WalletStateViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val primary = state.accounts.firstOrNull()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.receive_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.cd_back),
                        )
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
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        text = stringResource(R.string.receive_qr_hint),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = primary?.address ?: stringResource(R.string.accounts_empty),
                        style = AethelredTypography.Address,
                    )
                }
            }

            primary?.let {
                Text(
                    text = stringResource(R.string.receive_warning_chain, state.primaryNetworkName),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}
