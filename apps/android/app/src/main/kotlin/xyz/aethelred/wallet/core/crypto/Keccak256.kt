package xyz.aethelred.wallet.core.crypto

/**
 * Pure-Kotlin Keccak-256 (the pre-SHA3 variant that EVM uses for address
 * derivation, `eth_sign`, and RLP digests).
 *
 * Implementation notes:
 *  * Based on the canonical Keccak sponge described in the original
 *    submission to NIST (https://keccak.team/keccak_specs_summary.html).
 *  * The state is 25 lanes × 64 bits each. Padding follows the Keccak
 *    (pre-FIPS 202) rule: append `0x01`, zero-fill, and OR `0x80` into
 *    the last byte of the rate block.
 *
 * Android's `java.security.MessageDigest` DOES NOT ship Keccak-256
 * (Android Security Provider only offers SHA3-256, which uses a
 * different padding). That's why we hand-roll it here — no external
 * dependency, no BouncyCastle required.
 */
public object Keccak256 {

    private const val RATE_BYTES: Int = 136 // 1088 bits / 8
    private const val OUTPUT_BYTES: Int = 32 // 256 bits

    // Round constants. ULong hex literals above Long.MAX_VALUE are
    // converted bit-for-bit via `.toLong()`. These are standard Keccak-f[1600]
    // constants.
    private val ROUND_CONSTANTS: LongArray = longArrayOf(
        0x0000000000000001uL.toLong(),
        0x0000000000008082uL.toLong(),
        0x800000000000808auL.toLong(),
        0x8000000080008000uL.toLong(),
        0x000000000000808buL.toLong(),
        0x0000000080000001uL.toLong(),
        0x8000000080008081uL.toLong(),
        0x8000000000008009uL.toLong(),
        0x000000000000008auL.toLong(),
        0x0000000000000088uL.toLong(),
        0x0000000080008009uL.toLong(),
        0x000000008000000auL.toLong(),
        0x000000008000808buL.toLong(),
        0x800000000000008buL.toLong(),
        0x8000000000008089uL.toLong(),
        0x8000000000008003uL.toLong(),
        0x8000000000008002uL.toLong(),
        0x8000000000000080uL.toLong(),
        0x000000000000800auL.toLong(),
        0x800000008000000auL.toLong(),
        0x8000000080008081uL.toLong(),
        0x8000000000008080uL.toLong(),
        0x0000000080000001uL.toLong(),
        0x8000000080008008uL.toLong(),
    )

    private val ROTATION_OFFSETS: IntArray = intArrayOf(
        0, 1, 62, 28, 27,
        36, 44, 6, 55, 20,
        3, 10, 43, 25, 39,
        41, 45, 15, 21, 8,
        18, 2, 61, 56, 14,
    )

    /**
     * Compute the Keccak-256 digest of [input].
     *
     * @return 32-byte digest.
     */
    public fun digest(input: ByteArray): ByteArray {
        val state = LongArray(25)
        var offset = 0

        // Absorb full rate blocks.
        while (input.size - offset >= RATE_BYTES) {
            absorbBlock(state, input, offset)
            keccakF(state)
            offset += RATE_BYTES
        }

        // Padded final block.
        val tail = ByteArray(RATE_BYTES)
        val remaining = input.size - offset
        input.copyInto(tail, 0, offset, offset + remaining)
        tail[remaining] = 0x01 // Keccak pre-FIPS 202 padding domain marker
        tail[RATE_BYTES - 1] = (tail[RATE_BYTES - 1].toInt() or 0x80).toByte()
        absorbBlock(state, tail, 0)
        keccakF(state)

        // Squeeze.
        val out = ByteArray(OUTPUT_BYTES)
        for (i in 0 until OUTPUT_BYTES) {
            val lane = state[i / 8]
            val shift = 8 * (i % 8)
            out[i] = ((lane ushr shift) and 0xFF).toByte()
        }
        return out
    }

    private fun absorbBlock(state: LongArray, buf: ByteArray, offset: Int) {
        for (i in 0 until (RATE_BYTES / 8)) {
            var word = 0L
            for (b in 0 until 8) {
                word = word or ((buf[offset + i * 8 + b].toLong() and 0xFF) shl (8 * b))
            }
            state[i] = state[i] xor word
        }
    }

    private fun keccakF(a: LongArray) {
        for (round in 0 until 24) {
            // Theta.
            val c = LongArray(5)
            for (x in 0 until 5) {
                c[x] = a[x] xor a[x + 5] xor a[x + 10] xor a[x + 15] xor a[x + 20]
            }
            val d = LongArray(5)
            for (x in 0 until 5) {
                d[x] = c[(x + 4) % 5] xor java.lang.Long.rotateLeft(c[(x + 1) % 5], 1)
            }
            for (x in 0 until 5) {
                for (y in 0 until 5) {
                    a[x + 5 * y] = a[x + 5 * y] xor d[x]
                }
            }

            // Rho + Pi.
            val b = LongArray(25)
            for (x in 0 until 5) {
                for (y in 0 until 5) {
                    val idx = x + 5 * y
                    val rotated = java.lang.Long.rotateLeft(a[idx], ROTATION_OFFSETS[idx])
                    b[y + 5 * ((2 * x + 3 * y) % 5)] = rotated
                }
            }

            // Chi.
            for (x in 0 until 5) {
                for (y in 0 until 5) {
                    a[x + 5 * y] = b[x + 5 * y] xor (b[((x + 1) % 5) + 5 * y].inv() and b[((x + 2) % 5) + 5 * y])
                }
            }

            // Iota.
            a[0] = a[0] xor ROUND_CONSTANTS[round]
        }
    }
}
