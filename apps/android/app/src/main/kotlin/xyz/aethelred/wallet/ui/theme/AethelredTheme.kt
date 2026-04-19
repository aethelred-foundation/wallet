package xyz.aethelred.wallet.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Custom extension tokens that aren't expressible via the Material3
 * [androidx.compose.material3.ColorScheme]. Surfaced via
 * [LocalAethelredColors] so any Composable can opt in.
 */
public data class AethelredExtendedColors(
    public val success: androidx.compose.ui.graphics.Color,
    public val warning: androidx.compose.ui.graphics.Color,
    public val danger: androidx.compose.ui.graphics.Color,
    public val inkSoft: androidx.compose.ui.graphics.Color,
)

/** Composition local exposing the wallet's extension palette. */
public val LocalAethelredColors: androidx.compose.runtime.ProvidableCompositionLocal<AethelredExtendedColors> =
    staticCompositionLocalOf {
        // Sensible dark default — callers should always be inside
        // AethelredTheme, so this sentinel is really just for previews.
        AethelredExtendedColors(
            success = AethelredColors.DarkSuccess,
            warning = AethelredColors.DarkWarning,
            danger = AethelredColors.DarkDanger,
            inkSoft = AethelredColors.DarkInkSoft,
        )
    }

private val DarkScheme = darkColorScheme(
    primary = AethelredColors.DarkAccent,
    onPrimary = AethelredColors.DarkInk,
    secondary = AethelredColors.DarkInk,
    onSecondary = AethelredColors.DarkBackground,
    background = AethelredColors.DarkBackground,
    onBackground = AethelredColors.DarkInk,
    surface = AethelredColors.DarkSurface,
    onSurface = AethelredColors.DarkInk,
    surfaceVariant = AethelredColors.DarkSurfaceVariant,
    onSurfaceVariant = AethelredColors.DarkInkSoft,
    outline = AethelredColors.DarkOutline,
    error = AethelredColors.DarkDanger,
)

private val LightScheme = lightColorScheme(
    primary = AethelredColors.LightAccent,
    onPrimary = AethelredColors.LightBackground,
    secondary = AethelredColors.LightInk,
    onSecondary = AethelredColors.LightBackground,
    background = AethelredColors.LightBackground,
    onBackground = AethelredColors.LightInk,
    surface = AethelredColors.LightSurface,
    onSurface = AethelredColors.LightInk,
    surfaceVariant = AethelredColors.LightSurfaceVariant,
    onSurfaceVariant = AethelredColors.LightInkSoft,
    outline = AethelredColors.LightOutline,
    error = AethelredColors.LightDanger,
)

/**
 * Root Compose theme. Wrap every Composable tree in this — including
 * previews — so Material3 defaults pick up brand tokens and the extension
 * palette is available.
 *
 * Dynamic color is deliberately off: the wallet's brand red is a safety
 * cue that must not be repainted by Material You.
 */
@Composable
public fun AethelredTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val scheme = if (darkTheme) DarkScheme else LightScheme
    val extras = if (darkTheme) {
        AethelredExtendedColors(
            success = AethelredColors.DarkSuccess,
            warning = AethelredColors.DarkWarning,
            danger = AethelredColors.DarkDanger,
            inkSoft = AethelredColors.DarkInkSoft,
        )
    } else {
        AethelredExtendedColors(
            success = AethelredColors.LightSuccess,
            warning = AethelredColors.LightWarning,
            danger = AethelredColors.LightDanger,
            inkSoft = AethelredColors.LightInkSoft,
        )
    }

    CompositionLocalProvider(LocalAethelredColors provides extras) {
        MaterialTheme(
            colorScheme = scheme,
            typography = AethelredTypography.Material,
            shapes = AethelredShapes.Material,
            content = content,
        )
    }
}
