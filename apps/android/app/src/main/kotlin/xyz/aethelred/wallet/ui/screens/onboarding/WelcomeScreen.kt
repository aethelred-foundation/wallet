package xyz.aethelred.wallet.ui.screens.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.HapticPressButton
import xyz.aethelred.wallet.ui.theme.BrandGradients
import xyz.aethelred.wallet.ui.theme.IconTokens
import xyz.aethelred.wallet.ui.theme.LocalAethelredDarkTheme
import xyz.aethelred.wallet.ui.theme.LocalAethelredSpacing

/**
 * First-launch welcome screen.
 *
 * Shows the brand hero gradient with two primary actions:
 *  * Create wallet → kicks off the five-step creation flow.
 *  * Import wallet → routes to the recovery-phrase import screen.
 *
 * Both buttons use haptics so the tactile brand fingerprint starts from
 * the very first tap.
 */
@Composable
public fun WelcomeScreen(
    onCreateWallet: () -> Unit,
    onImportWallet: () -> Unit,
) {
    val spacing = LocalAethelredSpacing.current
    val darkTheme = LocalAethelredDarkTheme.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BrandGradients.hero(darkTheme))
            .padding(horizontal = spacing.xl, vertical = spacing.hero),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                imageVector = IconTokens.Shield,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(72.dp),
            )
            Spacer(Modifier.height(spacing.xl))
            Text(
                text = stringResource(R.string.onboarding_welcome_title),
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(spacing.sm))
            Text(
                text = stringResource(R.string.onboarding_welcome_subtitle),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        Column(modifier = Modifier.fillMaxWidth()) {
            HapticPressButton(
                onClick = onCreateWallet,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.onboarding_cta_create))
            }
            Spacer(Modifier.height(spacing.xs))
            OutlinedButton(
                onClick = onImportWallet,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.onboarding_cta_import))
            }
        }
    }
}
