package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.EmptyState
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.components.RiskIndicator
import xyz.aethelred.wallet.ui.components.RiskLevel
import xyz.aethelred.wallet.ui.theme.IconTokens

/** Display model for each row in the list. */
public data class PendingApprovalUi(
    public val id: String,
    public val originator: String,
    public val summary: String,
    public val quorumApproved: Int,
    public val quorumRequired: Int,
    public val riskLevel: RiskLevel,
)

/**
 * List of in-flight approvals. Each row shows the originator, intent
 * summary, quorum progress, and the policy-derived risk level.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun ApprovalsListScreen(
    approvals: List<PendingApprovalUi>,
    onBack: () -> Unit,
    onApprovalClick: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.approvals_list_title),
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
                    icon = IconTokens.DoneAll,
                    title = stringResource(R.string.approvals_empty_title),
                    description = stringResource(R.string.approvals_empty_description),
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(approvals, key = { it.id }) { approval ->
                        GlassCard(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onApprovalClick(approval.id) },
                        ) {
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = approval.originator,
                                        style = MaterialTheme.typography.titleMedium,
                                        modifier = Modifier.weight(1f),
                                    )
                                    RiskIndicator(level = approval.riskLevel)
                                }
                                Text(
                                    text = approval.summary,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    text = stringResource(
                                        R.string.approvals_quorum_progress,
                                        approval.quorumApproved,
                                        approval.quorumRequired,
                                    ),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
