package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import xyz.aethelred.wallet.core.network.ChainNamespace
import xyz.aethelred.wallet.core.network.NativeCurrency
import xyz.aethelred.wallet.core.network.NetworkDefinition
import xyz.aethelred.wallet.core.network.RpcClient
import java.math.BigInteger

/** Tests for [TxSimulator]. */
public class TxSimulatorTest {

    private lateinit var server: MockWebServer
    private lateinit var simulator: TxSimulator

    @Before
    public fun setUp() {
        server = MockWebServer().apply { start() }
        simulator = TxSimulator(RpcClient(OkHttpClient.Builder().build()))
    }

    @After
    public fun tearDown() {
        server.shutdown()
    }

    @Test
    public fun successfulCallReturnsSuccess(): Unit = runTest {
        server.enqueue(MockResponse().setBody("""{"jsonrpc":"2.0","id":"1","result":"0x"}"""))
        server.enqueue(MockResponse().setBody("""{"jsonrpc":"2.0","id":"1","result":"0x5208"}"""))
        val result = simulator.simulate(
            network = mockNetwork(),
            from = "0xdead",
            to = "0xbeef",
            valueWei = BigInteger.ZERO,
            data = "0x",
        )
        assertTrue(result.success)
    }

    @Test
    public fun revertSurfacesReason(): Unit = runTest {
        val errorBody = """
            {
              "jsonrpc":"2.0","id":"1",
              "error": {"code": -32000, "message": "execution reverted: insufficient balance"}
            }
        """.trimIndent()
        server.enqueue(MockResponse().setBody(errorBody))
        server.enqueue(MockResponse().setBody(errorBody))
        val result = simulator.simulate(
            network = mockNetwork(),
            from = "0xdead",
            to = "0xbeef",
            valueWei = BigInteger.ONE,
            data = "0x",
        )
        assertFalse(result.success)
        assertTrue(result.revertReason?.contains("insufficient balance") == true)
    }

    private fun mockNetwork(): NetworkDefinition = NetworkDefinition(
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
