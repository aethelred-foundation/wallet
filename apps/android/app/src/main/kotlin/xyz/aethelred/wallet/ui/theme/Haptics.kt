package xyz.aethelred.wallet.ui.theme

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalView

/**
 * Semantic haptic vocabulary for the wallet.
 *
 * Each call maps to the most appropriate platform haptic. API level 30+
 * exposes the rich feedback constants (CONFIRM, REJECT, GESTURE_START);
 * older devices fall back to legacy VIRTUAL_KEY / LONG_PRESS so the UX
 * still "clicks" without the fidelity.
 */
public interface AethelredHaptics {
    /** Light tap — segmented control change, toggle flip. */
    public fun segmentedChange()

    /** Positive confirmation — send submitted, approval accepted. */
    public fun success()

    /** Negative — validation error, approval rejected. */
    public fun error()

    /** Long-press selection confirmation. */
    public fun longPress()

    /** Single soft press — generic button interaction. */
    public fun press()
}

/**
 * Default haptics impl that reads from the current [View] via Compose.
 *
 * Requires a parent composable to supply [LocalView]; the wallet already
 * enforces this since MainActivity sets content via Compose.
 */
public class ViewBackedHaptics(private val view: View) : AethelredHaptics {
    override fun segmentedChange() {
        perform(HapticFeedbackConstants.CLOCK_TICK)
    }

    override fun success() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            perform(HapticFeedbackConstants.CONFIRM)
        } else {
            perform(HapticFeedbackConstants.VIRTUAL_KEY)
        }
    }

    override fun error() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            perform(HapticFeedbackConstants.REJECT)
        } else {
            perform(HapticFeedbackConstants.LONG_PRESS)
        }
    }

    override fun longPress() {
        perform(HapticFeedbackConstants.LONG_PRESS)
    }

    override fun press() {
        perform(HapticFeedbackConstants.VIRTUAL_KEY)
    }

    private fun perform(constant: Int) {
        view.performHapticFeedback(constant)
    }
}

/** No-op haptics — used in previews and tests. */
public object NoopHaptics : AethelredHaptics {
    override fun segmentedChange() {
        // Intentional no-op; tests assert instrumentation differently.
    }

    override fun success() {
        // No-op.
    }

    override fun error() {
        // No-op.
    }

    override fun longPress() {
        // No-op.
    }

    override fun press() {
        // No-op.
    }
}

/** Composition local exposing a [AethelredHaptics]. */
public val LocalAethelredHaptics: ProvidableCompositionLocal<AethelredHaptics> =
    staticCompositionLocalOf { NoopHaptics }

/**
 * Derive an [AethelredHaptics] bound to the current Compose view. Must be
 * called inside a Composable.
 */
@Composable
public fun rememberHaptics(): AethelredHaptics {
    val view = LocalView.current
    return ViewBackedHaptics(view)
}
