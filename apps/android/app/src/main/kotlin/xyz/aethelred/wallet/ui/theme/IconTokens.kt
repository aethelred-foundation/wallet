package xyz.aethelred.wallet.ui.theme

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.CallReceived
import androidx.compose.material.icons.automirrored.filled.Help
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Announcement
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.AttachMoney
import androidx.compose.material.icons.filled.Autorenew
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Cached
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.Payment
import androidx.compose.material.icons.filled.PermIdentity
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PieChart
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Radar
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.RemoveRedEye
import androidx.compose.material.icons.filled.Savings
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.Usb
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * Semantic icon catalogue.
 *
 * Screens reference `IconTokens.Home` rather than `Icons.Filled.Home`
 * directly. Swapping a token (e.g. switching `IconTokens.Send` from
 * AutoMirrored Send to a Paper-Plane variant) becomes a one-line change
 * instead of a codebase-wide refactor.
 */
public object IconTokens {

    // Navigation
    public val Back: ImageVector = Icons.AutoMirrored.Filled.ArrowBack
    public val Close: ImageVector = Icons.Filled.Close
    public val Settings: ImageVector = Icons.Filled.Settings
    public val Home: ImageVector = Icons.Filled.Home
    public val List: ImageVector = Icons.AutoMirrored.Filled.List
    public val OpenInNew: ImageVector = Icons.Filled.OpenInNew
    public val More: ImageVector = Icons.Filled.ExpandMore
    public val Help: ImageVector = Icons.AutoMirrored.Filled.Help

    // Core wallet actions
    public val Send: ImageVector = Icons.AutoMirrored.Filled.Send
    public val Receive: ImageVector = Icons.AutoMirrored.Filled.CallReceived
    public val Swap: ImageVector = Icons.Filled.SwapHoriz
    public val Scan: ImageVector = Icons.Filled.QrCodeScanner
    public val Copy: ImageVector = Icons.Filled.ContentCopy
    public val Share: ImageVector = Icons.Filled.Share
    public val Search: ImageVector = Icons.Filled.Search
    public val Filter: ImageVector = Icons.Filled.FilterList
    public val Refresh: ImageVector = Icons.Filled.Refresh
    public val Reload: ImageVector = Icons.Filled.Cached
    public val Add: ImageVector = Icons.Filled.Add
    public val Remove: ImageVector = Icons.Filled.Remove
    public val Edit: ImageVector = Icons.Filled.Edit
    public val Delete: ImageVector = Icons.Filled.Delete
    public val Star: ImageVector = Icons.Filled.Star
    public val Visibility: ImageVector = Icons.Filled.Visibility
    public val VisibilityOff: ImageVector = Icons.Filled.VisibilityOff
    public val Preview: ImageVector = Icons.Filled.RemoveRedEye
    public val Download: ImageVector = Icons.Filled.Download

    // Status / feedback
    public val Success: ImageVector = Icons.Filled.CheckCircle
    public val Info: ImageVector = Icons.Filled.Info
    public val Warning: ImageVector = Icons.Filled.Warning
    public val Danger: ImageVector = Icons.Filled.Error
    public val Verified: ImageVector = Icons.Filled.VerifiedUser
    public val Block: ImageVector = Icons.Filled.Block
    public val Check: ImageVector = Icons.Filled.Check
    public val DoneAll: ImageVector = Icons.Filled.DoneAll
    public val Done: ImageVector = Icons.Filled.Done

    // Security
    public val Lock: ImageVector = Icons.Filled.Lock
    public val Unlock: ImageVector = Icons.Filled.LockOpen
    public val Biometric: ImageVector = Icons.Filled.Fingerprint
    public val Key: ImageVector = Icons.Filled.Key
    public val Password: ImageVector = Icons.Filled.Password
    public val Shield: ImageVector = Icons.Filled.Shield
    public val Security: ImageVector = Icons.Filled.Security
    public val Identity: ImageVector = Icons.Filled.PermIdentity
    public val Admin: ImageVector = Icons.Filled.AdminPanelSettings

    // Portfolio / money
    public val Portfolio: ImageVector = Icons.Filled.PieChart
    public val Balance: ImageVector = Icons.Filled.AccountBalance
    public val TrendingUp: ImageVector = Icons.Filled.TrendingUp
    public val Savings: ImageVector = Icons.Filled.Savings
    public val Money: ImageVector = Icons.Filled.AttachMoney
    public val Receipt: ImageVector = Icons.Filled.Receipt
    public val Payment: ImageVector = Icons.Filled.Payment
    public val History: ImageVector = Icons.Filled.History

    // Network / connections
    public val Network: ImageVector = Icons.Filled.Public
    public val Link: ImageVector = Icons.Filled.Link
    public val Wifi: ImageVector = Icons.Filled.Wifi
    public val Offline: ImageVector = Icons.Filled.CloudOff
    public val Devices: ImageVector = Icons.Filled.Devices
    public val Usb: ImageVector = Icons.Filled.Usb
    public val Bluetooth: ImageVector = Icons.Filled.Bluetooth
    public val Radar: ImageVector = Icons.Filled.Radar

    // Hub / catalog
    public val Apps: ImageVector = Icons.Filled.Apps
    public val Campaign: ImageVector = Icons.Filled.Campaign
    public val Announcement: ImageVector = Icons.Filled.Announcement
    public val Speed: ImageVector = Icons.Filled.Speed
    public val Code: ImageVector = Icons.Filled.Code
    public val Autorenew: ImageVector = Icons.Filled.Autorenew
    public val BrokenImage: ImageVector = Icons.Filled.BrokenImage

    // Identity / people
    public val Person: ImageVector = Icons.Filled.Person
    public val Account: ImageVector = Icons.Filled.AccountCircle
    public val Notifications: ImageVector = Icons.Filled.Notifications
}
