package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.AethelredTypography
import xyz.aethelred.wallet.ui.theme.LocalAethelredColors

/**
 * Split-symbol currency presentation used across Home, Account detail,
 * and Send review.
 *
 * The amount is typeset in the brand's [AethelredTypography.HeroAmount]
 * style, while the currency symbol trails in a softer tone. The iOS team
 * ships the same treatment in their `CurrencyText` SwiftUI component,
 * hence the parallel name.
 *
 * @param amount Numeric string already formatted for display
 *               (e.g. "1,234.56"). No parsing is done here — pass a
 *               locale-formatted value.
 * @param symbol Ticker symbol ("ETH", "USD"). Rendered softer than the
 *               amount.
 * @param modifier Compose modifier.
 * @param amountStyle Style applied to the primary amount.
 * @param symbolStyle Style applied to the trailing symbol.
 * @param symbolTint Override for the symbol tone. Defaults to the brand
 *                   "ink soft" shade so the currency fades behind the
 *                   value.
 */
@Composable
public fun CurrencyText(
    amount: String,
    symbol: String,
    modifier: Modifier = Modifier,
    amountStyle: TextStyle = AethelredTypography.HeroAmount,
    symbolStyle: TextStyle = MaterialTheme.typography.titleMedium,
    symbolTint: Color = LocalAethelredColors.current.inkSoft,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(
            text = amount,
            style = amountStyle,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text = symbol,
            style = symbolStyle,
            color = symbolTint,
        )
    }
}
