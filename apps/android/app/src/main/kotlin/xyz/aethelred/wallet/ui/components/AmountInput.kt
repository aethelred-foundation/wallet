package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R

/**
 * Amount-entry field with MAX button and optional USD toggle.
 *
 * Consumer-facing wallets need a single row that does three things well:
 *  1. Parse numeric input with locale-aware decimals.
 *  2. Snap to the account's available balance via MAX.
 *  3. Flip between native-asset and USD display without losing context.
 *
 * This component owns the visual shell; the ViewModel owns state transitions.
 *
 * @param value Raw input (string). Validation stays on the ViewModel.
 * @param onValueChange Fires on every edit.
 * @param nativeSymbol Ticker rendered as a suffix ("ETH").
 * @param balanceFormatted Display balance rendered above MAX chip.
 * @param onMaxClick Invoked when MAX is tapped — the VM should rewrite [value].
 * @param isFiatMode Whether the input is denominated in USD.
 * @param onFiatToggle Fires when the user taps the currency pill.
 */
@Composable
public fun AmountInput(
    value: String,
    onValueChange: (String) -> Unit,
    nativeSymbol: String,
    balanceFormatted: String,
    onMaxClick: () -> Unit,
    isFiatMode: Boolean,
    onFiatToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = stringResource(
                    R.string.amount_balance_label,
                    balanceFormatted,
                    nativeSymbol,
                ),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onFiatToggle) {
                    Text(
                        text = if (isFiatMode) "USD" else nativeSymbol,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = onMaxClick) {
                    Text(stringResource(R.string.amount_max))
                }
            }
        }
        Spacer(Modifier.height(4.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = { Text(stringResource(R.string.send_amount_hint)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
