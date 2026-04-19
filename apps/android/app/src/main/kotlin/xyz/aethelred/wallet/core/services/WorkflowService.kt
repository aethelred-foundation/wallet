package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Quorum threshold descriptor.
 *
 * @property approversRequired Minimum number of approvers that must
 *                             consent before the workflow transitions to
 *                             `Approved`.
 * @property timeoutMs Window inside which approvers must respond.
 */
@Serializable
public data class QuorumPolicy(
    public val approversRequired: Int,
    public val timeoutMs: Long,
)

/** Status discriminator for [MultiSigWorkflow]. */
@Serializable
public enum class WorkflowStatus { Pending, Approved, Rejected, Expired }

/** Snapshot of a single approver's response. */
@Serializable
public data class ApproverResponse(
    public val approverId: String,
    public val decidedAt: Long,
    public val approved: Boolean,
)

/** Multi-sig approval workflow state. */
@Serializable
public data class MultiSigWorkflow(
    public val id: String,
    public val intentId: String,
    public val originator: String,
    public val intentSummary: String,
    public val quorumPolicy: QuorumPolicy,
    public val responses: List<ApproverResponse>,
    public val createdAt: Long,
    public val status: WorkflowStatus,
)

/**
 * Tracks multi-sig / quorum workflows until they resolve.
 *
 * The mobile wallet participates in two ways:
 *  1. As an approver — the user receives a push, renders the pending
 *     workflow here, and taps approve/reject.
 *  2. As the initiator — it creates the workflow and watches its status.
 *
 * This service in-memory stores; a future Room-backed implementation
 * replaces it without touching the ApprovalsListScreen / ApprovalsViewModel.
 */
@Singleton
public class WorkflowService @Inject constructor() {

    private val mutex = Mutex()
    private val _workflows = MutableStateFlow<List<MultiSigWorkflow>>(emptyList())

    /** Observable list. Approvals list UI collects here. */
    public val workflows: StateFlow<List<MultiSigWorkflow>> = _workflows.asStateFlow()

    /** Create a new workflow with the supplied quorum policy. */
    public suspend fun create(
        intentId: String,
        originator: String,
        intentSummary: String,
        policy: QuorumPolicy,
    ): MultiSigWorkflow = mutex.withLock {
        val workflow = MultiSigWorkflow(
            id = "wf-" + UUID.randomUUID().toString().take(12),
            intentId = intentId,
            originator = originator,
            intentSummary = intentSummary,
            quorumPolicy = policy,
            responses = emptyList(),
            createdAt = System.currentTimeMillis(),
            status = WorkflowStatus.Pending,
        )
        _workflows.value = _workflows.value + workflow
        workflow
    }

    /** Record an approver response and transition the workflow. */
    public suspend fun respond(
        workflowId: String,
        approverId: String,
        approved: Boolean,
    ): MultiSigWorkflow? = mutex.withLock {
        val current = _workflows.value
        val index = current.indexOfFirst { it.id == workflowId }
        if (index < 0) return@withLock null

        val existing = current[index]
        if (existing.status != WorkflowStatus.Pending) return@withLock existing

        val responses = existing.responses + ApproverResponse(
            approverId = approverId,
            decidedAt = System.currentTimeMillis(),
            approved = approved,
        )

        val approveCount = responses.count { it.approved }
        val rejectCount = responses.count { !it.approved }
        val nextStatus = when {
            approveCount >= existing.quorumPolicy.approversRequired -> WorkflowStatus.Approved
            rejectCount > 0 -> WorkflowStatus.Rejected
            else -> WorkflowStatus.Pending
        }

        val updated = existing.copy(responses = responses, status = nextStatus)
        _workflows.value = current.toMutableList().apply { set(index, updated) }
        updated
    }

    /** Mark expired workflows whose timeout has elapsed. */
    public suspend fun expireStale(now: Long = System.currentTimeMillis()): Int = mutex.withLock {
        var transitioned = 0
        _workflows.value = _workflows.value.map { wf ->
            if (wf.status == WorkflowStatus.Pending &&
                now - wf.createdAt > wf.quorumPolicy.timeoutMs
            ) {
                transitioned++
                wf.copy(status = WorkflowStatus.Expired)
            } else {
                wf
            }
        }
        transitioned
    }
}
