package xyz.aethelred.wallet.ui.theme

import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Spacing token catalogue shared with the iOS / extension wallets.
 *
 * The wallet uses a 4dp grid. Values grow in 4, 8, 12, 16, 20, 24, 32,
 * 40, 48, 64 dp increments so a single numeric step in Figma maps 1:1
 * onto a token here. Anything outside the scale is a design smell — file
 * a bug before adding `20.dp` literals directly.
 */
public data class AethelredSpacing(
    /** 2dp — hair rules, focus ring offsets. */
    public val hair: Dp = 2.dp,
    /** 4dp — smallest meaningful gap. */
    public val xxs: Dp = 4.dp,
    /** 8dp — tight inline rows, chip internal padding. */
    public val xs: Dp = 8.dp,
    /** 12dp — card internal rhythm (label to value). */
    public val sm: Dp = 12.dp,
    /** 16dp — default card padding and list spacing. */
    public val md: Dp = 16.dp,
    /** 20dp — screen-edge gutter used on every Scaffold. */
    public val lg: Dp = 20.dp,
    /** 24dp — section separators. */
    public val xl: Dp = 24.dp,
    /** 32dp — above hero tiles. */
    public val xxl: Dp = 32.dp,
    /** 40dp — empty-state separation. */
    public val xxxl: Dp = 40.dp,
    /** 48dp — footer keep-out zone. */
    public val gigantic: Dp = 48.dp,
    /** 64dp — top-of-screen breathing room for onboarding hero. */
    public val hero: Dp = 64.dp,
) {
    /** Convenience indexer used by generative tests. */
    public val values: List<Dp> get() = listOf(
        hair, xxs, xs, sm, md, lg, xl, xxl, xxxl, gigantic, hero,
    )
}

/** Composition local exposing the brand spacing scale. */
public val LocalAethelredSpacing: ProvidableCompositionLocal<AethelredSpacing> =
    staticCompositionLocalOf { AethelredSpacing() }
