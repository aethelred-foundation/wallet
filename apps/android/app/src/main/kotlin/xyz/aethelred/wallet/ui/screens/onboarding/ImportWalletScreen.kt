package xyz.aethelred.wallet.ui.screens.onboarding

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.InlineAlert
import xyz.aethelred.wallet.ui.components.AlertSeverity

/**
 * Recovery-phrase import surface.
 *
 * Features:
 *  * Paste-detection from the clipboard on screen enter.
 *  * Word-count sanity check (12, 15, 18, 21, 24).
 *  * Auto-lowercase normalization — BIP-39 wordlists are all lowercase.
 *
 * Actual derivation is delegated to the wallet's key derivation module
 * (kept as a TODO until the signer integration lands).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun ImportWalletScreen(
    onBack: () -> Unit,
    onImported: () -> Unit,
) {
    val context = LocalContext.current
    var phrase by remember { mutableStateOf(readClipboardPhrase(context)) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.onboarding_import_title),
                onBack = onBack,
            )
        },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = stringResource(R.string.onboarding_import_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedTextField(
                value = phrase,
                onValueChange = {
                    phrase = it.lowercase()
                    errorMessage = null
                },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.None,
                    imeAction = ImeAction.Done,
                ),
                minLines = 3,
                label = { Text(stringResource(R.string.onboarding_import_title)) },
                isError = errorMessage != null,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(120.dp),
            )

            errorMessage?.let {
                InlineAlert(severity = AlertSeverity.Danger, title = it)
            }

            Spacer(Modifier.height(12.dp))

            Button(
                onClick = {
                    val words = phrase.trim().split(Regex("\\s+"))
                    val validCounts = setOf(12, 15, 18, 21, 24)
                    if (words.size !in validCounts) {
                        errorMessage = "A recovery phrase must be 12, 15, 18, 21, or 24 words."
                        return@Button
                    }
                    onImported()
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.onboarding_import_title))
            }

            OutlinedButton(
                onClick = { phrase = readClipboardPhrase(context) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.address_paste_cd))
            }
        }
    }
}

private fun readClipboardPhrase(context: Context): String {
    val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        ?: return ""
    val clip = manager.primaryClip ?: return ""
    val text = clip.getItemAt(0).text?.toString()?.trim().orEmpty()
    // Heuristic: treat clipboard content as a phrase only if it looks
    // space-separated with 12+ lowercase words.
    val words = text.split(Regex("\\s+"))
    return if (words.size in 12..24 && words.all { it.matches(Regex("[a-z]+")) }) text else ""
}
