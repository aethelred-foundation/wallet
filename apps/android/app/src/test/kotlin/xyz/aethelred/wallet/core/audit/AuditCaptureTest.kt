package xyz.aethelred.wallet.core.audit

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for [AuditCapture]. Asserts that:
 *
 *  1. Sequence numbers start at zero and increment monotonically.
 *  2. Every event's hash is unique.
 *  3. `previousHash` chains match the predecessor's `eventHash`.
 *  4. [AuditCapture.verifyChain] detects tampering.
 */
class AuditCaptureTest {

    @Test
    fun sequenceNumbers_areMonotonic() = runBlocking {
        val capture = AuditCapture()
        val a = capture.record(AuditEventKind.WALLET_INITIALIZED)
        val b = capture.record(AuditEventKind.ACCOUNT_CREATED, detail = mapOf("id" to "1"))
        val c = capture.record(AuditEventKind.KEY_GENERATED, detail = mapOf("alg" to "secp256k1"))

        assertEquals(0L, a.sequenceNumber)
        assertEquals(1L, b.sequenceNumber)
        assertEquals(2L, c.sequenceNumber)
    }

    @Test
    fun eventHashes_areUniquePerEvent() = runBlocking {
        val capture = AuditCapture()
        val a = capture.record(AuditEventKind.WALLET_INITIALIZED)
        val b = capture.record(AuditEventKind.WALLET_INITIALIZED)
        assertNotEquals(a.eventHash, b.eventHash)
    }

    @Test
    fun previousHash_chainsCorrectly() = runBlocking {
        val capture = AuditCapture()
        val a = capture.record(AuditEventKind.WALLET_INITIALIZED)
        val b = capture.record(AuditEventKind.ACCOUNT_CREATED)
        assertEquals(a.eventHash, b.previousHash)
    }

    @Test
    fun verifyChain_returnsTrueOnUntamperedLog() = runBlocking {
        val capture = AuditCapture()
        capture.record(AuditEventKind.WALLET_INITIALIZED)
        capture.record(AuditEventKind.ACCOUNT_CREATED)
        capture.record(AuditEventKind.KEY_GENERATED)
        assertTrue(capture.verifyChain())
    }

    @Test
    fun verifyChain_detectsTamperedEvent() = runBlocking {
        val capture = AuditCapture()
        capture.record(AuditEventKind.WALLET_INITIALIZED)
        capture.record(AuditEventKind.ACCOUNT_CREATED)

        // Reach into the private backing flow via reflection and mutate
        // one of the events so we can verify the tamper-detection path.
        val eventsField = capture.javaClass.getDeclaredField("_events").apply { isAccessible = true }

        @Suppress("UNCHECKED_CAST")
        val flow = eventsField.get(capture) as kotlinx.coroutines.flow.MutableStateFlow<List<AuditEvent>>
        val original = flow.value
        val tampered = original.mapIndexed { index, event ->
            if (index == 0) event.copy(detail = mapOf("malicious" to "yes")) else event
        }
        flow.value = tampered

        assertFalse(capture.verifyChain())
    }
}
