import Foundation

/// Namespace tag for a given chain — mirrors `ChainNamespace` in the
/// TypeScript package `@aethelred/wallet-chain`.
public enum ChainNamespace: String, Codable, Sendable {
    case eip155
    case bip122
    case solana
}

/// Native currency metadata — shape-for-shape port of
/// `packages/chain/src/networks.ts` `NativeCurrency`.
public struct NativeCurrency: Codable, Sendable, Equatable {
    public let symbol: String
    public let name: String
    public let decimals: Int
}

/// Full network definition used by ``RpcClient`` and the chain picker.
///
/// Every field is `let`; instances exposed from ``NetworkRegistry`` are
/// compile-time constants, so treating them as immutable is trivial.
public struct NetworkDefinition: Codable, Sendable, Equatable, Identifiable {
    public let chainId: Int
    public let namespace: ChainNamespace
    public let name: String
    public let shortName: String
    public let nativeCurrency: NativeCurrency
    public let rpcEndpoints: [String]
    public let blockExplorerUrl: String
    public let iconUrl: String
    public let isTestnet: Bool
    public let supportsEip1559: Bool
    public let averageBlockTime: Int
    public let multicall3Address: String?

    public var id: Int { chainId }
}

/// Static registry of every network the wallet officially supports.
///
/// Mirrors the `ALL_NETWORKS` constant in
/// `packages/chain/src/networks.ts` — any chain added there must also be
/// added here. Tests assert the counts match.
public enum NetworkRegistry {

    /// Canonical Multicall3 address (deterministic deployment).
    private static let multicall3 = "0xcA11bde05977b3631167028862bE2a173976CA11"

    /// All 26 networks (18 EVM mainnets including Aethelred placeholder,
    /// 2 Bitcoin, 2 Solana, 7 EVM testnets — 29 total after testnets).
    /// Order matches the TypeScript `ALL_NETWORKS` array.
    public static let all: [NetworkDefinition] = [
        ethereumMainnet,
        polygonMainnet,
        baseMainnet,
        optimismMainnet,
        arbitrumMainnet,
        avalancheMainnet,
        bnbMainnet,
        gnosisMainnet,
        zksyncEraMainnet,
        lineaMainnet,
        scrollMainnet,
        mantleMainnet,
        celoMainnet,
        fantomMainnet,
        blastMainnet,
        modeMainnet,
        zoraMainnet,
        opBnbMainnet,
        aethelredMainnet,
        bitcoinMainnet,
        solanaMainnet,
        ethereumSepolia,
        polygonAmoy,
        baseSepolia,
        optimismSepolia,
        arbitrumSepolia,
        avalancheFuji,
        bnbTestnet,
        bitcoinTestnet,
        solanaDevnet
    ]

    /// Resolve a network by chain ID.
    public static func network(for chainId: Int) -> NetworkDefinition? {
        all.first(where: { $0.chainId == chainId })
    }

    /// Every mainnet network.
    public static var mainnets: [NetworkDefinition] {
        all.filter { !$0.isTestnet }
    }

    /// Every testnet network.
    public static var testnets: [NetworkDefinition] {
        all.filter(\.isTestnet)
    }

    // MARK: - Individual definitions

    public static let ethereumMainnet = NetworkDefinition(
        chainId: 1,
        namespace: .eip155,
        name: "Ethereum Mainnet",
        shortName: "ETH",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: [
            "https://eth.llamarpc.com",
            "https://ethereum-rpc.publicnode.com",
            "https://rpc.ankr.com/eth",
            "https://cloudflare-eth.com"
        ],
        blockExplorerUrl: "https://etherscan.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 12,
        multicall3Address: multicall3
    )

    public static let polygonMainnet = NetworkDefinition(
        chainId: 137,
        namespace: .eip155,
        name: "Polygon Mainnet",
        shortName: "MATIC",
        nativeCurrency: .init(symbol: "MATIC", name: "Polygon", decimals: 18),
        rpcEndpoints: [
            "https://polygon-rpc.com",
            "https://polygon.llamarpc.com",
            "https://polygon-bor-rpc.publicnode.com",
            "https://rpc.ankr.com/polygon"
        ],
        blockExplorerUrl: "https://polygonscan.com",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let baseMainnet = NetworkDefinition(
        chainId: 8453,
        namespace: .eip155,
        name: "Base",
        shortName: "BASE",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: [
            "https://mainnet.base.org",
            "https://base.llamarpc.com",
            "https://base-rpc.publicnode.com"
        ],
        blockExplorerUrl: "https://basescan.org",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let optimismMainnet = NetworkDefinition(
        chainId: 10,
        namespace: .eip155,
        name: "OP Mainnet",
        shortName: "OP",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: [
            "https://mainnet.optimism.io",
            "https://optimism.llamarpc.com",
            "https://optimism-rpc.publicnode.com"
        ],
        blockExplorerUrl: "https://optimistic.etherscan.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let arbitrumMainnet = NetworkDefinition(
        chainId: 42161,
        namespace: .eip155,
        name: "Arbitrum One",
        shortName: "ARB",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: [
            "https://arb1.arbitrum.io/rpc",
            "https://arbitrum.llamarpc.com",
            "https://arbitrum-one-rpc.publicnode.com"
        ],
        blockExplorerUrl: "https://arbiscan.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 1,
        multicall3Address: multicall3
    )

    public static let avalancheMainnet = NetworkDefinition(
        chainId: 43114,
        namespace: .eip155,
        name: "Avalanche C-Chain",
        shortName: "AVAX",
        nativeCurrency: .init(symbol: "AVAX", name: "Avalanche", decimals: 18),
        rpcEndpoints: [
            "https://api.avax.network/ext/bc/C/rpc",
            "https://avalanche-c-chain-rpc.publicnode.com",
            "https://rpc.ankr.com/avalanche"
        ],
        blockExplorerUrl: "https://snowtrace.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let bnbMainnet = NetworkDefinition(
        chainId: 56,
        namespace: .eip155,
        name: "BNB Smart Chain",
        shortName: "BNB",
        nativeCurrency: .init(symbol: "BNB", name: "BNB", decimals: 18),
        rpcEndpoints: [
            "https://bsc-dataseed.bnbchain.org",
            "https://bsc.llamarpc.com"
        ],
        blockExplorerUrl: "https://bscscan.com",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_binance.jpg",
        isTestnet: false,
        supportsEip1559: false,
        averageBlockTime: 3,
        multicall3Address: multicall3
    )

    public static let gnosisMainnet = NetworkDefinition(
        chainId: 100,
        namespace: .eip155,
        name: "Gnosis Chain",
        shortName: "GNO",
        nativeCurrency: .init(symbol: "XDAI", name: "xDAI", decimals: 18),
        rpcEndpoints: [
            "https://rpc.gnosischain.com",
            "https://gnosis-rpc.publicnode.com"
        ],
        blockExplorerUrl: "https://gnosisscan.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_xdai.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 5,
        multicall3Address: multicall3
    )

    public static let zksyncEraMainnet = NetworkDefinition(
        chainId: 324,
        namespace: .eip155,
        name: "zkSync Era",
        shortName: "ZKSYNC",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: [
            "https://mainnet.era.zksync.io"
        ],
        blockExplorerUrl: "https://explorer.zksync.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_zksync%20era.jpg",
        isTestnet: false,
        supportsEip1559: false,
        averageBlockTime: 1,
        multicall3Address: multicall3
    )

    public static let lineaMainnet = NetworkDefinition(
        chainId: 59144,
        namespace: .eip155,
        name: "Linea",
        shortName: "LINEA",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: ["https://rpc.linea.build"],
        blockExplorerUrl: "https://lineascan.build",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let scrollMainnet = NetworkDefinition(
        chainId: 534352,
        namespace: .eip155,
        name: "Scroll",
        shortName: "SCR",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: ["https://rpc.scroll.io"],
        blockExplorerUrl: "https://scrollscan.com",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_scroll.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 3,
        multicall3Address: multicall3
    )

    public static let mantleMainnet = NetworkDefinition(
        chainId: 5000,
        namespace: .eip155,
        name: "Mantle",
        shortName: "MNT",
        nativeCurrency: .init(symbol: "MNT", name: "Mantle", decimals: 18),
        rpcEndpoints: ["https://rpc.mantle.xyz"],
        blockExplorerUrl: "https://mantlescan.xyz",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_mantle.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let celoMainnet = NetworkDefinition(
        chainId: 42220,
        namespace: .eip155,
        name: "Celo",
        shortName: "CELO",
        nativeCurrency: .init(symbol: "CELO", name: "Celo", decimals: 18),
        rpcEndpoints: ["https://forno.celo.org"],
        blockExplorerUrl: "https://celoscan.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_celo.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 5,
        multicall3Address: multicall3
    )

    public static let fantomMainnet = NetworkDefinition(
        chainId: 250,
        namespace: .eip155,
        name: "Fantom Opera",
        shortName: "FTM",
        nativeCurrency: .init(symbol: "FTM", name: "Fantom", decimals: 18),
        rpcEndpoints: ["https://rpc.ftm.tools"],
        blockExplorerUrl: "https://ftmscan.com",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_fantom.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 1,
        multicall3Address: multicall3
    )

    public static let blastMainnet = NetworkDefinition(
        chainId: 81457,
        namespace: .eip155,
        name: "Blast",
        shortName: "BLAST",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: ["https://rpc.blast.io"],
        blockExplorerUrl: "https://blastscan.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_blast.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let modeMainnet = NetworkDefinition(
        chainId: 34443,
        namespace: .eip155,
        name: "Mode",
        shortName: "MODE",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: ["https://mainnet.mode.network"],
        blockExplorerUrl: "https://explorer.mode.network",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_mode.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let zoraMainnet = NetworkDefinition(
        chainId: 7777777,
        namespace: .eip155,
        name: "Zora",
        shortName: "ZORA",
        nativeCurrency: .init(symbol: "ETH", name: "Ether", decimals: 18),
        rpcEndpoints: ["https://rpc.zora.energy"],
        blockExplorerUrl: "https://explorer.zora.energy",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_zora.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let opBnbMainnet = NetworkDefinition(
        chainId: 204,
        namespace: .eip155,
        name: "opBNB",
        shortName: "OPBNB",
        nativeCurrency: .init(symbol: "BNB", name: "BNB", decimals: 18),
        rpcEndpoints: ["https://opbnb-mainnet-rpc.bnbchain.org"],
        blockExplorerUrl: "https://opbnbscan.com",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_op_bnb.jpg",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 1,
        multicall3Address: multicall3
    )

    public static let aethelredMainnet = NetworkDefinition(
        chainId: 42069,
        namespace: .eip155,
        name: "Aethelred",
        shortName: "AETH",
        nativeCurrency: .init(symbol: "AETH", name: "Aethelred", decimals: 18),
        rpcEndpoints: ["https://rpc.aethelred.network"],
        blockExplorerUrl: "https://explorer.aethelred.network",
        iconUrl: "https://aethelred.network/icon.png",
        isTestnet: false,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: nil
    )

    public static let bitcoinMainnet = NetworkDefinition(
        chainId: 0,
        namespace: .bip122,
        name: "Bitcoin",
        shortName: "BTC",
        nativeCurrency: .init(symbol: "BTC", name: "Bitcoin", decimals: 8),
        rpcEndpoints: [
            "https://blockstream.info/api",
            "https://mempool.space/api"
        ],
        blockExplorerUrl: "https://mempool.space",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_bitcoin.jpg",
        isTestnet: false,
        supportsEip1559: false,
        averageBlockTime: 600,
        multicall3Address: nil
    )

    public static let solanaMainnet = NetworkDefinition(
        chainId: 101,
        namespace: .solana,
        name: "Solana",
        shortName: "SOL",
        nativeCurrency: .init(symbol: "SOL", name: "Solana", decimals: 9),
        rpcEndpoints: ["https://api.mainnet-beta.solana.com"],
        blockExplorerUrl: "https://explorer.solana.com",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_solana.jpg",
        isTestnet: false,
        supportsEip1559: false,
        averageBlockTime: 1,
        multicall3Address: nil
    )

    public static let ethereumSepolia = NetworkDefinition(
        chainId: 11_155_111,
        namespace: .eip155,
        name: "Sepolia",
        shortName: "SEP",
        nativeCurrency: .init(symbol: "ETH", name: "Sepolia Ether", decimals: 18),
        rpcEndpoints: ["https://ethereum-sepolia-rpc.publicnode.com"],
        blockExplorerUrl: "https://sepolia.etherscan.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
        isTestnet: true,
        supportsEip1559: true,
        averageBlockTime: 12,
        multicall3Address: multicall3
    )

    public static let polygonAmoy = NetworkDefinition(
        chainId: 80002,
        namespace: .eip155,
        name: "Polygon Amoy",
        shortName: "AMOY",
        nativeCurrency: .init(symbol: "MATIC", name: "Polygon", decimals: 18),
        rpcEndpoints: ["https://rpc-amoy.polygon.technology"],
        blockExplorerUrl: "https://amoy.polygonscan.com",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg",
        isTestnet: true,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let baseSepolia = NetworkDefinition(
        chainId: 84532,
        namespace: .eip155,
        name: "Base Sepolia",
        shortName: "BASE-SEP",
        nativeCurrency: .init(symbol: "ETH", name: "Sepolia Ether", decimals: 18),
        rpcEndpoints: ["https://sepolia.base.org"],
        blockExplorerUrl: "https://sepolia.basescan.org",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
        isTestnet: true,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let optimismSepolia = NetworkDefinition(
        chainId: 11_155_420,
        namespace: .eip155,
        name: "OP Sepolia",
        shortName: "OP-SEP",
        nativeCurrency: .init(symbol: "ETH", name: "Sepolia Ether", decimals: 18),
        rpcEndpoints: ["https://sepolia.optimism.io"],
        blockExplorerUrl: "https://sepolia-optimism.etherscan.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg",
        isTestnet: true,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let arbitrumSepolia = NetworkDefinition(
        chainId: 421_614,
        namespace: .eip155,
        name: "Arbitrum Sepolia",
        shortName: "ARB-SEP",
        nativeCurrency: .init(symbol: "ETH", name: "Sepolia Ether", decimals: 18),
        rpcEndpoints: ["https://sepolia-rollup.arbitrum.io/rpc"],
        blockExplorerUrl: "https://sepolia.arbiscan.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
        isTestnet: true,
        supportsEip1559: true,
        averageBlockTime: 1,
        multicall3Address: multicall3
    )

    public static let avalancheFuji = NetworkDefinition(
        chainId: 43113,
        namespace: .eip155,
        name: "Avalanche Fuji",
        shortName: "FUJI",
        nativeCurrency: .init(symbol: "AVAX", name: "Avalanche", decimals: 18),
        rpcEndpoints: ["https://api.avax-test.network/ext/bc/C/rpc"],
        blockExplorerUrl: "https://testnet.snowtrace.io",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg",
        isTestnet: true,
        supportsEip1559: true,
        averageBlockTime: 2,
        multicall3Address: multicall3
    )

    public static let bnbTestnet = NetworkDefinition(
        chainId: 97,
        namespace: .eip155,
        name: "BNB Smart Chain Testnet",
        shortName: "BNB-T",
        nativeCurrency: .init(symbol: "tBNB", name: "Test BNB", decimals: 18),
        rpcEndpoints: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
        blockExplorerUrl: "https://testnet.bscscan.com",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_binance.jpg",
        isTestnet: true,
        supportsEip1559: false,
        averageBlockTime: 3,
        multicall3Address: multicall3
    )

    public static let bitcoinTestnet = NetworkDefinition(
        chainId: -1,
        namespace: .bip122,
        name: "Bitcoin Testnet",
        shortName: "tBTC",
        nativeCurrency: .init(symbol: "tBTC", name: "Test Bitcoin", decimals: 8),
        rpcEndpoints: ["https://blockstream.info/testnet/api"],
        blockExplorerUrl: "https://mempool.space/testnet",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_bitcoin.jpg",
        isTestnet: true,
        supportsEip1559: false,
        averageBlockTime: 600,
        multicall3Address: nil
    )

    public static let solanaDevnet = NetworkDefinition(
        chainId: 103,
        namespace: .solana,
        name: "Solana Devnet",
        shortName: "SOL-DEV",
        nativeCurrency: .init(symbol: "SOL", name: "Solana", decimals: 9),
        rpcEndpoints: ["https://api.devnet.solana.com"],
        blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
        iconUrl: "https://icons.llamao.fi/icons/chains/rsz_solana.jpg",
        isTestnet: true,
        supportsEip1559: false,
        averageBlockTime: 1,
        multicall3Address: nil
    )
}
