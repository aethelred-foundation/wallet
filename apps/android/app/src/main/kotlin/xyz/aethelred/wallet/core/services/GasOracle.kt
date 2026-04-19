package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import xyz.aethelred.wallet.core.network.NetworkDefinition
import xyz.aethelred.wallet.core.network.RpcClient
import java.math.BigInteger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Fee suggestions for an EIP-1559 transaction.
 *
 * Values are in wei. The `priority` fee is the user's tip directly to the
 * block producer; `maxFee` is a ceiling that protects against a fee market
 * spike between signing and inclusion.
 *
 * @property baseFeePerGas Reported base fee from the most recent block.
 * @property priorityFeePerGasLow Slow-lane tip (p10 of recent blocks).
 * @property priorityFeePerGasMedium Standard tip (p50).
 * @property priorityFeePerGasHigh Rush tip (p90).
 * @property maxFeePerGasStandard Suggested max fee for the medium lane.
 * @property sampledAt Epoch ms when the oracle computed these numbers.
 */
public data class GasSuggestion(
    public val baseFeePerGas: BigInteger,
    public val priorityFeePerGasLow: BigInteger,
    public val priorityFeePerGasMedium: BigInteger,
    public val priorityFeePerGasHigh: BigInteger,
    public val maxFeePerGasStandard: BigInteger,
    public val sampledAt: Long,
)

/**
 * EIP-1559 fee oracle.
 *
 * Calls `eth_feeHistory` to retrieve priority-fee percentiles across the
 * last [HISTORY_BLOCKS] blocks. Results are cached per-chain for
 * [CACHE_TTL_MS] so rapid repeated calls (e.g. keystroke-driven Send
 * previews) stay cheap.
 *
 * The mutex guards the cache so concurrent Send + Swap view-models don't
 * stampede the RPC endpoint.
 */
@Singleton
public class GasOracle @Inject constructor(
    private val rpcClient: RpcClient,
) {

    private val mutex = Mutex()
    private val cache: MutableMap<Long, GasSuggestion> = mutableMapOf()

    /**
     * Fetch a fee suggestion for [network]. Returns a cached value when
     * the last sample is less than [CACHE_TTL_MS] old.
     */
    public suspend fun suggest(network: NetworkDefinition): GasSuggestion = mutex.withLock {
        val cached = cache[network.chainId]
        if (cached != null && System.currentTimeMillis() - cached.sampledAt < CACHE_TTL_MS) {
            return@withLock cached
        }

        val historyResult = rpcClient.call(
            network = network,
            method = "eth_feeHistory",
            params = listOf(
                JsonPrimitive(HISTORY_BLOCKS.toString(16)),
                JsonPrimitive("latest"),
                JsonPrimitive("[10,50,90]"),
            ),
        )
        val historyObj = historyResult.run {
            (this as? kotlinx.serialization.json.JsonObject)
                ?: throw IllegalStateException("feeHistory must be an object")
        }

        val baseFees = historyObj["baseFeePerGas"]?.jsonArray
            ?.map { parseHex(it.jsonPrimitive.content) }
            ?: emptyList()
        val baseFee = baseFees.lastOrNull() ?: BigInteger.ZERO

        val rewards = historyObj["reward"]?.jsonArray.orEmpty()
        val lastPercentiles = rewards.lastOrNull()?.jsonArray
        val p10 = lastPercentiles?.getOrNull(0)?.jsonPrimitive?.content?.let(::parseHex) ?: BigInteger.ONE
        val p50 = lastPercentiles?.getOrNull(1)?.jsonPrimitive?.content?.let(::parseHex) ?: BigInteger.ONE
        val p90 = lastPercentiles?.getOrNull(2)?.jsonPrimitive?.content?.let(::parseHex) ?: BigInteger.ONE

        val suggestion = GasSuggestion(
            baseFeePerGas = baseFee,
            priorityFeePerGasLow = p10,
            priorityFeePerGasMedium = p50,
            priorityFeePerGasHigh = p90,
            maxFeePerGasStandard = baseFee.multiply(BigInteger.TWO) + p50,
            sampledAt = System.currentTimeMillis(),
        )
        cache[network.chainId] = suggestion
        suggestion
    }

    /**
     * Drop the cache (used by "Refresh gas" buttons and after a chain
     * switch). Thread-safe via the same [mutex].
     */
    public suspend fun invalidate(): Unit = mutex.withLock { cache.clear() }

    private fun parseHex(hex: String): BigInteger {
        val stripped = hex.removePrefix("0x").ifEmpty { "0" }
        return BigInteger(stripped, 16)
    }

    internal companion object {
        internal const val HISTORY_BLOCKS: Int = 10
        internal const val CACHE_TTL_MS: Long = 30_000
    }
}
