package xyz.aethelred.wallet.ui.theme

import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Named elevation ramp.
 *
 * The wallet treats elevation as a single dimension (tonal + shadow stay
 * in lockstep) so a designer's "raise this card one level" note maps to
 * a single token. Five levels cover all known surfaces; if a sixth is
 * ever needed the design system has spun out of control.
 */
public data class AethelredElevation(
    /** 0dp — flat, background-tone surface. */
    public val level0: Dp = 0.dp,
    /** 1dp — default card. */
    public val level1: Dp = 1.dp,
    /** 2dp — raised card (Home portfolio tile, Approval hero). */
    public val level2: Dp = 2.dp,
    /** 4dp — popovers, bottom sheets. */
    public val level3: Dp = 4.dp,
    /** 8dp — floating action button, critical alerts. */
    public val level4: Dp = 8.dp,
    /** 16dp — reserved for dialogs. */
    public val level5: Dp = 16.dp,
)

/** Composition local exposing the elevation ramp. */
public val LocalAethelredElevation: ProvidableCompositionLocal<AethelredElevation> =
    staticCompositionLocalOf { AethelredElevation() }
