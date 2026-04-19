package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

/** Tests for [WorkflowService]. */
public class WorkflowServiceTest {

    @Test
    public fun respondingReachesQuorum(): Unit = runTest {
        val service = WorkflowService()
        val workflow = service.create(
            intentId = "intent-1",
            originator = "dapp",
            intentSummary = "Transfer 1 ETH",
            policy = QuorumPolicy(approversRequired = 2, timeoutMs = 60_000),
        )
        val after1 = service.respond(workflow.id, "approver-1", approved = true)
        assertEquals(WorkflowStatus.Pending, after1?.status)
        val after2 = service.respond(workflow.id, "approver-2", approved = true)
        assertEquals(WorkflowStatus.Approved, after2?.status)
    }

    @Test
    public fun singleRejectionFails(): Unit = runTest {
        val service = WorkflowService()
        val workflow = service.create(
            intentId = "intent-1",
            originator = "dapp",
            intentSummary = "Transfer 1 ETH",
            policy = QuorumPolicy(approversRequired = 2, timeoutMs = 60_000),
        )
        val after = service.respond(workflow.id, "approver-1", approved = false)
        assertEquals(WorkflowStatus.Rejected, after?.status)
    }

    @Test
    public fun expireStaleTransitionsPending(): Unit = runTest {
        val service = WorkflowService()
        service.create(
            intentId = "intent-1",
            originator = "dapp",
            intentSummary = "Transfer 1 ETH",
            policy = QuorumPolicy(approversRequired = 2, timeoutMs = 1),
        )
        val now = System.currentTimeMillis() + 10_000
        val expired = service.expireStale(now)
        assertNotNull(expired)
    }
}
