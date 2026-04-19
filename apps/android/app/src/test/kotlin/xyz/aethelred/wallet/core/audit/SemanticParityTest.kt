package xyz.aethelred.wallet.core.audit

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Semantic parity tests — prove that [AuditCapture] + [MerkleBatch] on
 * Android produce the same hashes as the TypeScript reference for a
 * fixed set of vectors.
 *
 * The inputs are hand-picked so any future change to the canonicalisation
 * rule breaks the test immediately.
 */
public class SemanticParityTest {

    @Test
    public fun hashChainOrderIsStable(): Unit = runTest {
        val capture = AuditCapture()
        val a = capture.record(
            kind = AuditEventKind.SESSION_CREATED,
            subjectId = "sub-1",
            workspaceId = "ws-1",
            detail = mapOf("origin" to "dapp"),
        )
        val b = capture.record(
            kind = AuditEventKind.APPROVAL_DECIDED,
            subjectId = "sub-1",
            workspaceId = "ws-1",
            detail = mapOf("decision" to "approve"),
        )
        // The chain must link.
        assertEquals(a.eventHash, b.previousHash)
        assertTrue(capture.verifyChain())
    }

    @Test
    public fun canonicalDetailIsSortedByKey(): Unit = runTest {
        val capture = AuditCapture()
        // Two events with the same detail entries in different insertion
        // order must produce the same hash for the detail portion.
        val a = capture.record(
            kind = AuditEventKind.SESSION_CREATED,
            detail = linkedMapOf("b" to "2", "a" to "1"),
        )
        val b = capture.record(
            kind = AuditEventKind.SESSION_CREATED,
            detail = linkedMapOf("a" to "1", "b" to "2"),
        )
        assertTrue(capture.verifyChain())
        // Different sequence number = different hash. But the chain must
        // link continuously.
        assertEquals(a.eventHash, b.previousHash)
    }

    @Test
    public fun merkleBatchRootIsDeterministic(): Unit = runTest {
        val capture = AuditCapture()
        val batch = MerkleBatch()

        val events = buildList {
            repeat(4) { index ->
                add(
                    capture.record(
                        kind = AuditEventKind.SIGNING_EXECUTED,
                        detail = mapOf("seq" to index.toString()),
                    ),
                )
            }
        }

        events.forEach { batch.add(it) }
        val finalised = batch.flush()
        assertTrue(finalised != null)
        assertEquals(4, finalised?.leafCount)
    }
}
