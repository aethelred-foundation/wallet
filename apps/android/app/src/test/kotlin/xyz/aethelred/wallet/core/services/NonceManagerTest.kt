package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import xyz.aethelred.wallet.core.network.ChainNamespace
import xyz.aethelred.wallet.core.network.NativeCurrency
import xyz.aethelred.wallet.core.network.NetworkDefinition
import xyz.aethelred.wallet.core.network.RpcClient
import java.math.BigInteger

/**
 * Unit tests for [NonceManager]. Uses a `MockWebServer` so we don't touch
 * the network — all RPC traffic is faked locally.
 */
public class NonceManagerTest {

    private lateinit var server: MockWebServer
    private lateinit var manager: NonceManager

    @Before
    public fun setUp() {
        server = MockWebServer().apply { start() }
        val client = OkHttpClient.Builder().build()
        val rpc = RpcClient(client)
        manager = NonceManager(rpc)
    }

    @After
    public fun tearDown() {
        server.shutdown()
    }

    @Test
    public fun firstNonceReturnsOnChain(): Unit = runTest {
        server.enqueue(
            MockResponse().setBody(
                Json.encodeToString(RpcResponse.serializer(), RpcResponse("0x5")),
            ),
        )
        val network = testNetwork(server)
        val nonce = manager.nextNonce(network, "0xdead")
        assertEquals(BigInteger.valueOf(5), nonce)
    }

    @Test
    public fun sequentialCallsIncrementLocally(): Unit = runTest {
        server.enqueue(
            MockResponse().setBody(
                Json.encodeToString(RpcResponse.serializer(), RpcResponse("0x0")),
            ),
        )
        val network = testNetwork(server)
        val first = manager.nextNonce(network, "0xdead")
        val second = manager.nextNonce(network, "0xdead")
        assertEquals(BigInteger.ZERO, first)
        assertEquals(BigInteger.ONE, second)
    }

    @Test
    public fun resyncClobbersCursor(): Unit = runTest {
        server.enqueue(
            MockResponse().setBody(
                Json.encodeToString(RpcResponse.serializer(), RpcResponse("0x0")),
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                Json.encodeToString(RpcResponse.serializer(), RpcResponse("0xA")),
            ),
        )
        val network = testNetwork(server)
        manager.nextNonce(network, "0xdead")
        val resynced = manager.resync(network, "0xdead")
        assertEquals(BigInteger.valueOf(10), resynced)
    }

    @kotlinx.serialization.Serializable
    private data class RpcResponse(val result: String, val id: String = "1", val jsonrpc: String = "2.0")

    private fun testNetwork(server: MockWebServer): NetworkDefinition = NetworkDefinition(
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
