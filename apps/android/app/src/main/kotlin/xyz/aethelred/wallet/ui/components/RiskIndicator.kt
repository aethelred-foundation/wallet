package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.theme.LocalAethelredColors

/**
 * Traffic-light style risk indicator. Distinct from [RiskBadge] in that
 * this component shows a coloured dot + long-form label (e.g. on the
 * token-approvals list where a user is scanning quickly and needs
 * "is it red/yellow/green" at a glance).
 *
 * @param level Discriminator — reuses [RiskLevel] so callers don't have
 *              to convert between enums.
 * @param modifier Compose modifier.
 */
@Composable
public fun RiskIndicator(
    level: RiskLevel,
    modifier: Modifier = Modifier,
) {
    val extras = LocalAethelredColors.current
    val (label, color) = when (level) {
        RiskLevel.Low -> stringResource(R.string.risk_low) to extras.success
        RiskLevel.Medium -> stringResource(R.string.risk_medium) to extras.warning
        RiskLevel.High -> stringResource(R.string.risk_high) to extras.danger
    }
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.foundation.layout.Box(
            modifier = Modifier
                .size(10.dp)
                .background(color, CircleShape),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        // Spacer to separate from any trailing content the caller appends.
        Spacer(Modifier.height(2.dp))
    }
}
