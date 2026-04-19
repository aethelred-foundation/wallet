package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.viewmodel.WalletStateViewModel

/**
 * Listing of every wallet account. Clicking one navigates to
 * [AccountDetailScreen]; the header actions open the add / import flows.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun AccountsScreen(
    onOpenAccount: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: WalletStateViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.accounts_title)) },
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
        ) {
            if (state.accounts.isEmpty()) {
                Text(
                    text = stringResource(R.string.accounts_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(state.accounts) { account ->
                        GlassCard(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onOpenAccount(account.id) },
                        ) {
                            Column {
                                Text(account.displayName, style = MaterialTheme.typography.titleMedium)
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    text = account.address,
                                    style = xyz.aethelred.wallet.ui.theme.AethelredTypography.Address,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            FilledTonalButton(
                onClick = { viewModel.createAccount() },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.accounts_add))
            }
            Spacer(Modifier.height(8.dp))
            FilledTonalButton(
                onClick = { viewModel.importAccount() },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.accounts_import))
            }
        }
    }
}
