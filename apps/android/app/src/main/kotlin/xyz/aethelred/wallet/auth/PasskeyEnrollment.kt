package xyz.aethelred.wallet.auth

import android.content.Context
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CredentialManager
import androidx.credentials.exceptions.CreateCredentialException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Result of a passkey enrollment attempt.
 */
public sealed class PasskeyEnrollmentResult {
    /** The user created a passkey. Returns the raw attestation blob. */
    public data class Success(public val attestationJson: String) : PasskeyEnrollmentResult()

    /** User cancelled or the authenticator refused. */
    public data class Failure(public val reason: String) : PasskeyEnrollmentResult()
}

/**
 * Thin wrapper around [CredentialManager] for enrolling a new passkey.
 *
 * Android 14+ supports passkeys via `androidx.credentials` with a
 * Google Play Services backend. The wallet uses this to bootstrap a
 * FIDO2-class second factor before hardware-backed signing kicks in —
 * the generated WebAuthn credential id is stored alongside the wallet
 * account in [xyz.aethelred.wallet.core.identity.CredentialStore].
 *
 * The attestation object is opaque on-device; it is submitted to the
 * control-plane for server-side attestation validation before the
 * credential is trusted. See the README "Production follow-ups" section.
 */
@Singleton
public class PasskeyEnrollment @Inject constructor() {

    /**
     * Kick off the enrollment UI. The [requestOptionsJson] argument is
     * the WebAuthn `PublicKeyCredentialCreationOptions` blob emitted by
     * the control-plane.
     */
    public suspend fun enroll(context: Context, requestOptionsJson: String): PasskeyEnrollmentResult {
        val manager = CredentialManager.create(context)
        val request = CreatePublicKeyCredentialRequest(requestJson = requestOptionsJson)
        return try {
            val response = manager.createCredential(context = context, request = request)
            // The Credential Manager API exposes a `registrationResponseJson` field
            // on the public-key subtype. Bundled serialization keeps the JSON
            // as the canonical on-wire representation.
            val serialised = response.data.getString(
                "androidx.credentials.BUNDLE_KEY_REGISTRATION_RESPONSE_JSON",
            ) ?: return PasskeyEnrollmentResult.Failure("Empty attestation bundle.")
            PasskeyEnrollmentResult.Success(serialised)
        } catch (error: CreateCredentialException) {
            PasskeyEnrollmentResult.Failure(error.message ?: error::class.java.simpleName)
        }
    }
}
