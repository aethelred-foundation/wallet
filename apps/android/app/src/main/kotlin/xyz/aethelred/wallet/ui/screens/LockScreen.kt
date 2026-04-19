package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.auth.BiometricUnlock
import xyz.aethelred.wallet.viewmodel.WalletStateViewModel

/**
 * Passkey / biometric gate rendered whenever the wallet is locked.
 *
 * The heavy lifting is delegated to [BiometricUnlock] — this Composable
 * only owns the presentational state (title, subtitle, CTA wiring) and
 * the [onUnlocked] callback the nav graph uses to replace the stack.
 */
@Composable
public fun LockScreen(
    onUnlocked: () -> Unit,
    viewModel: WalletStateViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = Icons.Filled.Fingerprint,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
        )

        Spacer(Modifier.height(24.dp))

        Text(
            text = stringResource(R.string.lock_title),
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )

        Spacer(Modifier.height(8.dp))

        Text(
            text = stringResource(R.string.lock_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(32.dp))

        Button(
            onClick = {
                // `FragmentActivity` is required by the BiometricPrompt.
                // `LocalContext.current` will always resolve to MainActivity,
                // which inherits from ComponentActivity -> FragmentActivity.
                val activity = context as? FragmentActivity ?: return@Button
                viewModel.requestUnlock(
                    activity = activity,
                    unlocker = BiometricUnlock(activity),
                    onSuccess = onUnlocked,
                )
            },
        ) {
            Text(stringResource(R.string.lock_cta_biometric))
        }

        Spacer(Modifier.height(8.dp))

        TextButton(onClick = { viewModel.requestPasscodeFallback() }) {
            Text(stringResource(R.string.lock_cta_passcode))
        }

        state.lastUnlockError?.let { err ->
            Spacer(Modifier.height(16.dp))
            Text(
                text = err,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}
