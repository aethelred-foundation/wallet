package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.ui.theme.LocalAethelredSpacing

/**
 * Wrapper around Material3's [ModalBottomSheet] that applies Aethelred
 * spacing and a consistent title treatment. Every sheet in the wallet
 * should go through this wrapper so haptics and dismiss handling stay in
 * lockstep.
 *
 * @param title Optional centred title rendered above [content].
 * @param onDismissRequest Invoked when the user swipes the sheet down or
 *                         taps the scrim.
 * @param skipPartiallyExpanded `true` → full-height on open; `false` →
 *                              expands only to the content height first.
 * @param content Slot for the sheet body.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun BottomSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    skipPartiallyExpanded: Boolean = false,
    content: @Composable () -> Unit,
) {
    val spacing = LocalAethelredSpacing.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = skipPartiallyExpanded)

    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        sheetState = sheetState,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    PaddingValues(
                        horizontal = spacing.lg,
                        vertical = spacing.md,
                    ),
                ),
        ) {
            title?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.titleLarge,
                )
                Spacer(Modifier.height(spacing.sm))
            }
            content()
            Spacer(Modifier.height(24.dp))
        }
    }
}
