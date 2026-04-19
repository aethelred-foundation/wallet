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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.EmptyState
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.components.SegmentedPillBar
import xyz.aethelred.wallet.ui.theme.IconTokens

/** Display-only passkey row. */
public data class PasskeyUi(
    public val id: String,
    public val label: String,
    public val transport: String,
    public val enrolledAt: String,
)

/** Display-only session row. */
public data class SecuritySessionUi(
    public val id: String,
    public val label: String,
    public val origin: String,
)

/**
 * Security hub screen.
 *
 * Grouped into three sections:
 *  * Passkeys — platform authenticators enrolled against this wallet.
 *  * Sessions — active WalletConnect + delegation sessions.
 *  * Auto-lock — idle timeout picker.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun SecurityScreen(
    passkeys: List<PasskeyUi>,
    sessions: List<SecuritySessionUi>,
    onBack: () -> Unit,
    onEnrollPasskey: () -> Unit,
    onRevokeSession: (String) -> Unit,
    onAutoLockSelected: (Int) -> Unit,
) {
    var autoLockIndex by remember { mutableIntStateOf(1) }
    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.security_title),
                onBack = onBack,
            )
        },
    ) { inner ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text(
                    text = stringResource(R.string.security_passkeys),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            if (passkeys.isEmpty()) {
                item {
                    EmptyState(
                        icon = IconTokens.Key,
                        title = stringResource(R.string.security_enroll_passkey),
                    )
                }
            } else {
                items(passkeys, key = { it.id }) { passkey ->
                    GlassCard(modifier = Modifier.fillMaxWidth()) {
                        Column {
                            Text(passkey.label, style = MaterialTheme.typography.titleMedium)
                            Text(
                                text = "${passkey.transport} • ${passkey.enrolledAt}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            item {
                Button(
                    onClick = onEnrollPasskey,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.security_enroll_passkey))
                }
            }

            item {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.security_sessions),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
            items(sessions, key = { it.id }) { session ->
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(session.label, style = MaterialTheme.typography.titleMedium)
                            Text(
                                text = session.origin,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        OutlinedButton(onClick = { onRevokeSession(session.id) }) {
                            Text(stringResource(R.string.security_revoke_session))
                        }
                    }
                }
            }

            item {
                Spacer(Modifier.height(8.dp))
                Text(
                    text = stringResource(R.string.security_auto_lock),
                    style = MaterialTheme.typography.titleMedium,
                )
                val options = listOf(
                    stringResource(R.string.security_auto_lock_never),
                    stringResource(R.string.security_auto_lock_30s),
                    stringResource(R.string.security_auto_lock_1m),
                    stringResource(R.string.security_auto_lock_5m),
                )
                SegmentedPillBar(
                    options = options,
                    selectedIndex = autoLockIndex,
                    onSelect = {
                        autoLockIndex = it
                        onAutoLockSelected(it)
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
