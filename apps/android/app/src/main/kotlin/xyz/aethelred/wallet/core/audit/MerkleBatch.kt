package xyz.aethelred.wallet.core.audit

import java.security.MessageDigest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Per-event Merkle proof. Mirrors the TS `MerkleProof` interface.
 *
 * @property leaf Hex SHA-256 of the [AuditEvent.eventHash] bytes.
 * @property siblings Sibling hash at each level from leaf up to (but not including) the root.
 * @property directions `0` left / `1` right at each level. Aligned with [siblings].
 * @property root Hex Merkle root the proof verifies against.
 * @property leafIndex Zero-based position of the leaf in the finalised batch.
 */
public data class MerkleProof(
    public val leaf: String,
    public val siblings: List<String>,
    public val directions: List<Int>,
    public val root: String,
    public val leafIndex: Int,
)

/**
 * Finalised batch — the unit that eventually notarises to the Aethelred L1.
 * The `proofs` map is keyed by [AuditEvent.eventHash] so auditors can
 * retrieve the inclusion proof without knowing the leaf index.
 */
public data class FinalizedBatch(
    public val batchId: String,
    public val root: String,
    public val leafCount: Int,
    public val firstSequenceNumber: Long,
    public val lastSequenceNumber: Long,
    public val finalizedAt: Long,
    public val proofs: Map<String, MerkleProof>,
)

/**
 * Batching Merkle aggregator.
 *
 * Port of `packages/audit/src/merkle-batch.ts`. The algorithm:
 *  1. Each event contributes a leaf equal to SHA-256 of its hex [AuditEvent.eventHash].
 *  2. Internal nodes are SHA-256 of `left || right`.
 *  3. If a layer has an odd number of nodes, the last node is promoted
 *     unchanged (Bitcoin-style). That keeps verification simple with
 *     pure `(sibling, direction)` pairs.
 *
 * [add] auto-finalises when the batch hits [maxBatchSize] or when the
 * oldest pending event is older than [maxBatchAgeMs].
 */
@Singleton
public class MerkleBatch @Inject constructor() {

    private val maxBatchSize: Int = 256
    private val maxBatchAgeMs: Long = 60_000
    private val pending: MutableList<AuditEvent> = mutableListOf()
    private var oldestPendingAt: Long = Long.MAX_VALUE

    /**
     * Add an event. Returns a [FinalizedBatch] if the aggregator decides
     * the pending batch is ready to close; otherwise `null`.
     */
    public fun add(event: AuditEvent): FinalizedBatch? {
        if (pending.isEmpty()) oldestPendingAt = System.currentTimeMillis()
        pending += event

        val size = pending.size
        val age = System.currentTimeMillis() - oldestPendingAt
        return if (size >= maxBatchSize || age >= maxBatchAgeMs) flush() else null
    }

    /**
     * Force-close the current batch even if it hasn't reached the size /
     * age thresholds. Used when the app backgrounds — we notarise ASAP.
     *
     * Deliberately **not** named `finalize()` to avoid shadowing the
     * deprecated `Object#finalize`.
     *
     * @return `null` when there is nothing to flush.
     */
    public fun flush(): FinalizedBatch? {
        if (pending.isEmpty()) return null

        val leaves: List<ByteArray> = pending.map { sha256(it.eventHash.encodeToByteArray()) }
        val tree: List<List<ByteArray>> = buildTree(leaves)
        val root = tree.last().first()
        val proofs = pending.mapIndexed { index, event ->
            val proof = buildProof(tree, index, root)
            event.eventHash to proof
        }.toMap()

        val batch = FinalizedBatch(
            batchId = "batch-" + UUID.randomUUID().toString().take(16),
            root = root.toHex(),
            leafCount = pending.size,
            firstSequenceNumber = pending.first().sequenceNumber,
            lastSequenceNumber = pending.last().sequenceNumber,
            finalizedAt = System.currentTimeMillis(),
            proofs = proofs,
        )

        pending.clear()
        oldestPendingAt = Long.MAX_VALUE
        return batch
    }

    private fun buildTree(leaves: List<ByteArray>): List<List<ByteArray>> {
        val layers = mutableListOf(leaves)
        while (layers.last().size > 1) {
            val layer = layers.last()
            val next = ArrayList<ByteArray>((layer.size + 1) / 2)
            var i = 0
            while (i < layer.size) {
                val left = layer[i]
                val right = if (i + 1 < layer.size) layer[i + 1] else left
                next += sha256(left + right)
                i += 2
            }
            layers += next
        }
        return layers
    }

    private fun buildProof(tree: List<List<ByteArray>>, startIndex: Int, root: ByteArray): MerkleProof {
        val siblings = mutableListOf<String>()
        val directions = mutableListOf<Int>()
        var index = startIndex
        for (level in 0 until tree.size - 1) {
            val layer = tree[level]
            val pairIndex = if (index % 2 == 0) index + 1 else index - 1
            val sibling = if (pairIndex < layer.size) layer[pairIndex] else layer[index]
            siblings += sibling.toHex()
            directions += if (index % 2 == 0) 0 else 1
            index /= 2
        }
        val leafHex = tree.first()[startIndex].toHex()
        return MerkleProof(
            leaf = leafHex,
            siblings = siblings,
            directions = directions,
            root = root.toHex(),
            leafIndex = startIndex,
        )
    }

    private fun sha256(value: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(value)

    private fun ByteArray.toHex(): String =
        joinToString("") { "%02x".format(it.toInt() and 0xFF) }

    /**
     * Standalone verifier — useful for tests and tooling that receive a
     * proof without the tree. Mirrors `verifyMerkleProof` in TS.
     */
    public companion object {
        public fun verify(proof: MerkleProof): Boolean {
            var node = hexToBytes(proof.leaf)
            for (i in proof.siblings.indices) {
                val sibling = hexToBytes(proof.siblings[i])
                val digest = MessageDigest.getInstance("SHA-256")
                val combined = if (proof.directions[i] == 0) node + sibling else sibling + node
                node = digest.digest(combined)
            }
            return node.joinToString("") { "%02x".format(it.toInt() and 0xFF) } == proof.root
        }

        private fun hexToBytes(hex: String): ByteArray {
            require(hex.length % 2 == 0) { "odd-length hex string" }
            val out = ByteArray(hex.length / 2)
            for (i in out.indices) {
                out[i] = ((hex[i * 2].digitToInt(16) shl 4) or hex[i * 2 + 1].digitToInt(16)).toByte()
            }
            return out
        }
    }
}
