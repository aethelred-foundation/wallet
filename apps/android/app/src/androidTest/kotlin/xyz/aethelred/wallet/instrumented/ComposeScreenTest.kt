package xyz.aethelred.wallet.instrumented

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import xyz.aethelred.wallet.ui.components.ActionTile
import xyz.aethelred.wallet.ui.components.EmptyState
import xyz.aethelred.wallet.ui.theme.AethelredTheme
import xyz.aethelred.wallet.ui.theme.BrandGradients
import xyz.aethelred.wallet.ui.theme.IconTokens
import xyz.aethelred.wallet.ui.theme.LocalAethelredDarkTheme

/**
 * Instrumented Compose UI tests covering the design-system primitives.
 * Narrow focus: verify each composable renders the strings it should
 * inside the Aethelred theme wrapper.
 */
public class ComposeScreenTest {

    @get:Rule
    public val composeTestRule: androidx.compose.ui.test.junit4.ComposeContentTestRule =
        createComposeRule()

    @Test
    public fun actionTileRendersLabel() {
        composeTestRule.setContent {
            AethelredTheme(darkTheme = false) {
                ActionTile(
                    label = "Send",
                    icon = IconTokens.Send,
                    gradient = BrandGradients.success(),
                    onClick = {},
                )
            }
        }
        composeTestRule.onNodeWithText("Send").assertIsDisplayed()
    }

    @Test
    public fun emptyStateRendersTitle() {
        composeTestRule.setContent {
            AethelredTheme(darkTheme = true) {
                CompositionLocalProvider(LocalAethelredDarkTheme provides true) {
                    EmptyState(
                        icon = IconTokens.Home,
                        title = "Nothing here yet",
                    )
                }
            }
        }
        composeTestRule.onNodeWithText("Nothing here yet").assertIsDisplayed()
    }
}
