package xyz.aethelred.wallet.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.theme.IconTokens
import xyz.aethelred.wallet.ui.theme.LocalAethelredMotion
import xyz.aethelred.wallet.ui.theme.rememberHaptics

/** Tab identifier rendered in [BottomNavBar]. */
public enum class BottomTab { Home, Activity, Hub, Payments, Settings }

/**
 * Item displayed inside [BottomNavBar]. Provided at the call site so
 * callers can pick a tab order and wire navigation.
 */
public data class BottomNavItem(
    public val tab: BottomTab,
    public val icon: ImageVector,
    public val label: String,
    public val badgeCount: Int = 0,
)

/**
 * Primary bottom navigation bar. Five tabs max.
 *
 * Renders an animated pill behind the active tab rather than relying on
 * Material's standard underline treatment — the wallet's UI is dense and
 * a soft pill reads better against the dark surface.
 *
 * @param items Ordered list of tabs.
 * @param selected Currently-active tab.
 * @param onTabSelected Fires when the user taps a tab (after haptics).
 * @param modifier Compose modifier.
 */
@Composable
public fun BottomNavBar(
    items: List<BottomNavItem>,
    selected: BottomTab,
    onTabSelected: (BottomTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val motion = LocalAethelredMotion.current
    val haptics = rememberHaptics()

    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items.forEach { item ->
            val isSelected = item.tab == selected
            val tint by animateColorAsState(
                targetValue = if (isSelected) {
                    MaterialTheme.colorScheme.onPrimary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                animationSpec = tween(motion.shortDurationMs),
                label = "nav-tint",
            )
            val bgSize by animateDpAsState(
                targetValue = if (isSelected) 44.dp else 40.dp,
                animationSpec = tween(motion.shortDurationMs),
                label = "nav-bg-size",
            )

            Column(
                modifier = Modifier
                    .weight(1f)
                    .clickable {
                        haptics.segmentedChange()
                        onTabSelected(item.tab)
                    }
                    .padding(vertical = 6.dp)
                    .semantics {
                        role = Role.Tab
                        this.selected = isSelected
                        contentDescription = item.label
                    },
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    modifier = Modifier
                        .size(bgSize)
                        .clip(CircleShape)
                        .background(
                            if (isSelected) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                androidx.compose.ui.graphics.Color.Transparent
                            },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(imageVector = item.icon, contentDescription = null, tint = tint)
                    if (item.badgeCount > 0) {
                        BadgeDot(item.badgeCount)
                    }
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    text = item.label,
                    style = MaterialTheme.typography.labelSmall,
                    color = tint,
                )
            }
        }
    }
}

@Composable
private fun BadgeDot(count: Int) {
    Row(
        modifier = Modifier
            .padding(top = 2.dp, start = 20.dp)
            .background(MaterialTheme.colorScheme.error, CircleShape)
            .padding(horizontal = 4.dp, vertical = 0.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = if (count > 9) "9+" else count.toString(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimary,
        )
    }
}

/** Convenience factory for the default 5-tab layout. */
@Composable
public fun defaultBottomNavItems(): List<BottomNavItem> = listOf(
    BottomNavItem(BottomTab.Home, IconTokens.Home, stringResource(R.string.nav_home)),
    BottomNavItem(BottomTab.Activity, IconTokens.History, stringResource(R.string.nav_activity)),
    BottomNavItem(BottomTab.Hub, IconTokens.Apps, stringResource(R.string.nav_hub)),
    BottomNavItem(BottomTab.Payments, IconTokens.Payment, stringResource(R.string.nav_payments)),
    BottomNavItem(BottomTab.Settings, IconTokens.Settings, stringResource(R.string.nav_settings)),
)
