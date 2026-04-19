package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.components.SegmentedPillBar

/** Display row for a feature flag. */
public data class FeatureFlagUi(
    public val key: String,
    public val label: String,
    public val enabled: Boolean,
)

/** Display row for a recent crash. */
public data class CrashUi(
    public val when_: String,
    public val message: String,
)

/**
 * Developer tools — active network switcher, feature flags, and a recent
 * crash log. Debug-only by convention; release builds hide this screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun DeveloperToolsScreen(
    networkOptions: List<String>,
    selectedNetworkIndex: Int,
    onSelectNetwork: (Int) -> Unit,
    featureFlags: List<FeatureFlagUi>,
    onToggleFlag: (String, Boolean) -> Unit,
    recentCrashes: List<CrashUi>,
    onClearCache: () -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.developer_tools_title),
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
                text = stringResource(R.string.developer_tools_network_switcher),
                style = MaterialTheme.typography.titleMedium,
            )
            SegmentedPillBar(
                options = networkOptions,
                selectedIndex = selectedNetworkIndex,
                onSelect = onSelectNetwork,
            )

            Text(
                text = stringResource(R.string.developer_tools_feature_flags),
                style = MaterialTheme.typography.titleMedium,
            )
            featureFlags.forEach { flag ->
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(flag.label, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                text = flag.key,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Switch(
                            checked = flag.enabled,
                            onCheckedChange = { onToggleFlag(flag.key, it) },
                        )
                    }
                }
            }

            Text(
                text = stringResource(R.string.developer_tools_crashes),
                style = MaterialTheme.typography.titleMedium,
            )
            recentCrashes.forEach { crash ->
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Column {
                        Text(crash.when_, style = MaterialTheme.typography.labelSmall)
                        Text(crash.message, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            OutlinedButton(onClick = onClearCache, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.developer_tools_clear_cache))
            }
        }
    }
}
