package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.AethelredShapes

/**
 * Translucent-feel card surface used throughout the wallet.
 *
 * The wallet deliberately uses a plain Material3 surface under the hood
 * (no noisy gradients, no heavy shadows) to keep the policy / approval
 * screens legal-pad calm. The *appearance* of glass comes from the
 * [MaterialTheme.colorScheme.surface] tone painted over the dark canvas.
 *
 * @param modifier Compose modifier.
 * @param padding Inner padding applied to children.
 * @param background Surface tint. Defaults to the theme's `surface`.
 * @param border Optional stroke. Defaults to a thin outline so the card
 *               reads against the dark background.
 * @param elevation Tonal elevation; `0.dp` by default. Raise to separate
 *                  important tiles (e.g. the Home portfolio card).
 */
@Composable
public fun GlassCard(
    modifier: Modifier = Modifier,
    padding: PaddingValues = PaddingValues(16.dp),
    background: Color = MaterialTheme.colorScheme.surface,
    border: BorderStroke? = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    elevation: Dp = 0.dp,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = modifier,
        color = background,
        shape = AethelredShapes.Card,
        border = border,
        tonalElevation = elevation,
        shadowElevation = elevation,
    ) {
        androidx.compose.foundation.layout.Box(modifier = Modifier.padding(padding)) {
            content()
        }
    }
}
