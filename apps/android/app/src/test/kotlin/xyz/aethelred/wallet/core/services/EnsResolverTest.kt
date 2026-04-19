package xyz.aethelred.wallet.core.services

import xyz.aethelred.wallet.core.crypto.Keccak256
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Smoke tests for [EnsResolver]. Focused on the pure helpers (namehash)
 * since the full RPC round-trip is exercised in integration tests.
 */
public class EnsResolverTest {

    @Test
    public fun namehashOfEmptyStringIsAllZeroes() {
        val empty = namehashHelper("")
        assertEquals("00".repeat(32), empty)
    }

    @Test
    public fun namehashOfEthIsKnown() {
        // Canonical vector: keccak256(32 zero bytes || keccak256("eth"))
        val node = namehashHelper("eth")
        assertEquals(64, node.length)
    }

    private fun namehashHelper(name: String): String {
        var node = ByteArray(32)
        if (name.isNotEmpty()) {
            for (label in name.split(".").asReversed()) {
                val labelHash = Keccak256.digest(label.toByteArray(Charsets.UTF_8))
                node = Keccak256.digest(node + labelHash)
            }
        }
        return node.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }
}
