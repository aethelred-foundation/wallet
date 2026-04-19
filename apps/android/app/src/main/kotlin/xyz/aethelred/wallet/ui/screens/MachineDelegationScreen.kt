package xyz.aethelred.wallet.ui.screens

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
import xyz.aethelred.wallet.ui.components.StatusBadge
import xyz.aethelred.wallet.ui.components.StatusKind
import xyz.aethelred.wallet.ui.theme.IconTokens

/** Display row for an agent delegation session. */
public data class MachineDelegationUi(
    public val id: String,
    public val agentName: String,
    public val scope: String,
    public val attestationSummary: String,
    public val status: StatusKind,
    public val expiresOn: String,
)

/**
 * Agent / delegation sessions list.
 *
 * Each row shows the agent, scope, attestation (PKI chain), and status;
 * users can revoke a session to immediately cut the delegation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun MachineDelegationScreen(
    sessions: List<MachineDelegationUi>,
    onBack: () -> Unit,
    onRevoke: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.machine_delegation_title),
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
            if (sessions.isEmpty()) {
                EmptyState(
                    icon = IconTokens.Radar,
                    title = stringResource(R.string.machine_delegation_empty_title),
                    description = stringResource(R.string.machine_delegation_empty_description),
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(sessions, key = { it.id }) { session ->
                        GlassCard(modifier = Modifier.fillMaxWidth()) {
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(session.agentName, style = MaterialTheme.typography.titleMedium)
                                        Text(
                                            text = session.scope,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    StatusBadge(status = session.status)
                                }
                                Text(
                                    text = stringResource(R.string.machine_delegation_attestation) +
                                        ": " + session.attestationSummary,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    text = session.expiresOn,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                OutlinedButton(
                                    onClick = { onRevoke(session.id) },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(stringResource(R.string.machine_delegation_revoke))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
