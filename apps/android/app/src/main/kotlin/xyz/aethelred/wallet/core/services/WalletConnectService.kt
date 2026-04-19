package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Pairing proposal received from a dApp.
 *
 * Mirrors the WalletConnect v2 `SessionProposal` payload. The fields the
 * wallet actually renders are captured here; the opaque blob lives under
 * [rawJson] for future schema extensions.
 */
@Serializable
public data class WalletConnectProposal(
    public val id: String,
    public val dappName: String,
    public val dappUrl: String,
    public val iconUrl: String? = null,
    public val requestedNamespaces: List<String>,
    public val requiredChains: List<String>,
    public val requiredMethods: List<String>,
    public val expiry: Long,
    public val rawJson: String,
)

/** Active session after the user approves a proposal. */
@Serializable
public data class WalletConnectSession(
    public val topic: String,
    public val dappName: String,
    public val dappUrl: String,
    public val namespaces: List<String>,
    public val accounts: List<String>,
    public val createdAt: Long,
    public val expiresAt: Long,
)

/** Pending signing request emitted by an active session. */
@Serializable
public data class WalletConnectRequest(
    public val id: String,
    public val sessionTopic: String,
    public val method: String,
    public val params: String,
    public val chainId: String,
)

/**
 * WalletConnect v2 session bridge.
 *
 * The real implementation wraps the Reown (formerly WalletConnect) v2 SDK:
 *   FOLLOW-UP(android-team): add `com.reown:sign` + `com.reown:core` deps and
 *   replace the in-memory stubs below with calls through
 *   `SignClient` + `CoreClient`. The interface here keeps the surface
 *   area stable so downstream navigators and audit wiring doesn't change
 *   when the SDK lands.
 *
 * Emits [proposals] and [requests] as hot flows so the navigation layer
 * can route to the appropriate approval surface the moment a message
 * arrives, regardless of which screen the user is on.
 */
@Singleton
public class WalletConnectService @Inject constructor() {

    private val mutex = Mutex()
    private val _sessions = MutableStateFlow<List<WalletConnectSession>>(emptyList())
    private val _proposals = MutableSharedFlow<WalletConnectProposal>(replay = 1)
    private val _requests = MutableSharedFlow<WalletConnectRequest>(replay = 1)

    /** Observable list of active sessions. */
    public val sessions: StateFlow<List<WalletConnectSession>> = _sessions.asStateFlow()

    /** Inbound session proposals (emitted by [injectProposal] until the SDK is wired). */
    public val proposals: SharedFlow<WalletConnectProposal> = _proposals.asSharedFlow()

    /** Inbound signing requests from active sessions. */
    public val requests: SharedFlow<WalletConnectRequest> = _requests.asSharedFlow()

    /**
     * Pair using a `wc://` URI. In the stub we just parse and emit a
     * proposal; the SDK takes this URI and runs the full relay handshake.
     */
    public suspend fun pair(uri: String) {
        val proposal = WalletConnectProposal(
            id = UUID.randomUUID().toString(),
            dappName = "Pending dApp",
            dappUrl = uri.substringAfter("wc:"),
            requestedNamespaces = listOf("eip155"),
            requiredChains = listOf("eip155:1"),
            requiredMethods = listOf("eth_sendTransaction", "personal_sign"),
            expiry = System.currentTimeMillis() + EXPIRY_MS,
            rawJson = "{\"uri\":\"$uri\"}",
        )
        _proposals.emit(proposal)
    }

    /**
     * Approve a proposal and install a session entry. The caller supplies
     * the accounts that were granted and the chain namespaces.
     */
    public suspend fun approveProposal(
        proposal: WalletConnectProposal,
        grantedAccounts: List<String>,
    ): WalletConnectSession = mutex.withLock {
        val session = WalletConnectSession(
            topic = "sess-" + UUID.randomUUID().toString(),
            dappName = proposal.dappName,
            dappUrl = proposal.dappUrl,
            namespaces = proposal.requestedNamespaces,
            accounts = grantedAccounts,
            createdAt = System.currentTimeMillis(),
            expiresAt = proposal.expiry,
        )
        _sessions.value = _sessions.value + session
        session
    }

    /** Reject a proposal. The SDK would notify the relay. */
    public suspend fun rejectProposal(proposal: WalletConnectProposal) {
        // No-op in the stub; the real SDK broadcasts a rejection message.
        @Suppress("UNUSED_PARAMETER")
        proposal
    }

    /** Revoke an active session. */
    public suspend fun disconnect(sessionTopic: String): Unit = mutex.withLock {
        _sessions.value = _sessions.value.filterNot { it.topic == sessionTopic }
    }

    /**
     * Test-only hook used while the Reown SDK is absent. Production code
     * should never call this; it exists so the ApprovalScreen integration
     * can be exercised end-to-end.
     */
    public suspend fun injectProposal(proposal: WalletConnectProposal) {
        _proposals.emit(proposal)
    }

    /** Test-only hook. */
    public suspend fun injectRequest(request: WalletConnectRequest) {
        _requests.emit(request)
    }

    private companion object {
        private const val EXPIRY_MS: Long = 7L * 24 * 60 * 60 * 1000
    }
}
