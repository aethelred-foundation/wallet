package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.serialization.Serializable
import xyz.aethelred.wallet.data.SecureStore
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Well-known wallet push payload shape. Messages fan out to ViewModels
 * via [PushNotificationService.incomingMessages] so whichever surface is
 * active can route to the right destination.
 */
@Serializable
public data class WalletPushMessage(
    public val kind: Kind,
    public val payloadJson: String,
    public val receivedAt: Long = System.currentTimeMillis(),
) {
    /** Discriminator emitted by the control-plane. */
    @Serializable
    public enum class Kind {
        ApprovalRequest,
        TxConfirmed,
        TxFailed,
        SecurityAlert,
        NetworkAnnouncement,
        DelegationRevoked,
    }
}

/**
 * Firebase Cloud Messaging wrapper.
 *
 * FOLLOW-UP(android-team): wire `com.google.firebase:firebase-messaging-ktx`
 * and replace the in-memory token + message plumbing here with a true
 * `FirebaseMessagingService` receiver + device-token registration.
 *
 * The wallet keeps this interface stable so Crashlytics, analytics, and
 * the ApprovalsViewModel all consume the same typed SharedFlow today.
 */
@Singleton
public class PushNotificationService @Inject constructor(
    private val secureStore: SecureStore,
) {

    private val _incoming = MutableSharedFlow<WalletPushMessage>(replay = 8)

    /** Hot flow of push messages. */
    public val incomingMessages: SharedFlow<WalletPushMessage> = _incoming.asSharedFlow()

    /**
     * Return the currently-registered device token, or null when the
     * device hasn't completed FCM registration yet.
     */
    public fun currentDeviceToken(): String? = secureStore.readString(KEY_TOKEN)

    /**
     * Persist the FCM device token. Called from the
     * `FirebaseMessagingService.onNewToken` callback once the SDK is
     * wired in.
     */
    public fun updateDeviceToken(token: String) {
        secureStore.writeString(KEY_TOKEN, token)
        // Production: POST to /v1/devices/register so the control-plane
        // routes pushes to this device.
    }

    /** Clear the persisted token — used on explicit logout / reset flows. */
    public fun clearDeviceToken() {
        secureStore.delete(KEY_TOKEN)
    }

    /**
     * Handle a raw FCM payload. Invoked by the messaging-service bridge
     * once the SDK is wired. The payload is parsed, tagged, and emitted
     * on [incomingMessages].
     */
    public suspend fun handleIncomingPayload(kind: WalletPushMessage.Kind, payloadJson: String) {
        _incoming.emit(
            WalletPushMessage(
                kind = kind,
                payloadJson = payloadJson,
            ),
        )
    }

    private companion object {
        private const val KEY_TOKEN = "push.device_token"
    }
}
