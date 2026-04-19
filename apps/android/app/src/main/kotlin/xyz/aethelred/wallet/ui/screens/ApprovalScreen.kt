package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.components.RiskBadge
import xyz.aethelred.wallet.viewmodel.ApprovalViewModel

/**
 * Policy-gated signing approval UI. The user sees:
 *
 *  1. Who is requesting the signature (originator + intent).
 *  2. The policy engine's verdict + risk badge.
 *  3. Approve / reject CTAs that flow through [ApprovalViewModel].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun ApprovalScreen(
    onDecide: () -> Unit,
    viewModel: ApprovalViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(R.string.approval_title)) }) },
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
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = stringResource(R.string.approval_originator),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f),
                        )
                        RiskBadge(level = state.riskLevel)
                    }
                    Text(state.originator, style = MaterialTheme.typography.titleMedium)
                }
            }

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        text = stringResource(R.string.approval_intent),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(state.intentSummary, style = MaterialTheme.typography.bodyMedium)
                }
            }

            GlassCard(modifier = Modifier.fillMaxWidth()) {
                Column {
                    Text(
                        text = stringResource(R.string.approval_policy_eval),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = if (state.policyAllowed) {
                            stringResource(R.string.approval_policy_allowed)
                        } else {
                            stringResource(R.string.approval_policy_denied)
                        },
                        style = MaterialTheme.typography.titleMedium,
                        color = if (state.policyAllowed) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.error
                        },
                    )
                    state.policyReasons.forEach { reason ->
                        Text(
                            text = "• $reason",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(
                    onClick = {
                        viewModel.reject()
                        onDecide()
                    },
                    modifier = Modifier.weight(1f),
                ) {
                    Text(stringResource(R.string.approval_reject))
                }
                Button(
                    onClick = {
                        viewModel.approve()
                        onDecide()
                    },
                    enabled = state.policyAllowed,
                    modifier = Modifier.weight(1f),
                ) {
                    Text(stringResource(R.string.approval_approve))
                }
            }
        }
    }
}
