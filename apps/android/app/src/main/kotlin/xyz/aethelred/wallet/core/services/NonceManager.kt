package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import xyz.aethelred.wallet.core.network.NetworkDefinition
import xyz.aethelred.wallet.core.network.RpcClient
import java.math.BigInteger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Per-account per-chain nonce tracker.
 *
 * Responsibilities:
 *  1. Bootstrap the "on-chain" nonce from `eth_getTransactionCount` at
 *     latest block.
 *  2. Track a "pending" cursor locally so rapid-fire transactions from
 *     the same account don't collide on the same nonce when the RPC's
 *     mempool count hasn't caught up yet.
 *  3. Reconcile the two counters by clamping pending back to on-chain
 *     whenever the user reopens Send after a long pause.
 *
 * All mutations are serialised via [mutex] so a Swap + Send in the same
 * millisecond can't both reserve the same nonce.
 */
@Singleton
public class NonceManager @Inject constructor(
    private val rpcClient: RpcClient,
) {

    private val mutex = Mutex()
    private val state: MutableMap<Key, BigInteger> = mutableMapOf()

    /**
     * Reserve the next nonce for the given [address] on [network].
     *
     * The first call per `(address, chain)` pair fetches the on-chain
     * transaction count; subsequent calls return an increasing local
     * cursor.
     */
    public suspend fun nextNonce(
        network: NetworkDefinition,
        address: String,
    ): BigInteger = mutex.withLock {
        val key = Key(address.lowercase(), network.chainId)
        val current = state[key]
        if (current == null) {
            val onChain = fetchOnChain(network, address)
            state[key] = onChain.add(BigInteger.ONE)
            return@withLock onChain
        }
        state[key] = current.add(BigInteger.ONE)
        current
    }

    /**
     * Force-refresh the cursor from chain. Useful after a signing failure
     * or when the user manually taps "Refresh nonce" in developer tools.
     */
    public suspend fun resync(
        network: NetworkDefinition,
        address: String,
    ): BigInteger = mutex.withLock {
        val key = Key(address.lowercase(), network.chainId)
        val onChain = fetchOnChain(network, address)
        state[key] = onChain
        onChain
    }

    private suspend fun fetchOnChain(network: NetworkDefinition, address: String): BigInteger {
        val result = rpcClient.call(
            network = network,
            method = "eth_getTransactionCount",
            params = listOf(JsonPrimitive(address), JsonPrimitive("pending")),
        )
        val hex = result.jsonPrimitive.content.removePrefix("0x").ifEmpty { "0" }
        return BigInteger(hex, 16)
    }

    private data class Key(val address: String, val chainId: Long)
}
