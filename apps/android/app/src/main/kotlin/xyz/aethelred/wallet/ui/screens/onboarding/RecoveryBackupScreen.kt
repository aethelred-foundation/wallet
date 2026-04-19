package xyz.aethelred.wallet.ui.screens.onboarding

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.theme.IconTokens

/**
 * Standalone recovery-phrase reveal screen reached from Settings.
 *
 * Implements a 10-second tap-to-reveal window + per-session cooldown so
 * a shoulder-surfer can't repeatedly trigger the reveal.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun RecoveryBackupScreen(
    onBack: () -> Unit,
    onVerified: () -> Unit,
) {
    var revealed by remember { mutableStateOf(false) }
    var cooldownSeconds by remember { mutableIntStateOf(0) }

    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.onboarding_recovery_backup_title),
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
            Text(
                text = stringResource(R.string.onboarding_recovery_backup_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            GlassCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
                    .clickable(enabled = cooldownSeconds == 0) { revealed = true },
            ) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    if (revealed) {
                        Text(
                            text = "abandon ability able about above absent absorb abstract absurd abuse access accident",
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        LaunchedEffect(revealed) {
                            delay(REVEAL_MS)
                            revealed = false
                            cooldownSeconds = COOLDOWN_S
                            while (cooldownSeconds > 0) {
                                delay(1_000)
                                cooldownSeconds -= 1
                            }
                        }
                    } else {
                        Icon(
                            imageVector = IconTokens.Visibility,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(36.dp),
                        )
                        Spacer(Modifier.height(12.dp))
                        if (cooldownSeconds > 0) {
                            Text(
                                text = stringResource(
                                    R.string.onboarding_recovery_cooldown,
                                    cooldownSeconds,
                                ),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        } else {
                            Text(stringResource(R.string.onboarding_seed_reveal))
                        }
                    }
                }
            }
            Button(onClick = onVerified, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.approval_approve))
            }
        }
    }
}

private const val REVEAL_MS: Long = 10_000
private const val COOLDOWN_S: Int = 30
