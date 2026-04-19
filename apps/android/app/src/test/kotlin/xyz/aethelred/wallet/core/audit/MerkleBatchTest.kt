package xyz.aethelred.wallet.core.audit

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for [MerkleBatch]. We exercise both the happy path
 * (finalize-on-demand after a tiny burst of events) and the proof
 * verifier's correctness for every leaf.
 */
class MerkleBatchTest {

    @Test
    fun flush_returnsNull_whenEmpty() {
        val batch = MerkleBatch()
        assertNull(batch.flush())
    }

    @Test
    fun flush_emitsSingleLeafRoot() = runBlocking {
        val capture = AuditCapture()
        val a = capture.record(AuditEventKind.WALLET_INITIALIZED)

        val batch = MerkleBatch()
        batch.add(a)
        val finalized = batch.flush()

        assertNotNull(finalized)
        assertEquals(1, finalized!!.leafCount)
        assertEquals(a.sequenceNumber, finalized.firstSequenceNumber)
        assertEquals(a.sequenceNumber, finalized.lastSequenceNumber)
        assertTrue(MerkleBatch.verify(finalized.proofs.values.first()))
    }

    @Test
    fun flush_oddLeafCount_stillVerifies() = runBlocking {
        val capture = AuditCapture()
        val events = (0 until 5).map { capture.record(AuditEventKind.SIGNING_EXECUTED) }

        val batch = MerkleBatch()
        events.forEach { batch.add(it) }
        val finalized = batch.flush()

        assertNotNull(finalized)
        finalized!!.proofs.values.forEach { proof ->
            assertTrue("proof failed for leaf ${proof.leafIndex}", MerkleBatch.verify(proof))
        }
    }

    @Test
    fun flush_evenLeafCount_stillVerifies() = runBlocking {
        val capture = AuditCapture()
        val events = (0 until 8).map { capture.record(AuditEventKind.APPROVAL_DECIDED) }

        val batch = MerkleBatch()
        events.forEach { batch.add(it) }
        val finalized = batch.flush()

        assertNotNull(finalized)
        finalized!!.proofs.values.forEach { proof ->
            assertTrue(MerkleBatch.verify(proof))
        }
    }
}
