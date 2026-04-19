package xyz.aethelred.wallet.core.transaction

import xyz.aethelred.wallet.core.crypto.Keccak256
import java.math.BigInteger

/**
 * Type-2 (EIP-1559) transaction envelope.
 *
 * The on-wire serialisation follows EIP-2718:
 *   `0x02 || rlp([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas,
 *                 gasLimit, to, value, data, accessList])`
 *
 * The signing digest is Keccak-256 of that exact payload — [signingHash].
 * Broadcast-ready transactions append the signature fields
 * `(v, r, s)` to the RLP list.
 *
 * Addresses are raw 20-byte values; the caller converts from `0x…` hex.
 */
public data class Eip1559Transaction(
    public val chainId: Long,
    public val nonce: BigInteger,
    public val maxPriorityFeePerGas: BigInteger,
    public val maxFeePerGas: BigInteger,
    public val gasLimit: BigInteger,
    public val to: ByteArray?,   // `null` = contract creation
    public val value: BigInteger,
    public val data: ByteArray = ByteArray(0),
    /**
     * EIP-2930 access list. Represented as pairs of
     * `(address, list-of-storage-keys)`. Empty by default.
     */
    public val accessList: List<Pair<ByteArray, List<ByteArray>>> = emptyList(),
) {

    init {
        require(chainId > 0) { "chainId must be positive" }
        require(nonce.signum() >= 0) { "nonce must be non-negative" }
        require(value.signum() >= 0) { "value must be non-negative" }
        to?.let { require(it.size == 20) { "to address must be 20 bytes" } }
    }

    /**
     * Assemble the RLP body without signature fields.
     */
    public fun serializeForSigning(): ByteArray {
        val items = listOf(
            RLP.integer(BigInteger.valueOf(chainId)),
            RLP.integer(nonce),
            RLP.integer(maxPriorityFeePerGas),
            RLP.integer(maxFeePerGas),
            RLP.integer(gasLimit),
            RLP.bytes(to ?: ByteArray(0)),
            RLP.integer(value),
            RLP.bytes(data),
            serializeAccessList(),
        )
        val body = RLP.encode(RLP.list(items))
        return byteArrayOf(TYPE_PREFIX) + body
    }

    /** Keccak-256 of [serializeForSigning]. What the secp256k1 signer consumes. */
    public fun signingHash(): ByteArray = Keccak256.digest(serializeForSigning())

    /**
     * Append the signature `(v, r, s)` and return the broadcast-ready
     * transaction envelope.
     *
     * @param v Parity bit — `0` or `1` for EIP-1559 (no chain-id mixing).
     * @param r First half of the compact signature.
     * @param s Second half.
     */
    public fun serializeSigned(v: BigInteger, r: BigInteger, s: BigInteger): ByteArray {
        val items = listOf(
            RLP.integer(BigInteger.valueOf(chainId)),
            RLP.integer(nonce),
            RLP.integer(maxPriorityFeePerGas),
            RLP.integer(maxFeePerGas),
            RLP.integer(gasLimit),
            RLP.bytes(to ?: ByteArray(0)),
            RLP.integer(value),
            RLP.bytes(data),
            serializeAccessList(),
            RLP.integer(v),
            RLP.integer(r),
            RLP.integer(s),
        )
        return byteArrayOf(TYPE_PREFIX) + RLP.encode(RLP.list(items))
    }

    private fun serializeAccessList(): RLP.Item {
        val entries: List<RLP.Item> = accessList.map { (address, keys) ->
            RLP.list(
                listOf(
                    RLP.bytes(address),
                    RLP.list(keys.map { RLP.bytes(it) }),
                ),
            )
        }
        return RLP.list(entries)
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is Eip1559Transaction) return false
        return chainId == other.chainId &&
            nonce == other.nonce &&
            maxPriorityFeePerGas == other.maxPriorityFeePerGas &&
            maxFeePerGas == other.maxFeePerGas &&
            gasLimit == other.gasLimit &&
            to.contentEqualsNullable(other.to) &&
            value == other.value &&
            data.contentEquals(other.data) &&
            accessList.size == other.accessList.size
    }

    override fun hashCode(): Int {
        var result = chainId.hashCode()
        result = 31 * result + nonce.hashCode()
        result = 31 * result + maxPriorityFeePerGas.hashCode()
        result = 31 * result + maxFeePerGas.hashCode()
        result = 31 * result + gasLimit.hashCode()
        result = 31 * result + (to?.contentHashCode() ?: 0)
        result = 31 * result + value.hashCode()
        result = 31 * result + data.contentHashCode()
        result = 31 * result + accessList.size
        return result
    }

    private companion object {
        private const val TYPE_PREFIX: Byte = 0x02
    }
}

private fun ByteArray?.contentEqualsNullable(other: ByteArray?): Boolean {
    if (this == null && other == null) return true
    if (this == null || other == null) return false
    return this.contentEquals(other)
}
