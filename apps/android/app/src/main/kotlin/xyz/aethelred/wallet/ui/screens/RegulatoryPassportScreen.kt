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
import androidx.compose.material3.Button
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
import xyz.aethelred.wallet.ui.components.StatusBadge
import xyz.aethelred.wallet.ui.components.StatusKind
import xyz.aethelred.wallet.ui.theme.IconTokens

/** Display row for a verifiable credential. */
public data class CredentialUi(
    public val id: String,
    public val label: String,
    public val issuer: String,
    public val issuedOn: String,
    public val status: StatusKind,
)

/**
 * Regulatory passport hub — presents the holder's verifiable credentials
 * and lets them build a VP for an inbound presentation request.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun RegulatoryPassportScreen(
    credentials: List<CredentialUi>,
    requestReason: String?,
    onBack: () -> Unit,
    onPresent: (String) -> Unit,
) {
    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.regulatory_passport_title),
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
            requestReason?.let {
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = stringResource(R.string.regulatory_passport_request_reason, it),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }

            if (credentials.isEmpty()) {
                EmptyState(
                    icon = IconTokens.Identity,
                    title = stringResource(R.string.regulatory_passport_empty_title),
                    description = stringResource(R.string.regulatory_passport_empty_description),
                )
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(credentials, key = { it.id }) { credential ->
                        GlassCard(modifier = Modifier.fillMaxWidth()) {
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(credential.label, style = MaterialTheme.typography.titleMedium)
                                        Text(
                                            text = "${credential.issuer} • ${credential.issuedOn}",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    StatusBadge(status = credential.status)
                                }
                                Spacer(Modifier.height(8.dp))
                                Button(onClick = { onPresent(credential.id) }, modifier = Modifier.fillMaxWidth()) {
                                    Text(stringResource(R.string.regulatory_passport_present))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
