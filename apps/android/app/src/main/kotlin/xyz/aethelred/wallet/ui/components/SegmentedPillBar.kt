package xyz.aethelred.wallet.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.LocalAethelredMotion
import xyz.aethelred.wallet.ui.theme.LocalAethelredRadii
import xyz.aethelred.wallet.ui.theme.LocalAethelredSpacing
import xyz.aethelred.wallet.ui.theme.rememberHaptics

/**
 * Horizontally-laid out pill segmented control with an animated active
 * background.
 *
 * Under the hood: a `Row` with a draw-underlay of the active pill slid to
 * the selected segment's anchor. The indicator animates via
 * [animateFloatAsState] using the brand's "short" motion duration.
 *
 * @param options Segment labels (user-visible, localised).
 * @param selectedIndex Zero-based index of the active segment.
 * @param onSelect Invoked with the tapped segment's index.
 * @param modifier Compose modifier.
 */
@Composable
public fun SegmentedPillBar(
    options: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val radii = LocalAethelredRadii.current
    val motion = LocalAethelredMotion.current
    val spacing = LocalAethelredSpacing.current
    val haptics = rememberHaptics()
    var totalWidthPx by remember { mutableStateOf(0) }
    val density = LocalDensity.current

    val segmentCount = options.size.coerceAtLeast(1)
    val segmentWidthPx = totalWidthPx.toFloat() / segmentCount
    val anchorXPx by animateFloatAsState(
        targetValue = selectedIndex * segmentWidthPx,
        animationSpec = tween(durationMillis = motion.shortDurationMs, easing = motion.standard),
        label = "segment-anchor",
    )
    val segmentWidthDp = with(density) { segmentWidthPx.toDp() }
    val anchorXDp = with(density) { anchorXPx.toDp() }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(44.dp)
            .clip(radii.pill)
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .onSizeChanged { size: IntSize -> totalWidthPx = size.width },
    ) {
        if (totalWidthPx > 0) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .padding(4.dp)
                    .width(segmentWidthDp)
                    .offset(x = anchorXDp)
                    .clip(radii.pill)
                    .background(MaterialTheme.colorScheme.primary),
            )
        }

        Row(modifier = Modifier.fillMaxWidth()) {
            options.forEachIndexed { index, label ->
                val selected = index == selectedIndex
                val labelColor by animateColorAsState(
                    targetValue = if (selected) {
                        MaterialTheme.colorScheme.onPrimary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    animationSpec = tween(motion.shortDurationMs),
                    label = "segment-label-color",
                )
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clickable {
                            haptics.segmentedChange()
                            onSelect(index)
                        }
                        .padding(horizontal = spacing.xs)
                        .semantics { this.selected = selected },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = label,
                        style = MaterialTheme.typography.labelLarge,
                        color = labelColor,
                    )
                }
            }
        }
    }
}
