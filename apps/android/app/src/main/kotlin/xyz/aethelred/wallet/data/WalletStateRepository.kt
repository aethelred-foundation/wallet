package xyz.aethelred.wallet.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import xyz.aethelred.wallet.core.audit.AuditCapture
import xyz.aethelred.wallet.core.audit.AuditEventKind
import xyz.aethelred.wallet.core.identity.WalletAccount
import xyz.aethelred.wallet.core.network.NetworkDefinition
import xyz.aethelred.wallet.core.network.NetworkRegistry
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Immutable snapshot of every piece of state the UI layer cares about.
 *
 * @property isLocked Whether the user must authenticate to proceed.
 * @property lastUnlockError Last human-readable unlock failure message;
 *                           cleared on the next successful attempt.
 * @property accounts List of accounts the user has on-device.
 * @property recentActivity Lightweight feed items rendered on Home.
 * @property portfolioValueFormatted Aggregate portfolio value (display).
 * @property portfolioSymbol Ticker next to the portfolio value.
 * @property primaryNetworkName Currently-selected network for the UI.
 * @property requireBiometricsForSigning Settings toggle mirrored in UI.
 */
public data class WalletUiState(
    public val isLocked: Boolean,
    public val lastUnlockError: String? = null,
    public val accounts: List<WalletAccount> = emptyList(),
    public val recentActivity: List<ActivityItem> = emptyList(),
    public val portfolioValueFormatted: String = "0.00",
    public val portfolioSymbol: String = "USD",
    public val primaryNetworkName: String = "",
    public val requireBiometricsForSigning: Boolean = true,
)

/**
 * Small two-line model rendered by Home's activity feed.
 */
public data class ActivityItem(
    public val id: String,
    public val title: String,
    public val subtitle: String,
)

/**
 * Single source of truth for in-memory wallet state. The UI layer
 * subscribes via [uiState]; every mutation goes through a suspend
 * function so we can instrument audit + persistence uniformly.
 */
@Singleton
public class WalletStateRepository @Inject constructor(
    private val secureStore: SecureStore,
    private val auditCapture: AuditCapture,
    networkRegistry: NetworkRegistry,
) {

    private val defaultNetwork: NetworkDefinition = networkRegistry.defaultNetwork

    private val _uiState: MutableStateFlow<WalletUiState> = MutableStateFlow(
        WalletUiState(
            isLocked = true,
            primaryNetworkName = defaultNetwork.name,
            requireBiometricsForSigning = secureStore.readBoolean(KEY_BIOMETRIC_GATE, true),
        ),
    )

    /** Observable state snapshot used by every screen. */
    public val uiState: StateFlow<WalletUiState> = _uiState.asStateFlow()

    private var lastInteractionAt: Long = 0L

    /** Called by [xyz.aethelred.wallet.AethelredWalletApplication] on app resume. */
    public fun onProcessStarted() {
        // If the idle window has been exceeded we stay locked; otherwise
        // we leave the state alone so a quick task-switch doesn't kick the
        // user out.
        val idle = System.currentTimeMillis() - lastInteractionAt
        if (idle > IDLE_LOCK_WINDOW_MS) {
            _uiState.update { it.copy(isLocked = true) }
        }
    }

    /** Called on backgrounding. Remember the timestamp so we can enforce idle-lock. */
    public fun onProcessStopped() {
        lastInteractionAt = System.currentTimeMillis()
        _uiState.update { it.copy(isLocked = true) }
    }

    /** Flip the locked state to false after a successful authentication. */
    public suspend fun markUnlocked() {
        _uiState.update { it.copy(isLocked = false, lastUnlockError = null) }
        auditCapture.record(kind = AuditEventKind.LOCK_STATE_CHANGED, detail = mapOf("state" to "unlocked"))
    }

    /** Stamp the last-unlock error so the UI can surface it. */
    public fun markUnlockError(message: String?) {
        _uiState.update { it.copy(lastUnlockError = message) }
    }

    /** Hook for the "Use device passcode" CTA; real wiring is device-specific. */
    public suspend fun requestPasscodeFallback() {
        // FOLLOW-UP(android-team): route through KeyguardManager.createConfirmDeviceCredentialIntent
        auditCapture.record(
            kind = AuditEventKind.LOCK_STATE_CHANGED,
            detail = mapOf("action" to "passcode-requested"),
        )
    }

    /**
     * Create a fresh account + key pair.
     *
     * The scaffold fabricates a dummy account so downstream screens have
     * something to render. Swap for the real signer factory once the
     * secp256k1 library choice is made (see `Secp256k1Signer`).
     */
    public suspend fun createAccount() {
        val newAccount = WalletAccount(
            id = UUID.randomUUID().toString(),
            displayName = "Account " + ((_uiState.value.accounts.size) + 1),
            address = "0x" + "0".repeat(40),
            balanceFormatted = "0.00",
            nativeSymbol = defaultNetwork.nativeCurrency.symbol,
            chainId = defaultNetwork.chainId,
        )
        _uiState.update { it.copy(accounts = it.accounts + newAccount) }
        auditCapture.record(
            kind = AuditEventKind.ACCOUNT_CREATED,
            detail = mapOf("accountId" to newAccount.id),
        )
    }

    /** Placeholder for the future seed-phrase / keystore import flow. */
    public suspend fun importAccount() {
        auditCapture.record(
            kind = AuditEventKind.ACCOUNT_IMPORTED,
            detail = mapOf("source" to "placeholder"),
        )
    }

    /** Persist the "require biometrics for signing" toggle in Settings. */
    public suspend fun setBiometricsRequiredForSigning(enabled: Boolean) {
        secureStore.writeBoolean(KEY_BIOMETRIC_GATE, enabled)
        _uiState.update { it.copy(requireBiometricsForSigning = enabled) }
    }

    private companion object {
        private const val KEY_BIOMETRIC_GATE = "settings.require_biometric_for_signing"
        private const val IDLE_LOCK_WINDOW_MS = 60_000L
    }
}
