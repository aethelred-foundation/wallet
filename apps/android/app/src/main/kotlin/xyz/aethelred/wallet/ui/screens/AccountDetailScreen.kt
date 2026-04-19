package xyz.aethelred.wallet.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.CurrencyText
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.theme.AethelredTypography
import xyz.aethelred.wallet.viewmodel.WalletStateViewModel

/**
 * Per-account detail page. Shows the address, native balance, and the
 * slots for tokens / history that the product team fills out in a
 * follow-up PR.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun AccountDetailScreen(
    accountId: String,
    onBack: () -> Unit,
    viewModel: WalletStateViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val account = state.accounts.firstOrNull { it.id == accountId }
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(account?.displayName ?: stringResource(R.string.account_detail_title)) },
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
            if (account == null) {
                Text(
                    text = stringResource(R.string.error_generic),
                    color = MaterialTheme.colorScheme.error,
                )
                return@Column
            }

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        text = account.address,
                        style = AethelredTypography.Address,
                    )
                    Spacer(Modifier.height(12.dp))
                    CurrencyText(
                        amount = account.balanceFormatted,
                        symbol = account.nativeSymbol,
                    )
                }
            }

            FilledTonalButton(
                onClick = { copyAddress(context, account.address) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.account_detail_copy_address))
            }

            Text(stringResource(R.string.account_detail_section_tokens), style = MaterialTheme.typography.titleMedium)
            // Token list slot — filled in by the Android product team.

            Text(stringResource(R.string.account_detail_section_history), style = MaterialTheme.typography.titleMedium)
            // History slot — paginated by HistoryViewModel once implemented.
        }
    }
}

private fun copyAddress(context: Context, address: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("address", address))
}
