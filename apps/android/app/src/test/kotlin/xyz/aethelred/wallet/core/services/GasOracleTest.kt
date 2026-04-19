package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import xyz.aethelred.wallet.core.network.ChainNamespace
import xyz.aethelred.wallet.core.network.NativeCurrency
import xyz.aethelred.wallet.core.network.NetworkDefinition
import xyz.aethelred.wallet.core.network.RpcClient

/** Tests for [GasOracle]. Mocks a minimal `eth_feeHistory` response. */
public class GasOracleTest {

    private lateinit var server: MockWebServer
    private lateinit var oracle: GasOracle

    @Before
    public fun setUp() {
        server = MockWebServer().apply { start() }
        val rpc = RpcClient(OkHttpClient.Builder().build())
        oracle = GasOracle(rpc)
    }

    @After
    public fun tearDown() {
        server.shutdown()
    }

    @Test
    public fun suggestParsesFeeHistory(): Unit = runTest {
        val body = """
            {
              "jsonrpc": "2.0",
              "id": "1",
              "result": {
                "baseFeePerGas": ["0x10", "0x11"],
                "reward": [["0x1", "0x2", "0x3"]]
              }
            }
        """.trimIndent()
        server.enqueue(MockResponse().setBody(body))
        val network = mockNetwork(server)
        val suggestion = oracle.suggest(network)
        assertNotNull(suggestion)
        assertEquals(17L, suggestion.baseFeePerGas.toLong())
    }

    @Test
    public fun suggestCachesPerChain(): Unit = runTest {
        val body = """
            {
              "jsonrpc": "2.0",
              "id": "1",
              "result": {
                "baseFeePerGas": ["0x1"],
                "reward": [["0x1", "0x2", "0x3"]]
              }
            }
        """.trimIndent()
        server.enqueue(MockResponse().setBody(body))
        val network = mockNetwork(server)
        oracle.suggest(network)
        oracle.suggest(network) // Second call must hit cache; no enqueue = would 404.
    }

    private fun mockNetwork(server: MockWebServer): NetworkDefinition = NetworkDefinition(
        chainId = 1,
        namespace = ChainNamespace.EIP155,
        name = "Mock",
        shortName = "MOCK",
        nativeCurrency = NativeCurrency("ETH", "Ether", 18),
        rpcEndpoints = listOf(server.url("/").toString()),
        blockExplorerUrl = "https://mock",
        iconUrl = "https://mock/icon",
        isTestnet = false,
        supportsEip1559 = true,
        averageBlockTime = 12,
    )
}
