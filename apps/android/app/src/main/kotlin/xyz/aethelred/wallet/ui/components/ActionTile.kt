package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.LocalAethelredRadii
import xyz.aethelred.wallet.ui.theme.rememberHaptics

/**
 * Rounded-square "Action Tile" used in quick-action grids (Payments,
 * Hub shortcut tray, Portfolio). Each tile gets an icon-in-gradient
 * circle plus a two-word label.
 *
 * Fires a [rememberHaptics.press] event so tactile feedback stays
 * consistent across the app.
 *
 * @param label Two-to-three word label (localised).
 * @param icon Vector icon rendered in the gradient circle.
 * @param gradient Brand gradient; usually one of [xyz.aethelred.wallet.ui.theme.BrandGradients].
 * @param onClick Invoked on tap.
 * @param modifier Compose modifier.
 * @param contentDescription Accessibility label. Defaults to [label].
 */
@Composable
public fun ActionTile(
    label: String,
    icon: ImageVector,
    gradient: Brush,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    contentDescription: String = label,
) {
    val radii = LocalAethelredRadii.current
    val haptics = rememberHaptics()

    Column(
        modifier = modifier
            .clip(radii.lg)
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant, radii.lg)
            .clickable {
                haptics.press()
                onClick()
            }
            .padding(vertical = 16.dp)
            .semantics {
                role = Role.Button
                this.contentDescription = contentDescription
            },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(44.dp)
                .clip(androidx.compose.foundation.shape.CircleShape)
                .background(gradient),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimary,
            )
        }
        Spacer(Modifier.height(8.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
        )
    }
}
