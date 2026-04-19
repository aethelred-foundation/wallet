package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.LocalAethelredColors

/**
 * Minimal Canvas-based sparkline.
 *
 * Renders a smooth polyline over the supplied [values]. The chart computes
 * its own min/max so callers can feed raw price samples directly; override
 * [lineColor] when embedding inside cards that need a custom tone.
 *
 * Pure Canvas — no external charting library — so ProGuard keep-rules and
 * APK size stay tight.
 *
 * @param values Sample points in time order.
 * @param modifier Compose modifier.
 * @param lineColor Stroke color. Defaults to the brand "success" tone if
 *                  the last sample is above the first, "danger" otherwise.
 * @param strokeWidth Stroke thickness.
 */
@Composable
public fun SparklineChart(
    values: List<Double>,
    modifier: Modifier = Modifier,
    lineColor: Color? = null,
    strokeWidth: Dp = 2.dp,
) {
    if (values.size < MIN_POINTS) {
        // Nothing to render — draw a flat placeholder so layout doesn't jump.
        Canvas(modifier = modifier) { /* empty canvas keeps the slot. */ }
        return
    }

    val extras = LocalAethelredColors.current
    val resolved = lineColor ?: run {
        if (values.last() >= values.first()) extras.success else extras.danger
    }

    val min = values.min()
    val max = values.max()
    val range = (max - min).takeIf { it > 0 } ?: 1.0

    Canvas(modifier = modifier) {
        val widthPx = size.width
        val heightPx = size.height
        val step = widthPx / (values.size - 1).coerceAtLeast(1)
        val stroke = Stroke(width = strokeWidth.toPx(), cap = StrokeCap.Round)

        val path = Path().apply {
            values.forEachIndexed { index, value ->
                val x = index * step
                val normalized = ((value - min) / range).toFloat().coerceIn(0f, 1f)
                val y = heightPx - (normalized * heightPx)
                if (index == 0) moveTo(x, y) else lineTo(x, y)
            }
        }
        drawPath(path = path, color = resolved, style = stroke)

        // Soft accent at the last point.
        val lastX = (values.size - 1) * step
        val lastValue = values.last()
        val lastNorm = ((lastValue - min) / range).toFloat().coerceIn(0f, 1f)
        val lastY = heightPx - (lastNorm * heightPx)
        drawCircle(
            color = resolved,
            radius = strokeWidth.toPx() * 1.5f,
            center = Offset(lastX, lastY),
        )
    }
}

private const val MIN_POINTS = 2
