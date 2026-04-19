package xyz.aethelred.wallet.auth

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * Result returned by [BiometricUnlock.authenticate].
 *
 * @property isSuccess True when the authentication succeeded.
 * @property errorMessage Localised message suitable for surfacing in the
 *                        UI; `null` when [isSuccess] is true.
 */
public data class BiometricUnlockResult(
    public val isSuccess: Boolean,
    public val errorMessage: String? = null,
)

/**
 * Thin wrapper over androidx.biometric's [BiometricPrompt] that returns
 * a coroutine-friendly [BiometricUnlockResult].
 *
 * The prompt is instantiated with `BIOMETRIC_STRONG | DEVICE_CREDENTIAL`
 * — StrongBox-class biometrics preferred; falls back to PIN/pattern
 * when the device has no enrolled biometrics.
 *
 * Signing-time biometric auth is different: the signer attaches a
 * `CryptoObject(Signature)` to the prompt so the returned `Signature`
 * is bound to the biometric gesture. Unlock doesn't need that — the
 * purpose here is to flip the in-memory session flag inside
 * [xyz.aethelred.wallet.data.WalletStateRepository].
 */
public class BiometricUnlock(
    private val activity: FragmentActivity,
) {

    /** Probe whether a prompt will even be possible on this device. */
    public fun canAuthenticate(): Boolean {
        val biometricManager = BiometricManager.from(activity)
        val code = biometricManager.canAuthenticate(ALLOWED_AUTH)
        return code == BiometricManager.BIOMETRIC_SUCCESS
    }

    /**
     * Show the prompt and suspend until the user completes (or cancels) it.
     *
     * Cancellation of the coroutine cancels the prompt as well so the
     * sheet doesn't linger after navigation away.
     */
    public suspend fun authenticate(targetActivity: FragmentActivity = activity): BiometricUnlockResult =
        suspendCancellableCoroutine { continuation ->
            val executor = ContextCompat.getMainExecutor(targetActivity)
            val prompt = BiometricPrompt(
                targetActivity,
                executor,
                object : BiometricPrompt.AuthenticationCallback() {

                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (!continuation.isCompleted) {
                            continuation.resume(BiometricUnlockResult(isSuccess = true))
                        }
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (!continuation.isCompleted) {
                            continuation.resume(
                                BiometricUnlockResult(
                                    isSuccess = false,
                                    errorMessage = errString.toString(),
                                ),
                            )
                        }
                    }

                    override fun onAuthenticationFailed() {
                        // User tried a fingerprint and it didn't match —
                        // the prompt stays up. We just log and wait.
                    }
                },
            )

            val info = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock wallet")
                .setSubtitle("Authenticate with biometrics to resume signing.")
                .setAllowedAuthenticators(ALLOWED_AUTH)
                .setConfirmationRequired(false)
                .build()

            prompt.authenticate(info)

            continuation.invokeOnCancellation {
                prompt.cancelAuthentication()
            }
        }

    private companion object {
        private const val ALLOWED_AUTH =
            BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
    }
}
