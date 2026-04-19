package xyz.aethelred.wallet.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import xyz.aethelred.wallet.ui.screens.AccountDetailScreen
import xyz.aethelred.wallet.ui.screens.AccountsScreen
import xyz.aethelred.wallet.ui.screens.ApprovalScreen
import xyz.aethelred.wallet.ui.screens.HomeScreen
import xyz.aethelred.wallet.ui.screens.LockScreen
import xyz.aethelred.wallet.ui.screens.ReceiveScreen
import xyz.aethelred.wallet.ui.screens.SendScreen
import xyz.aethelred.wallet.ui.screens.SettingsScreen
import xyz.aethelred.wallet.viewmodel.WalletStateViewModel

/**
 * Typed route catalogue. Kept as a sealed class so the navigation graph
 * below can exhaustively handle every destination, and any downstream
 * deep-link mapping has compile-time checks.
 */
public sealed class WalletRoute(public val path: String) {
    public data object Lock : WalletRoute("lock")
    public data object Home : WalletRoute("home")
    public data object Accounts : WalletRoute("accounts")
    public data class AccountDetail(public val accountId: String) :
        WalletRoute("account/$accountId") {
        public companion object {
            public const val PATH_TEMPLATE: String = "account/{accountId}"
            public const val ARG: String = "accountId"
        }
    }
    public data object Send : WalletRoute("send")
    public data object Receive : WalletRoute("receive")
    public data object Approval : WalletRoute("approval")
    public data object Settings : WalletRoute("settings")
}

/**
 * Top-level Compose nav graph.
 *
 * The graph is split deliberately by responsibility: the lock gate at the
 * root, then the actual wallet surfaces. `LockScreen` forces navigation
 * to [WalletRoute.Home] on successful unlock, so downstream screens can
 * assume the in-memory keystore is warmed.
 */
@Composable
public fun AppNavigation(
    navController: NavHostController = rememberNavController(),
    walletStateViewModel: WalletStateViewModel = hiltViewModel(),
) {
    val state by walletStateViewModel.state.collectAsState()

    val startDestination = if (state.isLocked) WalletRoute.Lock.path else WalletRoute.Home.path

    NavHost(
        navController = navController,
        startDestination = startDestination,
    ) {
        composable(WalletRoute.Lock.path) {
            LockScreen(onUnlocked = {
                navController.navigate(WalletRoute.Home.path) {
                    popUpTo(WalletRoute.Lock.path) { inclusive = true }
                }
            })
        }

        composable(WalletRoute.Home.path) {
            HomeScreen(
                onOpenAccounts = { navController.navigate(WalletRoute.Accounts.path) },
                onOpenSend = { navController.navigate(WalletRoute.Send.path) },
                onOpenReceive = { navController.navigate(WalletRoute.Receive.path) },
                onOpenSettings = { navController.navigate(WalletRoute.Settings.path) },
                onOpenApproval = { navController.navigate(WalletRoute.Approval.path) },
            )
        }

        composable(WalletRoute.Accounts.path) {
            AccountsScreen(
                onOpenAccount = { accountId ->
                    navController.navigate(WalletRoute.AccountDetail(accountId).path)
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable(WalletRoute.AccountDetail.PATH_TEMPLATE) { entry ->
            val accountId = entry.arguments?.getString(WalletRoute.AccountDetail.ARG).orEmpty()
            AccountDetailScreen(
                accountId = accountId,
                onBack = { navController.popBackStack() },
            )
        }

        composable(WalletRoute.Send.path) {
            SendScreen(onBack = { navController.popBackStack() })
        }

        composable(WalletRoute.Receive.path) {
            ReceiveScreen(onBack = { navController.popBackStack() })
        }

        composable(WalletRoute.Approval.path) {
            ApprovalScreen(
                onDecide = { navController.popBackStack() },
            )
        }

        composable(WalletRoute.Settings.path) {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
    }
}
