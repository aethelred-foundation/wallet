package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.IconTokens
import xyz.aethelred.wallet.ui.theme.LocalAethelredColors
import xyz.aethelred.wallet.ui.theme.LocalAethelredRadii

/** Severity discriminator for [InlineAlert]. */
public enum class AlertSeverity { Info, Success, Warning, Danger }

/**
 * In-flow alert banner.
 *
 * Used across the app for:
 *  * "Device does not meet security baseline" warnings.
 *  * "Approval queued" success banners.
 *  * Chain mismatch / insufficient balance danger banners.
 *
 * @param severity Visual tone.
 * @param title Primary line (bold).
 * @param description Secondary line (optional).
 * @param modifier Compose modifier.
 */
@Composable
public fun InlineAlert(
    severity: AlertSeverity,
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
) {
    val extras = LocalAethelredColors.current
    val radii = LocalAethelredRadii.current
    val (fg, bg, icon) = when (severity) {
        AlertSeverity.Info -> Triple<Color, Color, ImageVector>(
            MaterialTheme.colorScheme.primary,
            MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
            IconTokens.Info,
        )
        AlertSeverity.Success -> Triple<Color, Color, ImageVector>(
            extras.success,
            extras.success.copy(alpha = 0.15f),
            IconTokens.Success,
        )
        AlertSeverity.Warning -> Triple<Color, Color, ImageVector>(
            extras.warning,
            extras.warning.copy(alpha = 0.15f),
            IconTokens.Warning,
        )
        AlertSeverity.Danger -> Triple<Color, Color, ImageVector>(
            extras.danger,
            extras.danger.copy(alpha = 0.15f),
            IconTokens.Danger,
        )
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(bg, radii.md)
            .border(1.dp, fg.copy(alpha = 0.3f), radii.md)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = fg,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = fg,
            )
            description?.let {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}
