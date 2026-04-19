package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import xyz.aethelred.wallet.core.audit.AuditCapture
import xyz.aethelred.wallet.core.audit.AuditEvent
import xyz.aethelred.wallet.core.audit.AuditEventKind
import xyz.aethelred.wallet.core.audit.FinalizedBatch
import xyz.aethelred.wallet.core.audit.MerkleBatch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Combined AuditCapture + MerkleBatch facade.
 *
 * Callers emit a single `record()` and the service:
 *   1. Appends the event to the hash-linked chain via [AuditCapture].
 *   2. Hands the event to [MerkleBatch] which opportunistically finalises
 *      a batch when the batch size or age threshold is hit.
 *   3. Publishes finalised batches on [finalisedBatches] so a background
 *      worker can ship them to the control-plane.
 *
 * The service owns a mutex so the TS-equivalent's "no interleaved events"
 * guarantee is preserved on Android.
 */
@Singleton
public class AuditService @Inject constructor(
    private val auditCapture: AuditCapture,
    private val merkleBatch: MerkleBatch,
) {

    private val mutex = Mutex()
    private val _finalised = MutableStateFlow<List<FinalizedBatch>>(emptyList())

    /** Observable list of finalised batches awaiting control-plane fanout. */
    public val finalisedBatches: StateFlow<List<FinalizedBatch>> = _finalised.asStateFlow()

    /**
     * Record an [AuditEvent] and opportunistically finalise its batch.
     *
     * @return The committed [AuditEvent].
     */
    public suspend fun record(
        kind: AuditEventKind,
        subjectId: String = "subject-local",
        workspaceId: String = "workspace-personal",
        appId: String? = null,
        sessionId: String? = null,
        intentId: String? = null,
        detail: Map<String, String> = emptyMap(),
    ): AuditEvent = mutex.withLock {
        val event = auditCapture.record(
            kind = kind,
            subjectId = subjectId,
            workspaceId = workspaceId,
            appId = appId,
            sessionId = sessionId,
            intentId = intentId,
            detail = detail,
        )
        merkleBatch.add(event)?.let { batch ->
            _finalised.value = _finalised.value + batch
        }
        event
    }

    /**
     * Force-flush the batch — called when the app backgrounds so a
     * batch of pending events doesn't sit unnotarised indefinitely.
     */
    public suspend fun flush(): FinalizedBatch? = mutex.withLock {
        merkleBatch.flush()?.also { batch ->
            _finalised.value = _finalised.value + batch
        }
    }

    /**
     * Mark batches as shipped after a successful control-plane POST. The
     * fanout worker calls this once the remote ack lands.
     */
    public suspend fun markShipped(ids: Set<String>): Unit = mutex.withLock {
        _finalised.value = _finalised.value.filterNot { it.batchId in ids }
    }
}
