package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.LocalAethelredColors
import xyz.aethelred.wallet.ui.theme.LocalAethelredSpacing

/**
 * A single row representing a token inside a portfolio or Markets list.
 *
 * Visual layout, left-to-right:
 *   [ icon ] symbol + name        [ price ]
 *                                  [ change% ]
 *
 * Callers must pass pre-formatted strings — this component is deliberately
 * dumb about parsing so it can drop into any list.
 *
 * @param symbol Ticker (e.g. "ETH").
 * @param name Human-readable name (e.g. "Ethereum").
 * @param price Display-formatted price (e.g. "$3,210.55").
 * @param changePercent Signed percent string (e.g. "+2.43%").
 * @param iconColor Background tint for the circular icon stub. Swap for
 *                  a real AsyncImage once networking is wired.
 * @param modifier Compose modifier.
 */
@Composable
public fun TokenRow(
    symbol: String,
    name: String,
    price: String,
    changePercent: String,
    modifier: Modifier = Modifier,
    iconColor: Color = MaterialTheme.colorScheme.primary,
) {
    val spacing = LocalAethelredSpacing.current
    val extras = LocalAethelredColors.current
    val positive = changePercent.startsWith("+")

    Row(
        modifier = modifier
            .fillMaxWidth()
            .semantics { contentDescription = "$symbol $price $changePercent" }
            .padding(horizontal = spacing.md, vertical = spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Placeholder icon stub. Real logo arrives through PriceService.
        Row(
            modifier = Modifier
                .size(36.dp)
                .background(iconColor.copy(alpha = 0.15f), shape = CircleShape),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = symbol.take(2),
                style = MaterialTheme.typography.labelMedium,
                color = iconColor,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Spacer(Modifier.width(spacing.sm))

        Column(modifier = Modifier.weight(1f)) {
            Text(symbol, style = MaterialTheme.typography.titleMedium)
            Text(
                text = name,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Column(horizontalAlignment = Alignment.End) {
            Text(price, style = MaterialTheme.typography.titleMedium)
            Text(
                text = changePercent,
                style = MaterialTheme.typography.bodySmall,
                color = if (positive) extras.success else extras.danger,
            )
        }
    }
}
