package xyz.aethelred.wallet.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.theme.IconTokens

/**
 * KYC step-ladder UI.
 *
 * Not the actual verification logic — that's done by a KYC vendor (Persona /
 * Sumsub / Onfido) via a WebView or SDK. This screen owns the step
 * tracker + next-step CTA so the rest of the flow lives in the vendor
 * surface.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun IdVerificationScreen(
    onBack: () -> Unit,
    onContinue: (Int) -> Unit,
) {
    var step by remember { mutableIntStateOf(0) }
    val steps = listOf(
        stringResource(R.string.id_verification_step_identity),
        stringResource(R.string.id_verification_step_document),
        stringResource(R.string.id_verification_step_selfie),
        stringResource(R.string.id_verification_step_liveness),
        stringResource(R.string.id_verification_step_review),
    )

    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.id_verification_title),
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
            steps.forEachIndexed { index, label ->
                GlassCard(modifier = Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = when {
                                index < step -> IconTokens.Success
                                index == step -> IconTokens.Autorenew
                                else -> IconTokens.Identity
                            },
                            contentDescription = null,
                            tint = if (index < step) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                        Spacer(Modifier.height(0.dp))
                        Text(
                            text = label,
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(start = 12.dp),
                        )
                    }
                }
            }

            Button(
                onClick = {
                    onContinue(step)
                    if (step < steps.size - 1) step += 1
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(
                    text = if (step == 0) {
                        stringResource(R.string.id_verification_cta_start)
                    } else {
                        stringResource(R.string.id_verification_cta_continue)
                    },
                )
            }
        }
    }
}
