package xyz.aethelred.wallet.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import xyz.aethelred.wallet.R
import xyz.aethelred.wallet.ui.theme.IconTokens
import xyz.aethelred.wallet.ui.theme.LocalAethelredColors
import xyz.aethelred.wallet.ui.theme.LocalAethelredRadii

/**
 * Closed set of statuses the wallet surfaces to the user.
 *
 *  * [Verified] — credentials, attestations, ENS resolution.
 *  * [Pending]  — multi-sig quorum waiting, tx not yet mined.
 *  * [Expired]  — credentials past `expiresAt`.
 *  * [Revoked]  — delegations explicitly rescinded.
 */
public enum class StatusKind { Verified, Pending, Expired, Revoked }

/**
 * Compact icon+label pill used across the credential, approval, and
 * delegation surfaces.
 *
 * @param status One of [StatusKind].
 * @param modifier Compose modifier.
 */
@Composable
public fun StatusBadge(
    status: StatusKind,
    modifier: Modifier = Modifier,
) {
    val radii = LocalAethelredRadii.current
    val extras = LocalAethelredColors.current
    val (label, fg, bg, icon) = when (status) {
        StatusKind.Verified -> StatusVisual(
            label = stringResource(R.string.status_verified),
            foreground = extras.success,
            background = extras.success.copy(alpha = 0.15f),
            icon = IconTokens.Verified,
        )
        StatusKind.Pending -> StatusVisual(
            label = stringResource(R.string.status_pending),
            foreground = extras.warning,
            background = extras.warning.copy(alpha = 0.15f),
            icon = IconTokens.Autorenew,
        )
        StatusKind.Expired -> StatusVisual(
            label = stringResource(R.string.status_expired),
            foreground = extras.inkSoft,
            background = extras.inkSoft.copy(alpha = 0.18f),
            icon = IconTokens.History,
        )
        StatusKind.Revoked -> StatusVisual(
            label = stringResource(R.string.status_revoked),
            foreground = extras.danger,
            background = extras.danger.copy(alpha = 0.18f),
            icon = IconTokens.Block,
        )
    }

    Row(
        modifier = modifier
            .background(bg, radii.sm)
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = fg,
            modifier = Modifier.size(14.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = label,
            color = fg,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

private data class StatusVisual(
    val label: String,
    val foreground: androidx.compose.ui.graphics.Color,
    val background: androidx.compose.ui.graphics.Color,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
)
