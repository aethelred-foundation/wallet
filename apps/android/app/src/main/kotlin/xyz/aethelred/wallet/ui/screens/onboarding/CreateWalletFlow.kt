package xyz.aethelred.wallet.ui.screens.onboarding

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.components.AppTopBar
import xyz.aethelred.wallet.ui.components.GlassCard
import xyz.aethelred.wallet.ui.components.InlineAlert
import xyz.aethelred.wallet.ui.components.AlertSeverity
import xyz.aethelred.wallet.ui.theme.IconTokens
import xyz.aethelred.wallet.ui.theme.LocalAethelredSpacing

/**
 * Step discriminator for [CreateWalletFlow].
 */
public enum class CreateStep { Intro, Terms, GenerateSeed, VerifySeed, Passkey }

/**
 * Five-step wallet creation flow.
 *
 * Handled as a single Composable with a step-indexed state so navigation
 * between steps can animate without recreating the view-model tree. In a
 * production integration a shared StateHandle scopes the seed material
 * to the flow's lifetime and zero-fills it when the flow completes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun CreateWalletFlow(
    onCompleted: () -> Unit,
    onBack: () -> Unit,
) {
    var step by remember { mutableStateOf(CreateStep.Intro) }
    val spacing = LocalAethelredSpacing.current

    Scaffold(
        topBar = {
            AppTopBar(
                title = stringResource(R.string.onboarding_cta_create),
                onBack = {
                    val index = CreateStep.entries.indexOf(step)
                    if (index == 0) onBack() else step = CreateStep.entries[index - 1]
                },
            )
        },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .padding(horizontal = spacing.lg),
            verticalArrangement = Arrangement.spacedBy(spacing.md),
        ) {
            StepIndicator(step = step)
            when (step) {
                CreateStep.Intro -> StepIntro(
                    onNext = { step = CreateStep.Terms },
                )
                CreateStep.Terms -> StepTerms(
                    onNext = { step = CreateStep.GenerateSeed },
                )
                CreateStep.GenerateSeed -> StepGenerateSeed(
                    onNext = { step = CreateStep.VerifySeed },
                )
                CreateStep.VerifySeed -> StepVerifySeed(
                    onNext = { step = CreateStep.Passkey },
                )
                CreateStep.Passkey -> StepPasskey(
                    onCompleted = onCompleted,
                )
            }
        }
    }
}

@Composable
private fun StepIndicator(step: CreateStep) {
    val index = CreateStep.entries.indexOf(step) + 1
    val total = CreateStep.entries.size
    Text(
        text = "$index / $total",
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun StepIntro(onNext: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = stringResource(R.string.onboarding_welcome_title),
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = stringResource(R.string.onboarding_welcome_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(8.dp))
        Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.onboarding_cta_create))
        }
    }
}

@Composable
private fun StepTerms(onNext: () -> Unit) {
    var accepted by remember { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = stringResource(R.string.onboarding_terms_title),
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = stringResource(R.string.onboarding_terms_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.clickable { accepted = !accepted },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Checkbox(checked = accepted, onCheckedChange = { accepted = it })
            Text(stringResource(R.string.onboarding_terms_accept))
        }
        Button(
            onClick = onNext,
            enabled = accepted,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(R.string.send_review))
        }
    }
}

@Composable
private fun StepGenerateSeed(onNext: () -> Unit) {
    var revealed by remember { mutableStateOf(false) }
    val placeholderWords = remember {
        listOf(
            "abandon", "ability", "able", "about",
            "above", "absent", "absorb", "abstract",
            "absurd", "abuse", "access", "accident",
        )
    }
    val spacing = LocalAethelredSpacing.current

    Column(verticalArrangement = Arrangement.spacedBy(spacing.md)) {
        Text(
            text = stringResource(R.string.onboarding_seed_title),
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = stringResource(R.string.onboarding_seed_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        GlassCard(modifier = Modifier.fillMaxWidth()) {
            if (revealed) {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.height(280.dp),
                ) {
                    items(placeholderWords) { word ->
                        GlassCard(modifier = Modifier.fillMaxWidth()) {
                            Text(
                                text = word,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    }
                }
                LaunchedEffect(revealed) {
                    delay(REVEAL_MS)
                    revealed = false
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { revealed = true }
                        .padding(vertical = 40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        imageVector = IconTokens.Visibility,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(32.dp),
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.onboarding_seed_reveal))
                }
            }
        }
        Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.send_review))
        }
    }
}

@Composable
private fun StepVerifySeed(onNext: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = stringResource(R.string.onboarding_verify_title),
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = stringResource(R.string.onboarding_verify_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        InlineAlert(
            severity = AlertSeverity.Info,
            title = stringResource(R.string.onboarding_verify_subtitle),
        )
        Button(onClick = onNext, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.send_review))
        }
    }
}

@Composable
private fun StepPasskey(onCompleted: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = stringResource(R.string.onboarding_passkey_title),
            style = MaterialTheme.typography.headlineSmall,
        )
        Text(
            text = stringResource(R.string.onboarding_passkey_subtitle),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(onClick = onCompleted, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.approval_approve))
        }
        OutlinedButton(onClick = onCompleted, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.onboarding_cta_create))
        }
    }
}

private const val REVEAL_MS: Long = 10_000L
