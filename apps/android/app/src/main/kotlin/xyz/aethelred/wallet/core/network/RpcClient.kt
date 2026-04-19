package xyz.aethelred.wallet.core.network

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Minimal JSON-RPC 2.0 client. OkHttp handles the transport; serialization
 * uses kotlinx.serialization's `JsonElement` to stay schema-agnostic —
 * callers decode the returned `result` payload themselves.
 *
 * Endpoint rotation: [NetworkRegistry] ships a list of RPCs per chain.
 * The client walks them top-to-bottom on transport failure. Downstream
 * modules (gas oracle, balance fetcher) reuse a single [RpcClient] so
 * connection pooling kicks in.
 */
@Singleton
public class RpcClient @Inject constructor(
    private val httpClient: OkHttpClient,
) {

    private val json: Json = Json { ignoreUnknownKeys = true }

    /**
     * Invoke [method] with [params] against the first reachable endpoint
     * from the supplied network.
     *
     * @return The `result` field of the JSON-RPC response.
     * @throws RpcError on any failure.
     */
    public suspend fun call(
        network: NetworkDefinition,
        method: String,
        params: List<JsonElement>,
    ): JsonElement = withContext(Dispatchers.IO) {
        val payload = buildJsonObject {
            put("jsonrpc", "2.0")
            put("id", System.currentTimeMillis().toString())
            put("method", method)
            putJsonArray("params") { params.forEach { add(it) } }
        }
        val body = payload.toString().toRequestBody(JSON_MEDIA)

        var lastFailure: Throwable? = null
        for (endpoint in network.rpcEndpoints) {
            val started = System.currentTimeMillis()
            try {
                val request = Request.Builder()
                    .url(endpoint)
                    .post(body)
                    .header("Content-Type", "application/json")
                    .build()

                httpClient.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        throw RpcError.Http(response.code, response.body?.string())
                    }
                    val raw = response.body?.string().orEmpty()
                    val root = runCatching { json.parseToJsonElement(raw) }
                        .getOrElse { throw RpcError.MalformedResponse(it) }
                    val rootObj = root.jsonObject
                    rootObj["error"]?.let { err ->
                        val code = err.jsonObject["code"]?.toString()?.toIntOrNull() ?: -1
                        val detail = err.jsonObject["message"]?.toString() ?: "unknown"
                        throw RpcError.JsonRpc(code, detail)
                    }
                    return@withContext rootObj["result"]
                        ?: throw RpcError.MalformedResponse(
                            IllegalStateException("missing result field"),
                        )
                }
            } catch (rpc: RpcError) {
                // A semantic error means the chain responded — don't try
                // the next endpoint, surface the error.
                throw rpc
            } catch (io: java.io.IOException) {
                lastFailure = io
                val elapsed = System.currentTimeMillis() - started
                if (elapsed >= httpClient.callTimeoutMillis.toLong()) {
                    throw RpcError.Timeout(elapsed)
                }
                // Try the next endpoint.
                continue
            }
        }
        throw RpcError.Transport(
            lastFailure ?: IllegalStateException("no endpoints configured for ${network.name}"),
        )
    }

    private companion object {
        private val JSON_MEDIA = "application/json".toMediaType()
    }

    /**
     * Factory that configures a sensible OkHttp client for wallet use.
     * Hilt wires this via `@Provides` in `NetworkModule`, but anyone can
     * instantiate it directly for previews / tests.
     */
    public companion object {
        public fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .callTimeout(30, TimeUnit.SECONDS)
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(20, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .build()
    }
}
