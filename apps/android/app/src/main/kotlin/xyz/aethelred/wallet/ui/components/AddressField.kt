package xyz.aethelred.wallet.ui.components

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.theme.IconTokens

/**
 * Input field specialised for Ethereum addresses and ENS names.
 *
 * Features:
 *  * Monospace font so the 40 hex characters stay legible.
 *  * Clipboard-paste trailing-icon — one-tap flow.
 *  * ENS placeholder text surfaced when the input looks like a name.
 *
 * Delegates validation to the caller so the same component can back the
 * Send, Contacts, and Approval surfaces without forking the rules.
 *
 * @param value Current input.
 * @param onValueChange Emitted on every edit.
 * @param ensPreview Resolver output ("vitalik.eth - 0xd8dA..."). Null hides.
 * @param errorMessage Inline validation message rendered below the field.
 * @param modifier Compose modifier.
 */
@Composable
public fun AddressField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    ensPreview: String? = null,
    errorMessage: String? = null,
) {
    val context = LocalContext.current

    Column(modifier = modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            label = { Text(stringResource(R.string.send_recipient_label)) },
            placeholder = { Text(stringResource(R.string.send_recipient_hint)) },
            singleLine = true,
            isError = errorMessage != null,
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            trailingIcon = {
                IconButton(onClick = { pasteFromClipboard(context, onValueChange) }) {
                    Icon(
                        IconTokens.Copy,
                        contentDescription = stringResource(R.string.address_paste_cd),
                    )
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )

        ensPreview?.let {
            Spacer(Modifier.height(4.dp))
            Row {
                Icon(IconTokens.Info, contentDescription = null)
                Spacer(Modifier.width(6.dp))
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }

        errorMessage?.let {
            Spacer(Modifier.height(4.dp))
            Text(
                text = it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

private fun pasteFromClipboard(context: Context, onPaste: (String) -> Unit) {
    val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    val item = manager.primaryClip?.getItemAt(0) ?: return
    val text = item.text?.toString()?.trim().orEmpty()
    if (text.isNotBlank()) onPaste(text)
}
