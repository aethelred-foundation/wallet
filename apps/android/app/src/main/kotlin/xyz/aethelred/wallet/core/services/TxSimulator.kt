package xyz.aethelred.wallet.core.services

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import xyz.aethelred.wallet.core.network.NetworkDefinition
import xyz.aethelred.wallet.core.network.RpcClient
import java.math.BigInteger
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Outcome of a simulation run.
 *
 * @property success Whether the simulated execution would succeed.
 * @property revertReason Decoded revert message if [success] is false.
 * @property gasUsed Gas consumed during simulation. Display-friendly.
 * @property rawReturnData Hex-encoded return bytes from the call.
 */
public data class SimulationResult(
    public val success: Boolean,
    public val revertReason: String?,
    public val gasUsed: BigInteger,
    public val rawReturnData: String,
)

/**
 * Pre-signing simulator built on `eth_call` + `eth_estimateGas`.
 *
 * The SwapScreen and ApprovalScreen both surface the simulated outcome so
 * the user sees the effect of a transaction before signing. The decoded
 * ABI traces (ERC-20 transfer effects, balance deltas) are intentionally
 * out-of-scope here — a full trace layer lives in the control-plane.
 */
@Singleton
public class TxSimulator @Inject constructor(
    private val rpcClient: RpcClient,
) {

    /**
     * Simulate a call to [to] with raw [data] using `eth_call`.
     *
     * @param from Sender address (address-of-sender for `call`).
     * @param to Contract address (nullable → contract creation).
     * @param valueWei Value in wei (stringified hex).
     * @param data ABI-encoded calldata.
     */
    @Suppress("LongParameterList")
    public suspend fun simulate(
        network: NetworkDefinition,
        from: String,
        to: String?,
        valueWei: BigInteger,
        data: String,
    ): SimulationResult {
        val params = buildJsonObject {
            put("from", from)
            to?.let { put("to", it) }
            put("value", "0x" + valueWei.toString(16))
            put("data", data)
        }

        return try {
            val result = rpcClient.call(
                network = network,
                method = "eth_call",
                params = listOf(params, JsonPrimitive("latest")),
            )
            val gasResult = rpcClient.call(
                network = network,
                method = "eth_estimateGas",
                params = listOf(params),
            )
            val rawReturn = result.jsonPrimitive.content
            val gasHex = gasResult.jsonPrimitive.content.removePrefix("0x").ifEmpty { "0" }
            SimulationResult(
                success = true,
                revertReason = null,
                gasUsed = BigInteger(gasHex, 16),
                rawReturnData = rawReturn,
            )
        } catch (rpcError: xyz.aethelred.wallet.core.network.RpcError.JsonRpc) {
            // Contract revert reasons come back as the "detail" field; we
            // strip the ABI framing (first 4 bytes) before surfacing.
            val decoded = decodeRevertReason(rpcError.detail)
            SimulationResult(
                success = false,
                revertReason = decoded,
                gasUsed = BigInteger.ZERO,
                rawReturnData = "",
            )
        }
    }

    private fun decodeRevertReason(raw: String): String {
        // Typical revert payload: "execution reverted: <message>"
        val marker = "execution reverted: "
        val idx = raw.indexOf(marker)
        return if (idx >= 0) raw.substring(idx + marker.length) else raw
    }
}
