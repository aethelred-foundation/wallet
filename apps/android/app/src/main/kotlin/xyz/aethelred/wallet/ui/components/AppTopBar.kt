package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarColors
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.theme.IconTokens

/**
 * Unified TopAppBar shell for every secondary screen.
 *
 * Every inner route (AccountDetail, Send, Receive, etc.) uses this so the
 * back-button, title, and optional action cluster stay aligned. Primary
 * tabs (Home, Activity, Hub, Payments, Settings) render their own bespoke
 * bar because the spacing differs.
 *
 * @param title Title text (localised).
 * @param onBack Invoked when the back affordance is tapped.
 * @param modifier Compose modifier.
 * @param actions Slot for trailing icon buttons — caller supplies any
 *                count of `IconButton` composables.
 * @param colors Override for the bar colours. Defaults to Material3 values.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun AppTopBar(
    title: String,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
    colors: TopAppBarColors = TopAppBarDefaults.topAppBarColors(),
) {
    TopAppBar(
        modifier = modifier,
        title = { Text(title) },
        navigationIcon = {
            IconButton(onClick = onBack) {
                Icon(IconTokens.Back, contentDescription = stringResource(R.string.cd_back))
            }
        },
        actions = actions,
        colors = colors,
    )
}
