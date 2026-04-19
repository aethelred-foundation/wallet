package xyz.aethelred.wallet.ui.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import xyz.aethelred.wallet.ui.theme.rememberHaptics

/**
 * Button wrapper that:
 *  * Scales down slightly on press for tactile feedback.
 *  * Emits [xyz.aethelred.wallet.ui.theme.AethelredHaptics.press] on tap.
 *
 * Used wherever the visual brand needs to feel premium (primary CTA,
 * home quick actions, confirmation sheet accept button).
 *
 * @param onClick Tap handler (haptic fires before invocation).
 * @param modifier Compose modifier.
 * @param enabled Controls button-enabled state.
 * @param content Material `RowScope` slot for leading icon + label.
 */
@Composable
public fun HapticPressButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    val haptics = rememberHaptics()
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.97f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessHigh,
        ),
        label = "haptic-button-scale",
    )

    Button(
        onClick = {
            haptics.press()
            onClick()
        },
        enabled = enabled,
        interactionSource = interactionSource,
        modifier = modifier.scale(scale),
        colors = ButtonDefaults.buttonColors(),
        content = content,
    )
}
