package xyz.aethelred.wallet.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/**
 * Corner-radius scale shared with the iOS team.
 *
 * * Hero (22dp) — large balance cards and the Home summary tile.
 * * Card  (16dp) — default surface for Compose `Card` / `Surface`.
 * * Button (12dp) — primary + secondary CTA buttons.
 * * Chip  (8dp)  — inline pills like [xyz.aethelred.wallet.ui.components.RiskBadge].
 */
public object AethelredShapes {

    public val Hero: RoundedCornerShape = RoundedCornerShape(22.dp)
    public val Card: RoundedCornerShape = RoundedCornerShape(16.dp)
    public val Button: RoundedCornerShape = RoundedCornerShape(12.dp)
    public val Chip: RoundedCornerShape = RoundedCornerShape(8.dp)

    public val Material: Shapes = Shapes(
        extraSmall = RoundedCornerShape(4.dp),
        small = Chip,
        medium = Button,
        large = Card,
        extraLarge = Hero,
    )
}
