package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.EmptyState
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.components.RiskIndicator
import xyz.aethelred.wallet.ui.components.RiskLevel
import xyz.aethelred.wallet.ui.theme.IconTokens

/** Display row for one token approval. */
public data class TokenApprovalUi(
    public val id: String,
    public val tokenSymbol: String,
    public val spender: String,
    public val allowance: String,
    public val risk: RiskLevel,
)

/**
 * List of outstanding ERC-20 allowances with revoke actions.
 *
 * The risk classification is surfaced by the policy engine — approvals
 * for unknown contracts default to High; well-known DEX routers default
 * to Low.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun TokenApprovalsScreen(
    approvals: List<TokenApprovalUi>,
    onBack: () -> Unit,
    onRevoke: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.token_approvals_title),
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
            if (approvals.isEmpty()) {
                EmptyState(
                    icon = IconTokens.Security,
                    title = stringResource(R.string.token_approvals_empty),
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(approvals, key = { it.id }) { approval ->
                        GlassCard(modifier = Modifier.fillMaxWidth()) {
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = "${approval.tokenSymbol} → ${approval.spender}",
                                            style = MaterialTheme.typography.titleMedium,
                                        )
                                        Text(
                                            text = approval.allowance,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    RiskIndicator(level = approval.risk)
                                }
                                Spacer(Modifier.height(8.dp))
                                OutlinedButton(onClick = { onRevoke(approval.id) }) {
                                    Text(stringResource(R.string.token_approvals_revoke))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
