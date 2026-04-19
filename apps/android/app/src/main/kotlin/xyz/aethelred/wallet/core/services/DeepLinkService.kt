package xyz.aethelred.wallet.core.services

import android.content.Intent
import android.net.Uri
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Closed hierarchy of deep-link destinations the wallet knows how to route.
 *
 * Every path the manifest advertises must have a branch here so the
 * navigator pattern-matches without a catch-all.
 */
public sealed class DeepLinkTarget {
    /** WalletConnect pairing URI (`wc:<topic>@2?relay-protocol=…`). */
    public data class WalletConnect(public val uri: String) : DeepLinkTarget()

    /** Send flow pre-filled with recipient + optional amount. */
    public data class Send(public val recipient: String, public val amount: String?) : DeepLinkTarget()

    /** Approval sheet opened for a specific pending request. */
    public data class Approval(public val id: String) : DeepLinkTarget()

    /** Account detail opened for a specific account. */
    public data class Account(public val accountId: String) : DeepLinkTarget()

    /** Catch-all fallback for unrecognised URIs — navigator shows Home. */
    public data object Unknown : DeepLinkTarget()
}

/**
 * URI parser + intent builder.
 *
 * The manifest registers the scheme filters; this class turns
 * the raw [Uri] into a typed [DeepLinkTarget]. Putting the parsing in
 * one place makes it unit-testable without a device.
 */
@Singleton
public class DeepLinkService @Inject constructor() {

    /** Parse an arbitrary [Uri] or `null` if the scheme isn't ours. */
    public fun parse(uri: Uri?): DeepLinkTarget {
        if (uri == null) return DeepLinkTarget.Unknown
        return when (uri.scheme?.lowercase()) {
            SCHEME_WC -> DeepLinkTarget.WalletConnect(uri.toString())
            SCHEME_AETHELRED -> parseAethelred(uri)
            else -> DeepLinkTarget.Unknown
        }
    }

    /** Convenience wrapper so callers can hand over an [Intent] directly. */
    public fun parse(intent: Intent?): DeepLinkTarget = parse(intent?.data)

    private fun parseAethelred(uri: Uri): DeepLinkTarget {
        // `aethelred://wallet/...`
        val host = uri.host?.lowercase() ?: return DeepLinkTarget.Unknown
        val segments = uri.pathSegments
        return when (host) {
            HOST_WALLET -> when (segments.firstOrNull()) {
                PATH_SEND -> DeepLinkTarget.Send(
                    recipient = uri.getQueryParameter(QUERY_RECIPIENT).orEmpty(),
                    amount = uri.getQueryParameter(QUERY_AMOUNT),
                )
                PATH_APPROVAL -> DeepLinkTarget.Approval(
                    id = segments.getOrNull(1).orEmpty(),
                )
                PATH_ACCOUNT -> DeepLinkTarget.Account(
                    accountId = segments.getOrNull(1).orEmpty(),
                )
                else -> DeepLinkTarget.Unknown
            }
            HOST_WC -> DeepLinkTarget.WalletConnect(
                uri = uri.getQueryParameter(QUERY_URI).orEmpty(),
            )
            else -> DeepLinkTarget.Unknown
        }
    }

    /**
     * Build an outgoing share intent for [target]. Used by the
     * `account-detail` screen's "Share" action to generate a deep link
     * that re-opens the recipient in their Aethelred wallet.
     */
    public fun intentFor(target: DeepLinkTarget): Intent {
        val uri = when (target) {
            is DeepLinkTarget.WalletConnect ->
                Uri.parse("$SCHEME_AETHELRED://$HOST_WC?uri=" + target.uri)
            is DeepLinkTarget.Send ->
                Uri.parse("$SCHEME_AETHELRED://$HOST_WALLET/$PATH_SEND?recipient=${target.recipient}")
            is DeepLinkTarget.Approval ->
                Uri.parse("$SCHEME_AETHELRED://$HOST_WALLET/$PATH_APPROVAL/${target.id}")
            is DeepLinkTarget.Account ->
                Uri.parse("$SCHEME_AETHELRED://$HOST_WALLET/$PATH_ACCOUNT/${target.accountId}")
            DeepLinkTarget.Unknown ->
                Uri.parse("$SCHEME_AETHELRED://$HOST_WALLET")
        }
        return Intent(Intent.ACTION_VIEW, uri)
    }

    internal companion object {
        internal const val SCHEME_WC: String = "wc"
        internal const val SCHEME_AETHELRED: String = "aethelred"
        internal const val HOST_WALLET: String = "wallet"
        internal const val HOST_WC: String = "wc"
        internal const val PATH_SEND: String = "send"
        internal const val PATH_APPROVAL: String = "approval"
        internal const val PATH_ACCOUNT: String = "account"
        internal const val QUERY_RECIPIENT: String = "recipient"
        internal const val QUERY_AMOUNT: String = "amount"
        internal const val QUERY_URI: String = "uri"
    }
}
