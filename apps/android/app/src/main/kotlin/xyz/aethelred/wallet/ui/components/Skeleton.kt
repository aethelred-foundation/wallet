package xyz.aethelred.wallet.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.LocalAethelredDarkTheme
import xyz.aethelred.wallet.ui.theme.LocalAethelredRadii

/**
 * Shimmer-loading skeleton primitive.
 *
 * Hand-rolled so we don't pull in the retired accompanist-placeholder
 * dependency. Uses [rememberInfiniteTransition] + a translating linear
 * gradient to simulate the "light bar" sweep common in fintech loading
 * states.
 *
 * Usage: place a series of `Skeleton(height = 16.dp)` / `Skeleton(width, height)`
 * inside an `EmptyState`-style column so the page has a believable
 * silhouette while data streams in.
 *
 * @param modifier Compose modifier — callers control width + shape.
 * @param height Default skeleton height.
 */
@Composable
public fun Skeleton(
    modifier: Modifier = Modifier,
    height: Dp = 16.dp,
) {
    val darkTheme = LocalAethelredDarkTheme.current
    val radii = LocalAethelredRadii.current

    val transition = rememberInfiniteTransition(label = "skeleton-shimmer")
    val translation by transition.animateFloat(
        initialValue = -300f,
        targetValue = 900f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1_500, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "skeleton-offset",
    )

    val base = if (darkTheme) Color(0xFF232326) else Color(0xFFEFEFF3)
    val shine = if (darkTheme) Color(0xFF303036) else Color(0xFFDCDCE5)
    val brush = Brush.linearGradient(
        colors = listOf(base, shine, base),
        start = androidx.compose.ui.geometry.Offset(translation, 0f),
        end = androidx.compose.ui.geometry.Offset(translation + 400f, 0f),
    )

    androidx.compose.foundation.layout.Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .clip(radii.sm)
            .background(brush = brush, shape = RoundedCornerShape(6.dp)),
    )
}

/**
 * Square skeleton variant for avatars / token logos.
 */
@Composable
public fun SkeletonCircle(
    size: Dp,
    modifier: Modifier = Modifier,
) {
    val darkTheme = LocalAethelredDarkTheme.current

    val transition = rememberInfiniteTransition(label = "skeleton-circle")
    val translation by transition.animateFloat(
        initialValue = -300f,
        targetValue = 900f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1_500, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "skeleton-circle-offset",
    )

    val base = if (darkTheme) Color(0xFF232326) else Color(0xFFEFEFF3)
    val shine = if (darkTheme) Color(0xFF303036) else Color(0xFFDCDCE5)

    androidx.compose.foundation.layout.Box(
        modifier = modifier
            .size(size)
            .clip(androidx.compose.foundation.shape.CircleShape)
            .background(
                Brush.linearGradient(
                    colors = listOf(base, shine, base),
                    start = androidx.compose.ui.geometry.Offset(translation, 0f),
                    end = androidx.compose.ui.geometry.Offset(translation + 400f, 0f),
                ),
            ),
    )
}
