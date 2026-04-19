package xyz.aethelred.wallet.ui.sheets

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.BottomSheet
import xyz.aethelred.wallet.ui.theme.IconTokens

/** Display-only account row for the switcher. */
public data class AccountSwitcherOption(
    public val id: String,
    public val label: String,
    public val address: String,
    public val isActive: Boolean,
)

/**
 * Account switcher sheet. Tap an entry to switch; the "Create new"
 * button drops into the Accounts → Create flow.
 */
@Composable
public fun AccountSwitcherSheet(
    accounts: List<AccountSwitcherOption>,
    onSelect: (String) -> Unit,
    onCreate: () -> Unit,
    onDismissRequest: () -> Unit,
) {
    BottomSheet(
        onDismissRequest = onDismissRequest,
        title = stringResource(R.string.accounts_switcher_title),
    ) {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(accounts, key = { it.id }) { account ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSelect(account.id) }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = if (account.isActive) IconTokens.Star else IconTokens.Account,
                        contentDescription = null,
                        tint = if (account.isActive) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                    Column(
                        modifier = Modifier
                            .padding(start = 12.dp)
                            .weight(1f),
                    ) {
                        Text(account.label, style = MaterialTheme.typography.titleMedium)
                        Text(
                            text = account.address,
                            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onCreate, modifier = Modifier.fillMaxWidth()) {
            Icon(IconTokens.Add, contentDescription = null)
            Text(stringResource(R.string.accounts_switcher_new))
        }
    }
}
