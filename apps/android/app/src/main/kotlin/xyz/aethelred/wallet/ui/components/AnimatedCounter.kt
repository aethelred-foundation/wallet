package xyz.aethelred.wallet.ui.components

import androidx.compose.animation.core.Animatable
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import xyz.aethelred.wallet.ui.theme.LocalAethelredMotion
import kotlin.math.roundToLong

/**
 * Count-up / count-down Text that animates from the currently-rendered
 * value to [target]. Useful for the portfolio hero, staking rewards tile,
 * and "N pending approvals" badges.
 *
 * Uses [Animatable] with the brand's medium-bouncy spring so the number
 * settles with a subtle wobble — enough to delight, not enough to
 * distract.
 *
 * @param target Target integer value.
 * @param style Material text style.
 * @param formatter Optional formatter (e.g. comma grouping, currency prefix).
 * @param modifier Compose modifier.
 */
@Composable
public fun AnimatedCounter(
    target: Long,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.titleLarge,
    formatter: (Long) -> String = { it.toString() },
) {
    val motion = LocalAethelredMotion.current
    val animatable = remember { Animatable(target.toFloat()) }

    LaunchedEffect(target) {
        animatable.animateTo(
            targetValue = target.toFloat(),
            animationSpec = motion.springMedium,
        )
    }

    Text(
        text = formatter(animatable.value.roundToLong()),
        style = style,
        modifier = modifier,
    )
}
