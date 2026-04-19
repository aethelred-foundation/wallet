package xyz.aethelred.wallet.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Raw Aethelred brand color tokens.
 *
 * These are the single source of truth for Compose — the equivalent XML
 * entries in `res/values/colors.xml` exist only so the Activity window
 * background can render before Compose takes over. Do not introduce new
 * `Color(0x…)` literals anywhere else in the module.
 */
public object AethelredColors {

    // --- Light ---
    public val LightBackground: Color = Color(0xFFFFFFFF)
    public val LightSurface: Color = Color(0xFFECECF0)
    public val LightSurfaceVariant: Color = Color(0xFFDCDCE5)
    public val LightInk: Color = Color(0xFF1C1C1E)
    public val LightInkSoft: Color = Color(0xFF5F5F66)
    public val LightAccent: Color = Color(0xFFC41E1E)
    public val LightSuccess: Color = Color(0xFF2EA144)
    public val LightWarning: Color = Color(0xFFFF9F0A)
    public val LightDanger: Color = Color(0xFFD92D20)
    public val LightOutline: Color = Color(0xFFC6C6CC)

    // --- Dark ---
    public val DarkBackground: Color = Color(0xFF121212)
    public val DarkSurface: Color = Color(0xFF1E1E20)
    public val DarkSurfaceVariant: Color = Color(0xFF2A2A2D)
    public val DarkInk: Color = Color(0xFFE5E5E7)
    public val DarkInkSoft: Color = Color(0xFF8E8E93)
    public val DarkAccent: Color = Color(0xFFC41E1E)
    public val DarkSuccess: Color = Color(0xFF34C759)
    public val DarkWarning: Color = Color(0xFFFF9F0A)
    public val DarkDanger: Color = Color(0xFFFF3B30)
    public val DarkOutline: Color = Color(0xFF3C3C3E)
}
