package xyz.aethelred.wallet.core.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the signing contracts. We don't have access to the
 * AndroidKeyStore inside a plain JVM test (that requires an instrumented
 * test), so the coverage here focuses on:
 *
 *  * Input validation — digest length, hex output format.
 *  * Keccak-256 correctness against the well-known empty-string vector.
 *  * Expected error cases from the stub keystore signer.
 */
class Secp256k1SignerTest {

    @Test
    fun keccak_emptyInput_matchesKnownVector() {
        val digest = Keccak256.digest(ByteArray(0))
        val hex = digest.joinToString("") { "%02x".format(it.toInt() and 0xFF) }
        // Pre-FIPS 202 Keccak-256("") vector.
        assertEquals(
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
            hex,
        )
    }

    @Test
    fun keccak_longInput_lengthIs32Bytes() {
        val bytes = ByteArray(256) { it.toByte() }
        val digest = Keccak256.digest(bytes)
        assertEquals(32, digest.size)
    }

    @Test
    fun signer_rejectsInvalidDigestSize() {
        val signer = KeyStoreSecp256k1Signer(keyStore = fakeKeyStore())
        assertThrows(IllegalArgumentException::class.java) {
            runBlockingSign(signer, "alias", ByteArray(16))
        }
    }

    @Test
    fun signer_withoutSecpImpl_reportsKeyUnavailable() {
        val signer = KeyStoreSecp256k1Signer(keyStore = fakeKeyStore())
        val ex = assertThrows(SigningException.KeyUnavailable::class.java) {
            runBlockingSign(signer, "alias", ByteArray(32))
        }
        assertTrue(ex.message!!.contains("secp256k1"))
    }

    private fun runBlockingSign(signer: Secp256k1Signer, alias: String, digest: ByteArray): String =
        kotlinx.coroutines.runBlocking { signer.sign(alias, digest) }

    private fun fakeKeyStore(): StrongBoxKeyStore {
        // The concrete class requires a Context. JVM tests don't have one,
        // so we hand-roll a minimum cast via reflection avoidance: the
        // code under test never touches the wrapped context.
        return Stubs.createNoopKeyStore()
    }
}

/**
 * Test-only factory so we can hand the signer a keystore instance that
 * returns `null` for every alias. Keeps us out of Android Context land
 * while still exercising the real class's error paths.
 */
private object Stubs {
    fun createNoopKeyStore(): StrongBoxKeyStore {
        // Constructing via reflection sidesteps the `@Inject` Context
        // parameter. This is a test-only shortcut.
        val ctor = StrongBoxKeyStore::class.java.declaredConstructors.first()
        ctor.isAccessible = true
        return ctor.newInstance(null) as StrongBoxKeyStore
    }
}
