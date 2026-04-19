package xyz.aethelred.wallet.viewmodel

import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import xyz.aethelred.wallet.auth.BiometricUnlock
import xyz.aethelred.wallet.data.WalletStateRepository
import xyz.aethelred.wallet.data.WalletUiState
import javax.inject.Inject

/**
 * Top-level state holder for the wallet's UI. Screens that don't own a
 * bespoke ViewModel subscribe here for the global session: locked state,
 * portfolio value, account list, and the toggles that live in Settings.
 *
 * Delegates heavy lifting to [WalletStateRepository] so the ViewModel
 * stays thin enough to unit-test without an Android runtime.
 */
@HiltViewModel
public class WalletStateViewModel @Inject constructor(
    private val repository: WalletStateRepository,
) : ViewModel() {

    /** Observable UI state — collect from Compose with `collectAsState()`. */
    public val state: StateFlow<WalletUiState> = repository.uiState

    /** Trigger a biometric unlock using the supplied [unlocker]. */
    public fun requestUnlock(
        activity: FragmentActivity,
        unlocker: BiometricUnlock,
        onSuccess: () -> Unit,
    ) {
        viewModelScope.launch {
            val result = unlocker.authenticate(activity)
            if (result.isSuccess) {
                repository.markUnlocked()
                onSuccess()
            } else {
                repository.markUnlockError(result.errorMessage)
            }
        }
    }

    /** Ask the repository to fall back to a device-credential prompt. */
    public fun requestPasscodeFallback() {
        viewModelScope.launch { repository.requestPasscodeFallback() }
    }

    /** Create a fresh hardware-backed account. */
    public fun createAccount() {
        viewModelScope.launch { repository.createAccount() }
    }

    /**
     * Import an existing account. The scaffold expects the actual import
     * flow (seed phrase vs. JSON keystore vs. QR) to live in a dedicated
     * screen; this entry point is the hook.
     */
    public fun importAccount() {
        viewModelScope.launch { repository.importAccount() }
    }

    /** Toggle the "require biometrics for signing" switch in Settings. */
    public fun toggleBiometricGate(checked: Boolean) {
        viewModelScope.launch { repository.setBiometricsRequiredForSigning(checked) }
    }
}
