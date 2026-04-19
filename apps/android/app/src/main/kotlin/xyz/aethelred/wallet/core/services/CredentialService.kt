package xyz.aethelred.wallet.core.services

import kotlinx.serialization.Serializable
import xyz.aethelred.wallet.core.identity.Credential
import xyz.aethelred.wallet.core.identity.CredentialStore
import xyz.aethelred.wallet.core.identity.CredentialType
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Presentation request passed to the RegulatoryPassport screen.
 *
 * Mirrors the VP (Verifiable Presentation) request shape emitted by the
 * control-plane. The subset here is what the mobile UI renders.
 */
@Serializable
public data class PresentationRequest(
    public val id: String,
    public val audience: String,
    public val reason: String,
    public val requestedTypes: List<CredentialType>,
    public val expiresAt: Long,
)

/** Result of building a presentation. */
@Serializable
public data class PresentationResult(
    public val id: String,
    public val credentialsSubmitted: List<String>,
    public val envelopeJson: String,
    public val builtAt: Long,
)

/**
 * Verifiable credential lifecycle manager.
 *
 * Wraps the lower-level [CredentialStore] with operations the UI needs:
 *  * Enroll new credentials received from the control-plane.
 *  * Build a presentation envelope for regulators / dApps.
 *  * Revoke a credential when the user cancels consent.
 *
 * The envelope payload is intentionally stringly-typed for now — the
 * control-plane does the W3C VP framing on receipt. Building the JWT /
 * BBS+ proof on-device is a follow-up in line with the iOS team's
 * cadence.
 */
@Singleton
public class CredentialService @Inject constructor(
    private val credentialStore: CredentialStore,
) {

    /** Persist [credential] into the encrypted store. */
    public fun enroll(credential: Credential) {
        credentialStore.upsert(credential)
    }

    /** Revoke a stored credential by id. */
    public fun revoke(credentialId: String) {
        credentialStore.remove(credentialId)
    }

    /** All stored credentials in insertion order. */
    public fun list(): List<Credential> = credentialStore.list()

    /**
     * Build a presentation envelope for [request].
     *
     * Selects any credential whose [Credential.type] is included in
     * [PresentationRequest.requestedTypes]. Callers can override this
     * selection for custom flows.
     */
    public fun buildPresentation(
        request: PresentationRequest,
        preferredCredentialIds: List<String> = emptyList(),
    ): PresentationResult {
        val selected = list()
            .filter { it.type in request.requestedTypes }
            .filter { preferredCredentialIds.isEmpty() || it.id in preferredCredentialIds }

        val envelope = buildEnvelopeJson(request, selected)
        return PresentationResult(
            id = "pres-" + UUID.randomUUID().toString().take(16),
            credentialsSubmitted = selected.map { it.id },
            envelopeJson = envelope,
            builtAt = System.currentTimeMillis(),
        )
    }

    private fun buildEnvelopeJson(
        request: PresentationRequest,
        credentials: List<Credential>,
    ): String {
        // Deliberate minimal shape — the control-plane re-frames into a
        // full VP. Keeps on-device serialisation auditable at a glance.
        val ids = credentials.joinToString(",") { "\"${it.id}\"" }
        return "{\"requestId\":\"${request.id}\",\"credentialIds\":[$ids]}"
    }
}
