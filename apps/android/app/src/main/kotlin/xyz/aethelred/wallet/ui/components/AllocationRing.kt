package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Single slice in a donut-chart allocation ring.
 *
 * @param label Human-readable category label (for accessibility / tooltip).
 * @param fraction 0..1 fraction of total.
 * @param color Fill color for this slice.
 */
public data class AllocationSlice(
    public val label: String,
    public val fraction: Float,
    public val color: Color,
)

/**
 * Donut-chart allocation ring.
 *
 * Drawn purely via Canvas [DrawScope] arcs. Each slice consumes a
 * proportional arc of the full circumference. Fractions should sum to
 * approximately 1.0 — excess is clamped at the last slice.
 *
 * Intended for the PortfolioScreen hero card. Keep slice counts small (≤ 6)
 * or the donut's labels will become unreadable.
 *
 * @param slices Ordered list of slices. Order is rendered clockwise
 *               starting at 12 o'clock.
 * @param diameter Outer diameter.
 * @param strokeWidth Ring thickness.
 * @param centerLabel Optional short label rendered dead-center.
 */
@Composable
public fun AllocationRing(
    slices: List<AllocationSlice>,
    modifier: Modifier = Modifier,
    diameter: Dp = 160.dp,
    strokeWidth: Dp = 20.dp,
    centerLabel: String? = null,
) {
    val total = slices.sumOf { it.fraction.toDouble() }.toFloat().coerceAtLeast(0.0001f)
    val accessibleLabel = slices.joinToString(", ") { "${it.label} ${(it.fraction * 100).toInt()}%" }

    Box(
        modifier = modifier
            .size(diameter)
            .semantics { contentDescription = accessibleLabel },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.size(diameter)) {
            val diameterPx = size.minDimension
            val stroke = Stroke(width = strokeWidth.toPx())
            val inset = stroke.width / 2f
            val ringSize = Size(diameterPx - stroke.width, diameterPx - stroke.width)
            val topLeft = androidx.compose.ui.geometry.Offset(inset, inset)

            var startAngle = -90f
            slices.forEach { slice ->
                val sweep = (slice.fraction / total) * 360f
                drawArc(
                    color = slice.color,
                    startAngle = startAngle,
                    sweepAngle = sweep,
                    useCenter = false,
                    topLeft = topLeft,
                    size = ringSize,
                    style = stroke,
                )
                startAngle += sweep
            }
        }
        centerLabel?.let {
            Text(it, style = MaterialTheme.typography.titleMedium)
        }
    }
}
