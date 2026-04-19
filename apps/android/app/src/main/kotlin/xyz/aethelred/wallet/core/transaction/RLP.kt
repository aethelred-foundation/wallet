package xyz.aethelred.wallet.core.transaction

import java.math.BigInteger

/**
 * Recursive Length Prefix (RLP) encoder — the canonical Ethereum
 * serialisation used for legacy and EIP-1559 transactions.
 *
 * This is a minimal encoder (no decoder needed on-device) limited to
 * the shapes the wallet actually produces:
 *
 *  * byte strings  → [encodeBytes]
 *  * big integers  → [encodeBigInteger] (wrapped as leading-zero-stripped bytes)
 *  * lists of RLPItem → [encodeList]
 *
 * Spec reference: https://ethereum.org/en/developers/docs/data-structures-and-encoding/rlp/
 */
public object RLP {

    /**
     * Tagged union for RLP values. Consumers build a tree and hand it to
     * [encode]. Constructors are `internal` so only the helper
     * [bytes] / [integer] / [list] factories are used — keeps the ABI
     * stable even if the sealed hierarchy grows.
     */
    public sealed class Item {
        internal class Bytes(val value: ByteArray) : Item()
        internal class Integer(val value: BigInteger) : Item()
        internal class Seq(val children: List<Item>) : Item()
    }

    /** Wrap a raw byte string. */
    public fun bytes(value: ByteArray): Item = Item.Bytes(value)

    /** Wrap a non-negative [BigInteger]. */
    public fun integer(value: BigInteger): Item {
        require(value.signum() >= 0) { "RLP integers must be non-negative." }
        return Item.Integer(value)
    }

    /** Wrap a nested list. */
    public fun list(children: List<Item>): Item = Item.Seq(children)

    /** Encode an arbitrary [Item] tree. */
    public fun encode(item: Item): ByteArray = when (item) {
        is Item.Bytes -> encodeBytes(item.value)
        is Item.Integer -> encodeInteger(item.value)
        is Item.Seq -> encodeList(item.children)
    }

    private fun encodeBytes(value: ByteArray): ByteArray {
        if (value.size == 1 && (value[0].toInt() and 0xFF) < 0x80) return value
        return prefix(0x80, value)
    }

    private fun encodeInteger(value: BigInteger): ByteArray {
        if (value.signum() == 0) return byteArrayOf(0x80.toByte())
        val bytes = value.toByteArray()
        val trimmed = if (bytes.size > 1 && bytes[0] == 0.toByte()) bytes.copyOfRange(1, bytes.size) else bytes
        return encodeBytes(trimmed)
    }

    private fun encodeList(children: List<Item>): ByteArray {
        val body = children.fold(ByteArray(0)) { acc, child -> acc + encode(child) }
        return prefix(0xC0, body)
    }

    /**
     * Append the length header described by the RLP spec for either a
     * single byte string ([baseTag] = 0x80) or a list ([baseTag] = 0xC0).
     */
    private fun prefix(baseTag: Int, payload: ByteArray): ByteArray {
        return if (payload.size < 56) {
            byteArrayOf((baseTag + payload.size).toByte()) + payload
        } else {
            val lengthBytes = encodeLength(payload.size)
            byteArrayOf((baseTag + 0x37 + lengthBytes.size).toByte()) + lengthBytes + payload
        }
    }

    private fun encodeLength(length: Int): ByteArray {
        var value = length
        val out = ArrayDeque<Byte>()
        while (value > 0) {
            out.addFirst((value and 0xFF).toByte())
            value = value ushr 8
        }
        return out.toByteArray()
    }
}
