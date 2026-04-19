package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.theme.AethelredShapes
import xyz.aethelred.wallet.ui.theme.LocalAethelredColors

/**
 * Severity levels shown on the Approval screen so the user can grok the
 * policy engine's risk call without reading the long-form explanation.
 *
 * Kept enum-simple on purpose — the policy package can map its own
 * granular severities onto these three buckets before rendering.
 */
public enum class RiskLevel { Low, Medium, High }

/**
 * Compact pill rendering a [RiskLevel].
 *
 * @param level Risk severity to display.
 * @param modifier Compose modifier.
 */
@Composable
public fun RiskBadge(
    level: RiskLevel,
    modifier: Modifier = Modifier,
) {
    val extendedColors = LocalAethelredColors.current
    val (label, bg, fg) = when (level) {
        RiskLevel.Low -> Triple(
            stringResource(R.string.risk_low),
            extendedColors.success.copy(alpha = 0.15f),
            extendedColors.success,
        )
        RiskLevel.Medium -> Triple(
            stringResource(R.string.risk_medium),
            extendedColors.warning.copy(alpha = 0.18f),
            extendedColors.warning,
        )
        RiskLevel.High -> Triple(
            stringResource(R.string.risk_high),
            extendedColors.danger.copy(alpha = 0.18f),
            extendedColors.danger,
        )
    }

    Text(
        modifier = modifier
            .background(color = bg, shape = AethelredShapes.Chip)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        text = label,
        color = fg,
        style = MaterialTheme.typography.labelMedium,
    )
}

/**
 * Internal helper so `Triple` destructuring above stays type-safe even
 * when Kotlin's type inference can't otherwise resolve the Triple to a
 * `(String, Color, Color)`.
 */
@Suppress("unused")
private typealias BadgeTriple = Triple<String, Color, Color>
