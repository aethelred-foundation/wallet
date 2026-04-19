package xyz.aethelred.wallet.core.identity

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import xyz.aethelred.wallet.data.SecureStore
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Type of credential the wallet knows about. Maps 1:1 onto the TS union.
 */
@Serializable
public enum class CredentialType { PASSWORD, PASSKEY, HARDWARE, CERTIFICATE, VERIFIABLE }

/**
 * Credential metadata. Note that no secret material lives here — the
 * actual key material stays inside the hardware keystore (for passkeys
 * and hardware), and only the reference is stored.
 */
@Serializable
public data class Credential(
    public val id: String,
    public val subjectId: String,
    public val type: CredentialType,
    public val label: String,
    public val issuedAt: Long,
    public val expiresAt: Long? = null,
    public val detail: Map<String, String> = emptyMap(),
)

/**
 * Encrypted-at-rest credential index. Persists into the wallet's
 * [SecureStore] (EncryptedSharedPreferences) so even a rooted attacker
 * with filesystem access can't read credential metadata without the
 * device's master key.
 */
@Singleton
public class CredentialStore @Inject constructor(
    private val secureStore: SecureStore,
) {

    private val json: Json = Json { ignoreUnknownKeys = true }
    private val wrapperSerializer = ListWrapper.serializer()

    /**
     * Persist [credential]. Replaces any existing record with the same id.
     */
    public fun upsert(credential: Credential) {
        val current = list().filterNot { it.id == credential.id } + credential
        secureStore.writeString(KEY, json.encodeToString(wrapperSerializer, ListWrapper(current)))
    }

    /**
     * Remove [credentialId]. Silently no-op if the credential isn't
     * present.
     */
    public fun remove(credentialId: String) {
        val current = list().filterNot { it.id == credentialId }
        secureStore.writeString(KEY, json.encodeToString(wrapperSerializer, ListWrapper(current)))
    }

    /** Return every credential in insertion order. */
    public fun list(): List<Credential> {
        val raw = secureStore.readString(KEY) ?: return emptyList()
        return runCatching { json.decodeFromString(wrapperSerializer, raw).items }
            .getOrDefault(emptyList())
    }

    @Serializable
    private data class ListWrapper(val items: List<Credential>)

    private companion object {
        private const val KEY = "credentials.v1"
    }
}
