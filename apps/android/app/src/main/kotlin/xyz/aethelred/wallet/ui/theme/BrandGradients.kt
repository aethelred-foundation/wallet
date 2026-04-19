package xyz.aethelred.wallet.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/**
 * Named brand gradients. Each gradient returns a [Brush] so it can drop
 * directly into `Modifier.background` / `drawRect`.
 *
 * Names are semantic (hero, success, sunrise) so screens can request
 * "the success gradient" without hard-coding the color stops. Paired
 * theme variants live inline — dark-mode uses deeper tones to preserve
 * contrast against the ink.
 */
public object BrandGradients {

    /** Hero gradient used on onboarding splash and portfolio card headers. */
    @Composable
    public fun hero(darkTheme: Boolean): Brush = Brush.verticalGradient(
        colors = if (darkTheme) {
            listOf(Color(0xFF1E0A0A), Color(0xFF3A0F14), Color(0xFF121212))
        } else {
            listOf(Color(0xFFFFE8E8), Color(0xFFFFF0F0), Color(0xFFFFFFFF))
        },
    )

    /** Success gradient for tx-confirmed full-bleed cards. */
    public fun success(): Brush = Brush.linearGradient(
        colors = listOf(Color(0xFF0E6B2E), Color(0xFF2EA144)),
    )

    /** Warning gradient for elevated-risk banners. */
    public fun warning(): Brush = Brush.linearGradient(
        colors = listOf(Color(0xFFC28800), Color(0xFFFFB020)),
    )

    /** Danger gradient for reject confirmations. */
    public fun danger(): Brush = Brush.linearGradient(
        colors = listOf(Color(0xFF7F0E0E), Color(0xFFC41E1E)),
    )

    /** Skeleton shimmer gradient used by [xyz.aethelred.wallet.ui.components.Skeleton]. */
    @Composable
    public fun skeletonShimmer(darkTheme: Boolean): Brush {
        val base = if (darkTheme) Color(0xFF232326) else Color(0xFFEFEFF3)
        val shine = if (darkTheme) Color(0xFF303036) else Color(0xFFDCDCE5)
        return Brush.horizontalGradient(listOf(base, shine, base))
    }

    /** Circular accent used behind the lock icon on LockScreen. */
    public fun lockRadial(): Brush = Brush.radialGradient(
        colors = listOf(Color(0x66C41E1E), Color(0x00C41E1E)),
    )

    /** Cool metallic gradient used on the delegation / attestation cards. */
    public fun metallic(): Brush = Brush.linearGradient(
        colors = listOf(Color(0xFF353540), Color(0xFF1E1E20)),
    )

    /** Sunrise gradient for first-time passkey enrollment celebration. */
    public fun sunrise(): Brush = Brush.verticalGradient(
        colors = listOf(Color(0xFFFFC371), Color(0xFFFF5F6D)),
    )
}
