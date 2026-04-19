package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Per-asset price quote.
 *
 * @property symbol Upper-cased asset ticker.
 * @property priceUsd Current price in USD.
 * @property change24hPercent Percentage change over the last 24 hours.
 * @property sampledAt Epoch ms the quote was fetched.
 */
public data class PriceQuote(
    public val symbol: String,
    public val priceUsd: Double,
    public val change24hPercent: Double,
    public val sampledAt: Long,
)

/**
 * Price feed client.
 *
 * Production: lives against the CoinGecko REST API with a plain OkHttp
 * transport — deliberately not Retrofit so the app keeps its dependency
 * footprint compact. Mutex-guarded batched requests so MarketScreen,
 * PortfolioScreen, and HomeScreen share a single cache.
 *
 * FOLLOW-UP(android-team): when the wallet ships at scale, swap in a
 * commercial price feed (Chainlink Data Streams, RedStone) with signed
 * attestations — this class hides that transition.
 */
@Singleton
public class PriceService @Inject constructor(
    private val httpClient: OkHttpClient,
) {

    private val mutex = Mutex()
    private val cache: MutableMap<String, PriceQuote> = mutableMapOf()
    private val json: Json = Json { ignoreUnknownKeys = true }

    /**
     * Fetch a batch of prices.
     *
     * @param ids CoinGecko asset IDs (e.g. "ethereum", "bitcoin"). The
     *            mobile-team is expected to maintain the symbol→id map
     *            locally to avoid a second round-trip.
     * @return Map keyed by asset id. Missing ids are omitted.
     */
    public suspend fun fetchBatch(ids: List<String>): Map<String, PriceQuote> {
        if (ids.isEmpty()) return emptyMap()

        val now = System.currentTimeMillis()
        val uncached = mutex.withLock {
            ids.filter { id ->
                val cached = cache[id] ?: return@filter true
                now - cached.sampledAt >= CACHE_TTL_MS
            }
        }

        if (uncached.isNotEmpty()) {
            val refreshed = runNetwork(uncached, now)
            mutex.withLock { refreshed.forEach { (id, quote) -> cache[id] = quote } }
        }

        return mutex.withLock { ids.mapNotNull { id -> cache[id]?.let { id to it } }.toMap() }
    }

    /** Clear the cache — useful in developer-tools "reset" flows. */
    public suspend fun invalidate(): Unit = mutex.withLock { cache.clear() }

    private suspend fun runNetwork(ids: List<String>, now: Long): Map<String, PriceQuote> =
        withContext(Dispatchers.IO) {
            val url = ENDPOINT + ids.joinToString(",")
            val request = Request.Builder().url(url).build()
            httpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@use emptyMap()
                val body = response.body?.string().orEmpty()
                val root = runCatching { json.parseToJsonElement(body).jsonObject }
                    .getOrElse { return@use emptyMap() }
                root.entries.associate { (id, obj) ->
                    val payload = obj.jsonObject
                    val priceUsd = payload["usd"]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0
                    val change = payload["usd_24h_change"]?.jsonPrimitive?.content?.toDoubleOrNull() ?: 0.0
                    id to PriceQuote(
                        symbol = id.uppercase(Locale.ROOT),
                        priceUsd = priceUsd,
                        change24hPercent = change,
                        sampledAt = now,
                    )
                }
            }
        }

    internal companion object {
        internal const val CACHE_TTL_MS: Long = 30_000L
        internal const val ENDPOINT: String =
            "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&ids="
    }
}
