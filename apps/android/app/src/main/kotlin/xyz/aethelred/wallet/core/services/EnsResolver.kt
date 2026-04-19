package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import xyz.aethelred.wallet.core.crypto.Keccak256
import xyz.aethelred.wallet.core.network.NetworkDefinition
import xyz.aethelred.wallet.core.network.RpcClient
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Forward + reverse ENS resolver.
 *
 * Works strictly on-chain; no third-party resolver service needed. The
 * contract address matches the Ethereum mainnet ENS registry, which is
 * also deployed on Goerli + Sepolia at the same address for testing.
 *
 * Caches both directions for [CACHE_TTL_MS] since names change rarely;
 * this keeps the Send screen responsive as the user types.
 */
@Singleton
public class EnsResolver @Inject constructor(
    private val rpcClient: RpcClient,
) {

    private val mutex = Mutex()
    private val forwardCache: MutableMap<String, String?> = mutableMapOf()
    private val reverseCache: MutableMap<String, String?> = mutableMapOf()
    private val expiry: MutableMap<String, Long> = mutableMapOf()

    /**
     * Resolve `name.eth` to an EVM address, or null if no record exists.
     */
    public suspend fun resolveForward(
        network: NetworkDefinition,
        name: String,
    ): String? = mutex.withLock {
        val key = "fwd:${name.lowercase()}"
        expireStale(key)
        forwardCache[key]?.let { return@withLock it }

        val node = namehash(name)
        val resolver = fetchResolver(network, node) ?: return@withLock null
        val address = fetchAddress(network, resolver, node)
        forwardCache[key] = address
        expiry[key] = System.currentTimeMillis() + CACHE_TTL_MS
        address
    }

    /**
     * Reverse-resolve `0x…` to `name.eth`, or null when no reverse record
     * exists. Callers should defer this to the Receive screen only — it's
     * expensive to run on a live typing path.
     */
    public suspend fun resolveReverse(
        network: NetworkDefinition,
        address: String,
    ): String? = mutex.withLock {
        val key = "rev:${address.lowercase()}"
        expireStale(key)
        reverseCache[key]?.let { return@withLock it }

        val reverseName = address.lowercase().removePrefix("0x") + ".addr.reverse"
        val node = namehash(reverseName)
        val resolver = fetchResolver(network, node) ?: return@withLock null
        val name = fetchName(network, resolver, node)
        reverseCache[key] = name
        expiry[key] = System.currentTimeMillis() + CACHE_TTL_MS
        name
    }

    private fun expireStale(key: String) {
        val expiresAt = expiry[key] ?: return
        if (System.currentTimeMillis() > expiresAt) {
            forwardCache.remove(key)
            reverseCache.remove(key)
            expiry.remove(key)
        }
    }

    private suspend fun fetchResolver(network: NetworkDefinition, node: ByteArray): String? {
        val calldata = SELECTOR_RESOLVER + node.toHex()
        return callStaticAddress(network, ENS_REGISTRY, calldata)
    }

    private suspend fun fetchAddress(
        network: NetworkDefinition,
        resolver: String,
        node: ByteArray,
    ): String? {
        val calldata = SELECTOR_ADDR + node.toHex()
        return callStaticAddress(network, resolver, calldata)
    }

    private suspend fun fetchName(
        network: NetworkDefinition,
        resolver: String,
        node: ByteArray,
    ): String? {
        val calldata = SELECTOR_NAME + node.toHex()
        val hex = callStaticString(network, resolver, calldata) ?: return null
        return hex.trim().takeIf { it.isNotEmpty() }
    }

    private suspend fun callStaticAddress(
        network: NetworkDefinition,
        to: String,
        calldata: String,
    ): String? {
        val params = buildJsonObject {
            put("to", to)
            put("data", calldata)
        }
        return runCatching {
            val result = rpcClient.call(
                network = network,
                method = "eth_call",
                params = listOf(params, JsonPrimitive("latest")),
            )
            val raw = result.jsonPrimitive.content.removePrefix("0x")
            if (raw.length < 40) null else "0x" + raw.takeLast(40)
        }.getOrNull()?.takeUnless { it.replace("0", "").isEmpty() }
    }

    private suspend fun callStaticString(
        network: NetworkDefinition,
        to: String,
        calldata: String,
    ): String? {
        val params = buildJsonObject {
            put("to", to)
            put("data", calldata)
        }
        return runCatching {
            val result = rpcClient.call(
                network = network,
                method = "eth_call",
                params = listOf(params, JsonPrimitive("latest")),
            )
            val raw = result.jsonPrimitive.content.removePrefix("0x")
            decodeAbiString(raw)
        }.getOrNull()
    }

    private fun decodeAbiString(hex: String): String {
        if (hex.length < 128) return ""
        val lengthHex = hex.substring(64, 128)
        val length = lengthHex.toLong(16).toInt().coerceAtLeast(0)
        val dataHex = hex.substring(128, 128 + length * 2)
        val bytes = ByteArray(length)
        for (i in 0 until length) {
            bytes[i] = dataHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
        return bytes.toString(Charsets.UTF_8)
    }

    private fun namehash(name: String): ByteArray {
        var node = ByteArray(32)
        if (name.isNotEmpty()) {
            for (label in name.split(".").asReversed()) {
                val labelHash = Keccak256.digest(label.toByteArray(Charsets.UTF_8))
                node = Keccak256.digest(node + labelHash)
            }
        }
        return node
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xFF) }

    private companion object {
        private const val ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e"
        // keccak("resolver(bytes32)") → 0x0178b8bf
        private const val SELECTOR_RESOLVER = "0x0178b8bf"
        // keccak("addr(bytes32)") → 0x3b3b57de
        private const val SELECTOR_ADDR = "0x3b3b57de"
        // keccak("name(bytes32)") → 0x691f3431
        private const val SELECTOR_NAME = "0x691f3431"
        private const val CACHE_TTL_MS: Long = 5L * 60 * 1000
    }
}
