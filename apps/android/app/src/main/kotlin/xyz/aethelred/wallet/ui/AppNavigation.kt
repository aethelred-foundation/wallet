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
import xyz.aethelred.wallet.ui.screens.ActivityScreen
import xyz.aethelred.wallet.ui.screens.ApprovalScreen
import xyz.aethelred.wallet.ui.screens.ApprovalsListScreen
import xyz.aethelred.wallet.ui.screens.ConnectedSitesScreen
import xyz.aethelred.wallet.ui.screens.DeveloperToolsScreen
import xyz.aethelred.wallet.ui.screens.DigitalAssetsScreen
import xyz.aethelred.wallet.ui.screens.HomeScreen
import xyz.aethelred.wallet.ui.screens.HubScreen
import xyz.aethelred.wallet.ui.screens.IdVerificationScreen
import xyz.aethelred.wallet.ui.screens.LockScreen
import xyz.aethelred.wallet.ui.screens.MachineDelegationScreen
import xyz.aethelred.wallet.ui.screens.MarketsScreen
import xyz.aethelred.wallet.ui.screens.PaymentsScreen
import xyz.aethelred.wallet.ui.screens.PortfolioScreen
import xyz.aethelred.wallet.ui.screens.QrScannerScreen
import xyz.aethelred.wallet.ui.screens.ReceiveScreen
import xyz.aethelred.wallet.ui.screens.RegulatoryPassportScreen
import xyz.aethelred.wallet.ui.screens.SecurityScreen
import xyz.aethelred.wallet.ui.screens.SendScreen
import xyz.aethelred.wallet.ui.screens.SettingsScreen
import xyz.aethelred.wallet.ui.screens.SwapScreen
import xyz.aethelred.wallet.ui.screens.TokenApprovalsScreen
import xyz.aethelred.wallet.ui.screens.TxDetailScreen
import xyz.aethelred.wallet.ui.screens.TxDetailUi
import xyz.aethelred.wallet.ui.screens.onboarding.CreateWalletFlow
import xyz.aethelred.wallet.ui.screens.onboarding.ImportWalletScreen
import xyz.aethelred.wallet.ui.screens.onboarding.RecoveryBackupScreen
import xyz.aethelred.wallet.ui.screens.onboarding.WelcomeScreen
import xyz.aethelred.wallet.ui.components.StatusKind
import xyz.aethelred.wallet.ui.screens.samplePortfolio
import xyz.aethelred.wallet.viewmodel.WalletStateViewModel

/**
 * Typed route catalogue. Kept as a sealed class so the navigation graph
 * below can exhaustively handle every destination, and any downstream
 * deep-link mapping has compile-time checks.
 */
public sealed class WalletRoute(public val path: String) {
    public data object Welcome : WalletRoute("welcome")
    public data object CreateFlow : WalletRoute("onboarding/create")
    public data object Import : WalletRoute("onboarding/import")
    public data object RecoveryBackup : WalletRoute("recovery/backup")
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
    public data object ApprovalsList : WalletRoute("approvals")
    public data object Settings : WalletRoute("settings")
    public data object Swap : WalletRoute("swap")
    public data object Activity : WalletRoute("activity")
    public data object TxDetail : WalletRoute("tx/detail")
    public data object Portfolio : WalletRoute("portfolio")
    public data object Markets : WalletRoute("markets")
    public data object Payments : WalletRoute("payments")
    public data object ConnectedSites : WalletRoute("connected")
    public data object TokenApprovals : WalletRoute("token-approvals")
    public data object QrScanner : WalletRoute("scan")
    public data object Hub : WalletRoute("hub")
    public data object Security : WalletRoute("security")
    public data object RegulatoryPassport : WalletRoute("regulatory")
    public data object IdVerification : WalletRoute("id-verification")
    public data object MachineDelegation : WalletRoute("delegation")
    public data object DigitalAssets : WalletRoute("assets")
    public data object DeveloperTools : WalletRoute("dev")
}

/**
 * Top-level Compose nav graph.
 *
 * Split deliberately by responsibility: the lock gate at the root, then
 * the actual wallet surfaces. [LockScreen] forces navigation to
 * [WalletRoute.Home] on successful unlock, so downstream screens can
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
        composable(WalletRoute.Welcome.path) {
            WelcomeScreen(
                onCreateWallet = { navController.navigate(WalletRoute.CreateFlow.path) },
                onImportWallet = { navController.navigate(WalletRoute.Import.path) },
            )
        }

        composable(WalletRoute.CreateFlow.path) {
            CreateWalletFlow(
                onCompleted = {
                    navController.navigate(WalletRoute.Home.path) {
                        popUpTo(WalletRoute.Welcome.path) { inclusive = true }
                    }
                },
                onBack = { navController.popBackStack() },
            )
        }

        composable(WalletRoute.Import.path) {
            ImportWalletScreen(
                onBack = { navController.popBackStack() },
                onImported = {
                    navController.navigate(WalletRoute.Home.path) {
                        popUpTo(WalletRoute.Welcome.path) { inclusive = true }
                    }
                },
            )
        }

        composable(WalletRoute.RecoveryBackup.path) {
            RecoveryBackupScreen(
                onBack = { navController.popBackStack() },
                onVerified = { navController.popBackStack() },
            )
        }

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

        composable(WalletRoute.Swap.path) {
            SwapScreen(onBack = { navController.popBackStack() })
        }

        composable(WalletRoute.Activity.path) {
            ActivityScreen(
                onBack = { navController.popBackStack() },
                onItemClick = { navController.navigate(WalletRoute.TxDetail.path) },
            )
        }

        composable(WalletRoute.TxDetail.path) {
            TxDetailScreen(
                detail = TxDetailUi(
                    hash = "0x…",
                    status = StatusKind.Verified,
                    blockNumber = null,
                    nonce = "0",
                    gasUsed = "21000",
                    gasPrice = "30 gwei",
                    totalFee = "0.00063 ETH",
                    explorerUrl = "https://etherscan.io",
                    memo = null,
                ),
                onBack = { navController.popBackStack() },
            )
        }

        composable(WalletRoute.Portfolio.path) {
            PortfolioScreen(
                portfolio = samplePortfolio(),
                onBack = { navController.popBackStack() },
            )
        }

        composable(WalletRoute.Markets.path) {
            MarketsScreen(
                tokens = emptyList(),
                onBack = { navController.popBackStack() },
                onTokenClick = { /* ViewModel wires through to TxDetail when implemented. */ },
            )
        }

        composable(WalletRoute.Payments.path) {
            PaymentsScreen(
                payments = xyz.aethelred.wallet.ui.screens.PaymentsUi(
                    monthSpendFormatted = "0",
                    monthSpendSymbol = "USD",
                    monthSpendCounter = 0,
                    treasurySlices = emptyList(),
                ),
                onBack = { navController.popBackStack() },
                onPayContact = {},
                onSendInvoice = {},
                onScheduled = {},
            )
        }

        composable(WalletRoute.ConnectedSites.path) {
            ConnectedSitesScreen(
                sites = emptyList(),
                onBack = { navController.popBackStack() },
                onDisconnect = {},
            )
        }

        composable(WalletRoute.TokenApprovals.path) {
            TokenApprovalsScreen(
                approvals = emptyList(),
                onBack = { navController.popBackStack() },
                onRevoke = {},
            )
        }

        composable(WalletRoute.QrScanner.path) {
            QrScannerScreen(
                onBack = { navController.popBackStack() },
                onScanned = { navController.popBackStack() },
            )
        }

        composable(WalletRoute.Hub.path) {
            HubScreen(
                entries = emptyList(),
                onBack = { navController.popBackStack() },
                onOpen = {},
            )
        }

        composable(WalletRoute.ApprovalsList.path) {
            ApprovalsListScreen(
                approvals = emptyList(),
                onBack = { navController.popBackStack() },
                onApprovalClick = { navController.navigate(WalletRoute.Approval.path) },
            )
        }

        composable(WalletRoute.Security.path) {
            SecurityScreen(
                passkeys = emptyList(),
                sessions = emptyList(),
                onBack = { navController.popBackStack() },
                onEnrollPasskey = {},
                onRevokeSession = {},
                onAutoLockSelected = {},
            )
        }

        composable(WalletRoute.RegulatoryPassport.path) {
            RegulatoryPassportScreen(
                credentials = emptyList(),
                requestReason = null,
                onBack = { navController.popBackStack() },
                onPresent = {},
            )
        }

        composable(WalletRoute.IdVerification.path) {
            IdVerificationScreen(
                onBack = { navController.popBackStack() },
                onContinue = {},
            )
        }

        composable(WalletRoute.MachineDelegation.path) {
            MachineDelegationScreen(
                sessions = emptyList(),
                onBack = { navController.popBackStack() },
                onRevoke = {},
            )
        }

        composable(WalletRoute.DigitalAssets.path) {
            DigitalAssetsScreen(
                nfts = emptyList(),
                credentials = emptyList(),
                onBack = { navController.popBackStack() },
                onNftClick = {},
                onCredentialClick = {},
            )
        }

        composable(WalletRoute.DeveloperTools.path) {
            DeveloperToolsScreen(
                networkOptions = listOf("Ethereum", "Base", "Polygon"),
                selectedNetworkIndex = 0,
                onSelectNetwork = {},
                featureFlags = emptyList(),
                onToggleFlag = { _, _ -> },
                recentCrashes = emptyList(),
                onClearCache = {},
                onBack = { navController.popBackStack() },
            )
        }
    }
}
