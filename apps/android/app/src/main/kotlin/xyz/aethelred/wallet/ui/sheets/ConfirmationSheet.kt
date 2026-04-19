package xyz.aethelred.wallet.ui.sheets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.BottomSheet

/** Key/value pair rendered in the fee + detail list. */
public data class ConfirmationRow(
    public val label: String,
    public val value: String,
)

/**
 * Generic confirm-or-cancel bottom sheet.
 *
 * Shared between Send review, Swap review, and the Revoke-approval
 * flows so the fee breakdown stays visually identical.
 */
@Composable
public fun ConfirmationSheet(
    title: String,
    rows: List<ConfirmationRow>,
    onConfirm: () -> Unit,
    onDismissRequest: () -> Unit,
    confirmLabel: String = stringResource(R.string.confirmation_sheet_confirm),
    cancelLabel: String = stringResource(R.string.confirmation_sheet_cancel),
) {
    BottomSheet(
        onDismissRequest = onDismissRequest,
        title = title,
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            rows.forEach { row ->
                Row {
                    Text(
                        text = row.label,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    Text(row.value, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Row {
            OutlinedButton(
                onClick = onDismissRequest,
                modifier = Modifier.weight(1f),
            ) {
                Text(cancelLabel)
            }
            Spacer(Modifier.width(8.dp))
            Button(
                onClick = onConfirm,
                modifier = Modifier.weight(1f),
            ) {
                Text(confirmLabel)
            }
        }
    }
}
