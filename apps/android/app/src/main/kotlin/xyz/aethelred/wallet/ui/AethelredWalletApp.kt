package xyz.aethelred.wallet.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import xyz.aethelred.wallet.ui.theme.AethelredTheme

/**
 * Root Composable used by [xyz.aethelred.wallet.MainActivity].
 *
 * Wraps the whole tree in [AethelredTheme] and a full-bleed Material3
 * Surface so Compose has a canvas to draw on. Navigation is delegated to
 * [AppNavigation], which owns the entire routing graph.
 */
@Composable
public fun AethelredWalletApp() {
    AethelredTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            AppNavigation()
        }
    }
}
