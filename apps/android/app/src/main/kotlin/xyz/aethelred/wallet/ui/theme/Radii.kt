package xyz.aethelred.wallet.ui.theme

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.CornerBasedShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.dp

/**
 * Extended corner radius catalogue.
 *
 * Expands [AethelredShapes] with the full token set the design team uses
 * in Figma. The original [AethelredShapes] keeps the Material3
 * slot-targeted aliases; this catalogue exposes semantic sizes so screens
 * can request "pill" or "xxl" without caring what the Material slot is.
 */
public data class AethelredRadii(
    /** 4dp — hairline rounded corner, e.g. progress track. */
    public val xs: CornerBasedShape = RoundedCornerShape(4.dp),
    /** 8dp — chips, inline badges. */
    public val sm: CornerBasedShape = RoundedCornerShape(8.dp),
    /** 12dp — buttons. */
    public val md: CornerBasedShape = RoundedCornerShape(12.dp),
    /** 16dp — card default. */
    public val lg: CornerBasedShape = RoundedCornerShape(16.dp),
    /** 20dp — modal sheets, big tiles. */
    public val xl: CornerBasedShape = RoundedCornerShape(20.dp),
    /** 24dp — hero cards on onboarding. */
    public val xxl: CornerBasedShape = RoundedCornerShape(24.dp),
    /** Fully rounded "pill" shape for segmented controls and status dots. */
    public val pill: CornerBasedShape = CircleShape,
)

/** Composition local exposing the radius catalogue. */
public val LocalAethelredRadii: ProvidableCompositionLocal<AethelredRadii> =
    staticCompositionLocalOf { AethelredRadii() }
