package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.IconTokens
import xyz.aethelred.wallet.ui.theme.LocalAethelredColors
import xyz.aethelred.wallet.ui.theme.LocalAethelredSpacing

/**
 * Classification for [TransactionRow]. Drives the trailing icon + colour.
 */
public enum class TxDirection { Outgoing, Incoming, Pending, Failed, Contract }

/**
 * Single row rendered in the Activity / Transactions list.
 *
 * Left: direction icon in a tinted circle.
 * Middle: title + short-form address / memo.
 * Right: amount + ISO date.
 *
 * Tap the whole row to open the tx detail surface.
 *
 * @param direction Direction discriminator.
 * @param title Title line (e.g. "Sent ETH", "Received USDC").
 * @param subtitle Counterparty address (shortened) or contract memo.
 * @param amountFormatted Display amount string (signed — caller prefixes "-"/"+").
 * @param timestamp Human-readable timestamp ("2m ago", "Apr 16 10:14").
 * @param onClick Tap handler.
 */
@Composable
public fun TransactionRow(
    direction: TxDirection,
    title: String,
    subtitle: String,
    amountFormatted: String,
    timestamp: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val extras = LocalAethelredColors.current
    val spacing = LocalAethelredSpacing.current

    val (icon, tint): Pair<ImageVector, androidx.compose.ui.graphics.Color> = when (direction) {
        TxDirection.Outgoing -> IconTokens.Send to extras.danger
        TxDirection.Incoming -> IconTokens.Receive to extras.success
        TxDirection.Pending -> IconTokens.Autorenew to extras.warning
        TxDirection.Failed -> IconTokens.Danger to extras.danger
        TxDirection.Contract -> IconTokens.Code to MaterialTheme.colorScheme.primary
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = spacing.md, vertical = spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.foundation.layout.Box(
            modifier = Modifier
                .size(36.dp)
                .background(tint.copy(alpha = 0.15f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = tint,
            )
        }
        Spacer(Modifier.width(spacing.sm))
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(amountFormatted, style = MaterialTheme.typography.titleMedium)
            Text(
                text = timestamp,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
