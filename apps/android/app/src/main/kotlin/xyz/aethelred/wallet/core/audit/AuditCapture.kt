package xyz.aethelred.wallet.core.audit

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * In-memory hash-linked audit log.
 *
 * Behaviour:
 *  * Every event gets a monotonically increasing [AuditEvent.sequenceNumber].
 *  * [AuditEvent.previousHash] points at the previous event's [AuditEvent.eventHash],
 *    so any tampering breaks the chain the way the TS `EventCapture` does.
 *  * [AuditEvent.eventHash] is the SHA-256 of the canonical serialisation
 *    described below. [verifyChain] replays the chain to confirm integrity.
 *
 * Canonical serialisation (order-sensitive):
 *   id | sequenceNumber | timestamp | kind.wire |
 *   subjectId | workspaceId | appId? | sessionId? | intentId? |
 *   detail(sortedByKey) | previousHash
 *
 * All components are joined by the `\u001E` RS separator so a colon
 * inside a value never collides with the delimiter.
 */
@Singleton
public class AuditCapture @Inject constructor() {

    private val mutex = Mutex()
    private val _events = MutableStateFlow<List<AuditEvent>>(emptyList())

    /** Observable log — screens can reuse for activity feeds. */
    public val events: StateFlow<List<AuditEvent>> = _events.asStateFlow()

    private var lastHash: String = GENESIS_HASH
    private var lastSequence: Long = -1L

    /**
     * Record a new event. Returns the committed [AuditEvent] so callers
     * can surface the event hash in a receipt UI.
     */
    public suspend fun record(
        kind: AuditEventKind,
        subjectId: String = DEFAULT_SUBJECT,
        workspaceId: String = DEFAULT_WORKSPACE,
        appId: String? = null,
        sessionId: String? = null,
        intentId: String? = null,
        detail: Map<String, String> = emptyMap(),
    ): AuditEvent = mutex.withLock {
        val seq = lastSequence + 1
        val now = System.currentTimeMillis()
        val id = "evt-" + UUID.randomUUID().toString()

        val preImage = canonicalise(
            id = id,
            sequence = seq,
            timestamp = now,
            kind = kind,
            subjectId = subjectId,
            workspaceId = workspaceId,
            appId = appId,
            sessionId = sessionId,
            intentId = intentId,
            detail = detail,
            previousHash = lastHash,
        )
        val hash = sha256Hex(preImage)

        val event = AuditEvent(
            id = id,
            sequenceNumber = seq,
            timestamp = now,
            kind = kind,
            subjectId = subjectId,
            workspaceId = workspaceId,
            appId = appId,
            sessionId = sessionId,
            intentId = intentId,
            detail = detail,
            previousHash = lastHash,
            eventHash = hash,
        )

        lastHash = hash
        lastSequence = seq
        _events.value = _events.value + event
        return event
    }

    /**
     * Replay the chain and confirm every event's hash + linkage. Returns
     * `true` if the log is pristine.
     */
    public fun verifyChain(): Boolean {
        var previous = GENESIS_HASH
        for ((index, event) in _events.value.withIndex()) {
            if (event.sequenceNumber != index.toLong()) return false
            if (event.previousHash != previous) return false

            val preImage = canonicalise(
                id = event.id,
                sequence = event.sequenceNumber,
                timestamp = event.timestamp,
                kind = event.kind,
                subjectId = event.subjectId,
                workspaceId = event.workspaceId,
                appId = event.appId,
                sessionId = event.sessionId,
                intentId = event.intentId,
                detail = event.detail,
                previousHash = event.previousHash,
            )
            val expected = sha256Hex(preImage)
            if (expected != event.eventHash) return false
            previous = expected
        }
        return true
    }

    @Suppress("LongParameterList")
    private fun canonicalise(
        id: String,
        sequence: Long,
        timestamp: Long,
        kind: AuditEventKind,
        subjectId: String,
        workspaceId: String,
        appId: String?,
        sessionId: String?,
        intentId: String?,
        detail: Map<String, String>,
        previousHash: String,
    ): ByteArray {
        val detailPart = detail.toSortedMap().entries.joinToString(",") { (k, v) -> "$k=$v" }
        val parts = listOf(
            id,
            sequence.toString(),
            timestamp.toString(),
            kind.wire,
            subjectId,
            workspaceId,
            appId.orEmpty(),
            sessionId.orEmpty(),
            intentId.orEmpty(),
            detailPart,
            previousHash,
        )
        return parts.joinToString(separator = "\u001E").encodeToByteArray()
    }

    private fun sha256Hex(input: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(input)
        return digest.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }

    private companion object {
        private const val GENESIS_HASH: String =
            "0000000000000000000000000000000000000000000000000000000000000000"
        private const val DEFAULT_SUBJECT: String = "subject-local"
        private const val DEFAULT_WORKSPACE: String = "workspace-personal"
    }
}
