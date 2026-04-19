package xyz.aethelred.wallet.ui.sheets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.BottomSheet
import xyz.aethelred.wallet.ui.theme.IconTokens

/**
 * Brand-styled bottom sheet shown while the platform biometric prompt
 * is resolving.
 *
 * The actual hardware prompt is owned by
 * [xyz.aethelred.wallet.auth.BiometricUnlock]; this sheet is what the
 * user looks at *before* tapping Unlock so they know what's about to
 * happen.
 */
@Composable
public fun BiometricPromptDialog(
    onConfirm: () -> Unit,
    onDismissRequest: () -> Unit,
) {
    BottomSheet(
        onDismissRequest = onDismissRequest,
        title = stringResource(R.string.biometric_prompt_title),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                imageVector = IconTokens.Biometric,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(40.dp),
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.biometric_prompt_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(16.dp))
        Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.lock_cta_biometric))
        }
        Spacer(Modifier.height(8.dp))
        OutlinedButton(onClick = onDismissRequest, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.confirmation_sheet_cancel))
        }
    }
}
