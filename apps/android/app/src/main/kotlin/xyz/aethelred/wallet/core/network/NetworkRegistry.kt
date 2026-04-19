package xyz.aethelred.wallet.core.network

import javax.inject.Inject
import javax.inject.Singleton

/**
 * CAIP-2 namespace discriminator. Mirrors the `ChainNamespace` union from
 * `packages/chain/src/networks.ts` so the Kotlin and TypeScript registries
 * stay in lockstep.
 */
public enum class ChainNamespace { EIP155, BIP122, SOLANA }

/**
 * Metadata describing a chain's native currency.
 */
public data class NativeCurrency(
    public val symbol: String,
    public val name: String,
    public val decimals: Int,
)

/**
 * Full network definition. Fields match the TypeScript registry one-to-one
 * so downstream tooling (audit events, connect-layer messages) can treat
 * the two sides as equivalent schemas.
 */
public data class NetworkDefinition(
    public val chainId: Long,
    public val namespace: ChainNamespace,
    public val name: String,
    public val shortName: String,
    public val nativeCurrency: NativeCurrency,
    public val rpcEndpoints: List<String>,
    public val blockExplorerUrl: String,
    public val iconUrl: String,
    public val isTestnet: Boolean,
    public val supportsEip1559: Boolean,
    public val averageBlockTime: Int,
    public val multicall3Address: String? = null,
)

/**
 * Kotlin port of the TypeScript `ALL_NETWORKS` registry.
 *
 * Only the most heavily used chains are ported here; the rest are added
 * lazily by the Android team as onboarding requires. Keep this list in
 * sync with `packages/chain/src/networks.ts` — the integration tests in
 * the control-plane treat mismatches as a deployment blocker.
 *
 * Injected as a Hilt singleton so multiple view-models can share the
 * same immutable catalogue.
 */
@Singleton
public class NetworkRegistry @Inject constructor() {

    private val multicall3Canonical: String = "0xcA11bde05977b3631167028862bE2a173976CA11"

    /** The entire catalogue. */
    public val all: List<NetworkDefinition> = buildList {
        add(ethereumMainnet())
        add(polygonMainnet())
        add(baseMainnet())
        add(optimismMainnet())
        add(arbitrumMainnet())
        add(avalancheMainnet())
        add(bnbMainnet())
        add(aethelredMainnet())
        add(ethereumSepolia())
        add(baseSepolia())
    }

    /** Preselected default chain for new sessions (Ethereum mainnet). */
    public val defaultNetwork: NetworkDefinition = all.first { it.chainId == 1L }

    /** Lookup by numeric chain-id. Mirrors the TS `getNetwork` helper. */
    public fun byChainId(chainId: Long): NetworkDefinition? =
        all.firstOrNull { it.chainId == chainId }

    /** Filter to mainnets only (UI: "production" section in the picker). */
    public fun mainnets(): List<NetworkDefinition> = all.filter { !it.isTestnet }

    /** Filter to testnets. Dev-mode toggle only. */
    public fun testnets(): List<NetworkDefinition> = all.filter { it.isTestnet }

    private fun ethereumMainnet() = NetworkDefinition(
        chainId = 1,
        namespace = ChainNamespace.EIP155,
        name = "Ethereum Mainnet",
        shortName = "ETH",
        nativeCurrency = NativeCurrency("ETH", "Ether", 18),
        rpcEndpoints = listOf(
            "https://eth.llamarpc.com",
            "https://ethereum-rpc.publicnode.com",
            "https://rpc.ankr.com/eth",
        ),
        blockExplorerUrl = "https://etherscan.io",
        iconUrl = "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
        isTestnet = false,
        supportsEip1559 = true,
        averageBlockTime = 12,
        multicall3Address = multicall3Canonical,
    )

    private fun polygonMainnet() = NetworkDefinition(
        chainId = 137,
        namespace = ChainNamespace.EIP155,
        name = "Polygon Mainnet",
        shortName = "MATIC",
        nativeCurrency = NativeCurrency("MATIC", "Polygon", 18),
        rpcEndpoints = listOf(
            "https://polygon-rpc.com",
            "https://polygon.llamarpc.com",
        ),
        blockExplorerUrl = "https://polygonscan.com",
        iconUrl = "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg",
        isTestnet = false,
        supportsEip1559 = true,
        averageBlockTime = 2,
        multicall3Address = multicall3Canonical,
    )

    private fun baseMainnet() = NetworkDefinition(
        chainId = 8453,
        namespace = ChainNamespace.EIP155,
        name = "Base",
        shortName = "BASE",
        nativeCurrency = NativeCurrency("ETH", "Ether", 18),
        rpcEndpoints = listOf(
            "https://mainnet.base.org",
            "https://base.llamarpc.com",
        ),
        blockExplorerUrl = "https://basescan.org",
        iconUrl = "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
        isTestnet = false,
        supportsEip1559 = true,
        averageBlockTime = 2,
        multicall3Address = multicall3Canonical,
    )

    private fun optimismMainnet() = NetworkDefinition(
        chainId = 10,
        namespace = ChainNamespace.EIP155,
        name = "OP Mainnet",
        shortName = "OP",
        nativeCurrency = NativeCurrency("ETH", "Ether", 18),
        rpcEndpoints = listOf(
            "https://mainnet.optimism.io",
            "https://optimism.llamarpc.com",
        ),
        blockExplorerUrl = "https://optimistic.etherscan.io",
        iconUrl = "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg",
        isTestnet = false,
        supportsEip1559 = true,
        averageBlockTime = 2,
        multicall3Address = multicall3Canonical,
    )

    private fun arbitrumMainnet() = NetworkDefinition(
        chainId = 42161,
        namespace = ChainNamespace.EIP155,
        name = "Arbitrum One",
        shortName = "ARB",
        nativeCurrency = NativeCurrency("ETH", "Ether", 18),
        rpcEndpoints = listOf(
            "https://arb1.arbitrum.io/rpc",
            "https://arbitrum.llamarpc.com",
        ),
        blockExplorerUrl = "https://arbiscan.io",
        iconUrl = "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
        isTestnet = false,
        supportsEip1559 = true,
        averageBlockTime = 1,
        multicall3Address = multicall3Canonical,
    )

    private fun avalancheMainnet() = NetworkDefinition(
        chainId = 43114,
        namespace = ChainNamespace.EIP155,
        name = "Avalanche C-Chain",
        shortName = "AVAX",
        nativeCurrency = NativeCurrency("AVAX", "Avalanche", 18),
        rpcEndpoints = listOf(
            "https://api.avax.network/ext/bc/C/rpc",
        ),
        blockExplorerUrl = "https://snowtrace.io",
        iconUrl = "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg",
        isTestnet = false,
        supportsEip1559 = true,
        averageBlockTime = 2,
        multicall3Address = multicall3Canonical,
    )

    private fun bnbMainnet() = NetworkDefinition(
        chainId = 56,
        namespace = ChainNamespace.EIP155,
        name = "BNB Smart Chain",
        shortName = "BNB",
        nativeCurrency = NativeCurrency("BNB", "BNB", 18),
        rpcEndpoints = listOf(
            "https://bsc-dataseed.bnbchain.org",
            "https://bsc.llamarpc.com",
        ),
        blockExplorerUrl = "https://bscscan.com",
        iconUrl = "https://icons.llamao.fi/icons/chains/rsz_binance.jpg",
        isTestnet = false,
        supportsEip1559 = false,
        averageBlockTime = 3,
        multicall3Address = multicall3Canonical,
    )

    private fun aethelredMainnet() = NetworkDefinition(
        chainId = 42069,
        namespace = ChainNamespace.EIP155,
        name = "Aethelred",
        shortName = "AETH",
        nativeCurrency = NativeCurrency("AETH", "Aethelred", 18),
        rpcEndpoints = listOf("https://rpc.aethelred.network"),
        blockExplorerUrl = "https://explorer.aethelred.network",
        iconUrl = "https://aethelred.network/icon.png",
        isTestnet = false,
        supportsEip1559 = true,
        averageBlockTime = 2,
    )

    private fun ethereumSepolia() = NetworkDefinition(
        chainId = 11155111,
        namespace = ChainNamespace.EIP155,
        name = "Sepolia",
        shortName = "SEP",
        nativeCurrency = NativeCurrency("ETH", "Sepolia Ether", 18),
        rpcEndpoints = listOf(
            "https://ethereum-sepolia-rpc.publicnode.com",
            "https://rpc.sepolia.org",
        ),
        blockExplorerUrl = "https://sepolia.etherscan.io",
        iconUrl = "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
        isTestnet = true,
        supportsEip1559 = true,
        averageBlockTime = 12,
        multicall3Address = multicall3Canonical,
    )

    private fun baseSepolia() = NetworkDefinition(
        chainId = 84532,
        namespace = ChainNamespace.EIP155,
        name = "Base Sepolia",
        shortName = "BASE-SEP",
        nativeCurrency = NativeCurrency("ETH", "Sepolia Ether", 18),
        rpcEndpoints = listOf(
            "https://sepolia.base.org",
        ),
        blockExplorerUrl = "https://sepolia.basescan.org",
        iconUrl = "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
        isTestnet = true,
        supportsEip1559 = true,
        averageBlockTime = 2,
        multicall3Address = multicall3Canonical,
    )
}
