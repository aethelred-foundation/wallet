package xyz.aethelred.wallet.core.transaction

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigInteger

/**
 * Unit tests for [RLP] using the vectors from the Ethereum yellow-paper's
 * Appendix B. Coverage: single-byte strings, short strings, short lists,
 * zero-integer edge case, access-list shape.
 */
class RLPTest {

    @Test
    fun emptyString_encodesToSingle0x80() {
        val bytes = RLP.encode(RLP.bytes(ByteArray(0)))
        assertArrayEquals(byteArrayOf(0x80.toByte()), bytes)
    }

    @Test
    fun singleByteLow_encodesToItself() {
        val bytes = RLP.encode(RLP.bytes(byteArrayOf(0x01)))
        assertArrayEquals(byteArrayOf(0x01), bytes)
    }

    @Test
    fun dog_encodesToShortString() {
        val bytes = RLP.encode(RLP.bytes("dog".encodeToByteArray()))
        // 0x83 (= 0x80 + 3) followed by 'd','o','g'.
        assertArrayEquals(byteArrayOf(0x83.toByte(), 0x64, 0x6f, 0x67), bytes)
    }

    @Test
    fun zeroInteger_isEmptyString() {
        val bytes = RLP.encode(RLP.integer(BigInteger.ZERO))
        assertArrayEquals(byteArrayOf(0x80.toByte()), bytes)
    }

    @Test
    fun smallInteger_encodesCompactly() {
        val bytes = RLP.encode(RLP.integer(BigInteger.valueOf(15)))
        assertArrayEquals(byteArrayOf(0x0f), bytes)
    }

    @Test
    fun shortList_catAndDog_matchesVector() {
        val list = RLP.list(
            listOf(
                RLP.bytes("cat".encodeToByteArray()),
                RLP.bytes("dog".encodeToByteArray()),
            ),
        )
        val bytes = RLP.encode(list)
        // 0xc8 = 0xc0 + 8 total body bytes: 0x83 + 'cat' + 0x83 + 'dog'.
        val expected = byteArrayOf(
            0xc8.toByte(),
            0x83.toByte(), 0x63, 0x61, 0x74,
            0x83.toByte(), 0x64, 0x6f, 0x67,
        )
        assertArrayEquals(expected, bytes)
    }

    @Test
    fun longString_usesLongFormPrefix() {
        val input = ByteArray(56) { 0x01 }
        val bytes = RLP.encode(RLP.bytes(input))
        // 0xb8 = 0x80 + 0x37 + 1 length byte, then 56, then 56 bytes.
        assertEquals(0xb8.toByte(), bytes[0])
        assertEquals(56.toByte(), bytes[1])
        assertEquals(56 + 2, bytes.size)
    }
}
