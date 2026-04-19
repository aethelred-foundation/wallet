package xyz.aethelred.wallet.core.crypto

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.KeyPairGenerator
import java.security.KeyStore
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Device-capability ranking for key generation.
 *
 * * [StrongBox] — isolated tamper-resistant hardware (e.g. Pixel Titan M,
 *   Samsung Knox vault). The highest assurance tier Android exposes.
 * * [Tee] — keys live inside the Trusted Execution Environment
 *   (ARM TrustZone et al). Widely available on Android 8+.
 * * [Software] — soft-backed keystore; the worst case. The wallet treats
 *   this as a warning state — signing is still allowed but the UX must
 *   surface a "device does not meet security baseline" banner.
 */
public enum class DeviceKeyPolicy { StrongBox, Tee, Software }

/**
 * Abstraction over AndroidKeyStore entries used by the signing layer.
 *
 * Holds three behaviours:
 *  1. Probe the device for the best available key-protection tier.
 *  2. Lazily create the wallet's root-of-trust key (KEK) on first use.
 *  3. Expose the public key bytes so the signer can derive addresses.
 *
 * Private keys never cross this boundary. All signing goes through the
 * [Secp256k1Signer] interface, which in turn delegates to the keystore
 * `Signature` object whose CryptoObject is unlocked by biometrics.
 */
@Singleton
public class StrongBoxKeyStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private val keystore: KeyStore by lazy {
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    }

    /**
     * Best tier the device supports. Called at app start to decide
     * whether to surface a "soft-backed keys" security banner.
     */
    public fun detectedPolicy(): DeviceKeyPolicy {
        val pm = context.packageManager
        val hasStrongBox = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_STRONGBOX_KEYSTORE)
        return when {
            hasStrongBox -> DeviceKeyPolicy.StrongBox
            pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_HARDWARE_KEYSTORE) ->
                DeviceKeyPolicy.Tee
            else -> DeviceKeyPolicy.Software
        }
    }

    /**
     * Ensure a key with [alias] exists. Generates one if missing.
     *
     * The key is:
     *  * Purpose [KeyProperties.PURPOSE_SIGN]
     *  * Curve secp256r1 (the only EC curve Android ships natively; the
     *    secp256k1 material is wrapped and stored separately — see
     *    [Secp256k1Signer] for the wrapping strategy).
     *  * User-authentication-required with a 0-second timeout → every
     *    signature requires a fresh biometric gesture.
     *  * StrongBox when available, falling back to TEE automatically
     *    per [setIsStrongBoxBacked].
     */
    public fun ensureKey(alias: String) {
        if (keystore.containsAlias(alias)) return

        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN,
        )
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
            .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
            .setUserAuthenticationRequired(true)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    setIsStrongBoxBacked(true)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    setUserAuthenticationParameters(
                        /* timeout = */ 0,
                        KeyProperties.AUTH_BIOMETRIC_STRONG,
                    )
                }
            }
            .build()

        try {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
                .apply { initialize(spec) }
                .generateKeyPair()
        } catch (strongBoxUnavailable: android.security.keystore.StrongBoxUnavailableException) {
            // Fall back to TEE-backed generation without StrongBox.
            val fallback = KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_SIGN,
            )
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                .setUserAuthenticationRequired(true)
                .build()
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
                .apply { initialize(fallback) }
                .generateKeyPair()
        }
    }

    /**
     * Return the DER-encoded public key for [alias], or `null` if it
     * doesn't exist.
     */
    public fun publicKey(alias: String): ByteArray? {
        val entry = keystore.getEntry(alias, null) as? KeyStore.PrivateKeyEntry ?: return null
        return entry.certificate.publicKey.encoded
    }

    private companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    }
}
