package xyz.aethelred.wallet.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.spring
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Motion token catalogue.
 *
 * Every animation in the app must resolve its timing + easing from here
 * so we never hand-pick `tween(250)` at the call site. The durations map
 * 1:1 onto the iOS team's Motion tokens so a user feels the same
 * "responsiveness fingerprint" regardless of platform.
 */
public data class AethelredMotion(
    /** 75ms — toggles, ripple reactions. */
    public val microDurationMs: Int = 75,
    /** 150ms — segmented pill slide. */
    public val shortDurationMs: Int = 150,
    /** 250ms — card expand, sheet fade. */
    public val mediumDurationMs: Int = 250,
    /** 400ms — page transitions. */
    public val longDurationMs: Int = 400,
    /** 600ms — onboarding celebration flourishes. */
    public val heroDurationMs: Int = 600,

    /** Material3 standard ease — asymmetric acceleration. */
    public val standard: Easing = FastOutSlowInEasing,
    /** Gentle decelerate; use for on-screen reveals. */
    public val decelerate: Easing = LinearOutSlowInEasing,
    /** Custom emphasized easing for celebratory flourishes. */
    public val emphasized: Easing = CubicBezierEasing(0.2f, 0.0f, 0.0f, 1.0f),

    /** Spring config for bouncy counter animations. */
    public val springMedium: SpringSpec<Float> = spring(
        dampingRatio = Spring.DampingRatioMediumBouncy,
        stiffness = Spring.StiffnessMediumLow,
    ),
    /** Stiffer spring for tactile feedback (buttons). */
    public val springStiff: SpringSpec<Float> = spring(
        dampingRatio = Spring.DampingRatioNoBouncy,
        stiffness = Spring.StiffnessHigh,
    ),
)

/** Composition local exposing the motion catalogue. */
public val LocalAethelredMotion: ProvidableCompositionLocal<AethelredMotion> =
    staticCompositionLocalOf { AethelredMotion() }
