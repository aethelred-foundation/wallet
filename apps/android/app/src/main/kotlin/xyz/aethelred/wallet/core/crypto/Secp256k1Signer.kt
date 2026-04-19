package xyz.aethelred.wallet.core.crypto

/**
 * Abstract signing façade used by the transaction layer.
 *
 * Kept interface-only so the Android team can swap between the
 * AndroidKeyStore-backed implementation and a libsecp256k1 fallback
 * without the consumers caring. The keystore on older devices does not
 * expose `secp256k1` (only NIST P-256). The canonical production impl is
 * a native JNI bridge to
 * [fr.acinq.secp256k1:secp256k1-kmp](https://github.com/ACINQ/secp256k1-kmp)
 * or `org.bouncycastle:bcprov-jdk15on` — see the TODO in the stub
 * implementation below.
 */
public interface Secp256k1Signer {

    /**
     * Sign the supplied Keccak-256 digest with the private key identified
     * by [keyAlias].
     *
     * The implementation is responsible for:
     *  1. Materialising the biometric-gated `Signature` object.
     *  2. Producing a 65-byte compact signature (`r || s || v`).
     *
     * @param keyAlias AndroidKeyStore alias or (fallback-impl) wallet key id.
     * @param digest 32-byte pre-image hash.
     * @return Lower-cased hex of `r || s || v` suitable for EIP-155 assembly.
     * @throws SigningException on hardware failure or user cancellation.
     */
    public suspend fun sign(keyAlias: String, digest: ByteArray): String

    /**
     * Derive the EVM address for the public key bound to [keyAlias].
     *
     * @return Hex (`0x…`) Ethereum-style address.
     */
    public suspend fun address(keyAlias: String): String
}

/**
 * Sealed error hierarchy for signing. Consumers pattern-match on the
 * subclass so the UI layer knows whether to surface a retry CTA or a
 * hard "reset device" message.
 */
public sealed class SigningException(message: String, cause: Throwable? = null) :
    RuntimeException(message, cause) {

    /** The biometric prompt was dismissed or the authenticator timed out. */
    public class UserCancelled(message: String = "Signing cancelled.") : SigningException(message)

    /** AndroidKeyStore refused the operation because the key is gone. */
    public class KeyUnavailable(message: String, cause: Throwable? = null) :
        SigningException(message, cause)

    /** The underlying hardware is malfunctioning. */
    public class HardwareFailure(message: String, cause: Throwable? = null) :
        SigningException(message, cause)

    /** Any other unexpected error. */
    public class Unknown(cause: Throwable) :
        SigningException("Unknown signing failure: ${cause.message}", cause)
}

/**
 * Placeholder keystore-backed implementation.
 *
 * Android's `AndroidKeyStore` only natively supports `secp256r1`. The
 * Aethelred wallet needs `secp256k1`, which means this implementation
 * has two responsibilities:
 *
 *  1. **Root of trust** — a hardware-backed `secp256r1` "key-encryption
 *     key" (KEK) that wraps a `secp256k1` private key blob the wallet
 *     persists in EncryptedSharedPreferences. The KEK lives in StrongBox
 *     (or the TEE) and requires `setUserAuthenticationRequired(true)` so
 *     signing still forces a fresh biometric gesture.
 *  2. **Signer primitive** — a thin JNI shim into one of:
 *        * `fr.acinq.secp256k1:secp256k1-kmp` (preferred)
 *        * `org.bouncycastle:bcprov-jdk15on`
 *     that does the actual `secp256k1` ECDSA. Both libraries are
 *     intentionally NOT added to this scaffold so the Android team can
 *     make the crypto-review dependency choice explicitly.
 *
 * FOLLOW-UP(android-team): pick libsecp implementation + wire JNI signing
 * here. When that lands, this class should become stateless — the
 * wrapped private key is fetched per-call from [StrongBoxKeyStore] and
 * decrypted in-process only for the duration of [sign].
 */
public class KeyStoreSecp256k1Signer(
    private val keyStore: StrongBoxKeyStore,
) : Secp256k1Signer {

    override suspend fun sign(keyAlias: String, digest: ByteArray): String {
        require(digest.size == 32) { "secp256k1 digest must be 32 bytes" }
        // FOLLOW-UP(android-team): decrypt wrapped private key via StrongBoxKeyStore
        // and sign through secp256k1-kmp or BouncyCastle.
        throw SigningException.KeyUnavailable(
            "secp256k1 signer not implemented. Choose a JNI library and wire it here.",
        )
    }

    override suspend fun address(keyAlias: String): String {
        // FOLLOW-UP(android-team): derive public key, apply Keccak-256(pubkey[1..])[12..32]
        // and prefix with 0x.
        val pub = keyStore.publicKey(keyAlias)
            ?: throw SigningException.KeyUnavailable("No public key for alias $keyAlias.")
        val digest = Keccak256.digest(pub.copyOfRange(1, pub.size))
        val tail = digest.copyOfRange(digest.size - 20, digest.size)
        return "0x" + tail.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }
}
