/**
 * EVM network registry for the Aethelred Wallet.
 *
 * This module is the single source of truth for every chain the wallet
 * officially supports. Each {@link NetworkDefinition} carries the metadata the
 * UI needs to render the chain picker, the metadata the {@link RpcClient}
 * needs to connect, and enough extra context for future features such as
 * Multicall3 aggregation.
 *
 * Provenance:
 *  - Chain IDs and native currency metadata are taken from
 *    https://chainlist.org and cross-referenced against each chain's
 *    official documentation / block explorer.
 *  - RPC endpoints are chosen from the "public" / "unrestricted" tier on
 *    chainlist.org. We deliberately avoid any endpoint that requires an API
 *    key (Infura, Alchemy, QuickNode) so the wallet never ships team
 *    credentials to end users.
 *  - Multicall3 addresses come from https://www.multicall3.com — the
 *    canonical deterministic deployment
 *    (0xcA11bde05977b3631167028862bE2a173976CA11) covers every chain listed
 *    there; omitted for chains where it has not yet been deployed at the
 *    canonical address.
 *
 * The registry is namespaced so that non-EVM chains (BTC, SOL, Cosmos) can be
 * slotted in later without breaking consumers that filter by
 * {@link NetworkDefinition.namespace}.
 */

/**
 * Supported chain namespaces.
 *
 * Follows the CAIP-2 namespace convention
 * (https://chainagnostic.org/CAIPs/caip-2). Non-EVM namespaces
 * (`bip122` for Bitcoin, `solana` for Solana) were added to the union
 * when the wallet gained non-EVM signer packages. Callers that only
 * handle EVM chains should narrow on `namespace === "eip155"` before
 * dereferencing EVM-specific fields like `multicall3Address`.
 */
export type ChainNamespace = "eip155" | "bip122" | "solana";

/**
 * Metadata for the native currency of a chain.
 */
export interface NativeCurrency {
  /** Ticker symbol shown in the UI (e.g. "ETH", "MATIC"). */
  readonly symbol: string;
  /** Human-readable name (e.g. "Ether", "Polygon"). */
  readonly name: string;
  /** Number of decimals the native unit uses. Always 18 for EVM chains today. */
  readonly decimals: number;
}

/**
 * Full definition of a blockchain network the wallet knows how to talk to.
 *
 * Every field is `readonly` so constants exported from this module cannot be
 * mutated at runtime — the registry is intended to be deep-frozen config.
 */
export interface NetworkDefinition {
  /**
   * Numeric chain ID as seen by `eth_chainId`.
   *
   * Canonical source is https://chainlist.org, cross-checked against the
   * chain's official docs.
   */
  readonly chainId: number;
  /**
   * CAIP-2 namespace. Always `"eip155"` for EVM chains defined here.
   */
  readonly namespace: ChainNamespace;
  /** Full display name (e.g. "Ethereum Mainnet"). */
  readonly name: string;
  /** Short symbol shown in compact UI affordances (e.g. "ETH", "OP"). */
  readonly shortName: string;
  /** Native currency metadata. */
  readonly nativeCurrency: NativeCurrency;
  /**
   * Ordered list of JSON-RPC endpoints.
   *
   * The first entry is the preferred endpoint; the rest are fallbacks that
   * {@link RpcClient} will rotate through on failure. All endpoints are
   * public — we never include URLs that embed team API keys.
   */
  readonly rpcEndpoints: readonly string[];
  /** Default block explorer for address/tx links. */
  readonly blockExplorerUrl: string;
  /** Publicly hosted logo URL for the chain. */
  readonly iconUrl: string;
  /** True when the chain is a test network. */
  readonly isTestnet: boolean;
  /** True when the chain supports EIP-1559 dynamic fee transactions. */
  readonly supportsEip1559: boolean;
  /** Approximate block time in seconds. Used for UX hints ("~12s"). */
  readonly averageBlockTime: number;
  /**
   * Address of the Multicall3 contract on this chain, if deployed.
   *
   * Reserved for future batch-read aggregation; consumers may omit support
   * today. Left `undefined` when the chain does not yet have the canonical
   * deployment.
   */
  readonly multicall3Address?: string;
}

/**
 * Canonical Multicall3 address used on every chain that has adopted the
 * deterministic deployment. Breaking it out into a constant keeps the chain
 * definitions below tight and makes future audits grep-friendly.
 */
const MULTICALL3_CANONICAL = "0xcA11bde05977b3631167028862bE2a173976CA11";

// ---------------------------------------------------------------------------
// Mainnets
// ---------------------------------------------------------------------------

/**
 * Ethereum Mainnet (chain ID 1). The reference L1 the rest of the EVM
 * ecosystem derives from. RPC endpoints pulled from chainlist.org's
 * unrestricted public set.
 */
export const ETHEREUM_MAINNET: NetworkDefinition = {
  chainId: 1,
  namespace: "eip155",
  name: "Ethereum Mainnet",
  shortName: "ETH",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://eth.llamarpc.com",
    "https://ethereum-rpc.publicnode.com",
    "https://rpc.ankr.com/eth",
    "https://cloudflare-eth.com",
  ],
  blockExplorerUrl: "https://etherscan.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 12,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Polygon PoS (chain ID 137). EVM-equivalent sidechain, formerly Matic.
 * EIP-1559 went live on Polygon in January 2022.
 */
export const POLYGON_MAINNET: NetworkDefinition = {
  chainId: 137,
  namespace: "eip155",
  name: "Polygon Mainnet",
  shortName: "MATIC",
  nativeCurrency: { symbol: "MATIC", name: "Polygon", decimals: 18 },
  rpcEndpoints: [
    "https://polygon-rpc.com",
    "https://polygon.llamarpc.com",
    "https://polygon-bor-rpc.publicnode.com",
    "https://rpc.ankr.com/polygon",
  ],
  blockExplorerUrl: "https://polygonscan.com",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Base Mainnet (chain ID 8453). Coinbase's Optimism Superchain L2.
 */
export const BASE_MAINNET: NetworkDefinition = {
  chainId: 8453,
  namespace: "eip155",
  name: "Base",
  shortName: "BASE",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://mainnet.base.org",
    "https://base.llamarpc.com",
    "https://base-rpc.publicnode.com",
    "https://base.blockpi.network/v1/rpc/public",
  ],
  blockExplorerUrl: "https://basescan.org",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * OP Mainnet (chain ID 10). The original Optimism rollup and the seed chain
 * of the Superchain ecosystem.
 */
export const OPTIMISM_MAINNET: NetworkDefinition = {
  chainId: 10,
  namespace: "eip155",
  name: "OP Mainnet",
  shortName: "OP",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://mainnet.optimism.io",
    "https://optimism.llamarpc.com",
    "https://optimism-rpc.publicnode.com",
    "https://rpc.ankr.com/optimism",
  ],
  blockExplorerUrl: "https://optimistic.etherscan.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Arbitrum One (chain ID 42161). Offchain Labs' flagship optimistic rollup.
 * Arbitrum uses a custom fee model; `supportsEip1559` is still true because
 * the RPC surface accepts EIP-1559 style transactions.
 */
export const ARBITRUM_MAINNET: NetworkDefinition = {
  chainId: 42161,
  namespace: "eip155",
  name: "Arbitrum One",
  shortName: "ARB",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://arb1.arbitrum.io/rpc",
    "https://arbitrum.llamarpc.com",
    "https://arbitrum-one-rpc.publicnode.com",
    "https://rpc.ankr.com/arbitrum",
  ],
  blockExplorerUrl: "https://arbiscan.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 1,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Avalanche C-Chain (chain ID 43114). Ava Labs' EVM-compatible primary
 * network used for smart contract execution.
 */
export const AVALANCHE_MAINNET: NetworkDefinition = {
  chainId: 43114,
  namespace: "eip155",
  name: "Avalanche C-Chain",
  shortName: "AVAX",
  nativeCurrency: { symbol: "AVAX", name: "Avalanche", decimals: 18 },
  rpcEndpoints: [
    "https://api.avax.network/ext/bc/C/rpc",
    "https://avalanche-c-chain-rpc.publicnode.com",
    "https://rpc.ankr.com/avalanche",
    "https://avax.meowrpc.com",
  ],
  blockExplorerUrl: "https://snowtrace.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * BNB Smart Chain (chain ID 56). Binance's EVM-compatible PoS chain.
 * Does not yet support EIP-1559 fee markets on the mainnet.
 */
export const BNB_MAINNET: NetworkDefinition = {
  chainId: 56,
  namespace: "eip155",
  name: "BNB Smart Chain",
  shortName: "BNB",
  nativeCurrency: { symbol: "BNB", name: "BNB", decimals: 18 },
  rpcEndpoints: [
    "https://bsc-dataseed.bnbchain.org",
    "https://bsc.llamarpc.com",
    "https://bsc-rpc.publicnode.com",
    "https://rpc.ankr.com/bsc",
  ],
  blockExplorerUrl: "https://bscscan.com",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_binance.jpg",
  isTestnet: false,
  supportsEip1559: false,
  averageBlockTime: 3,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Gnosis Chain (chain ID 100). Formerly xDai — a stable-token EVM L1 whose
 * native currency is the xDAI stablecoin.
 */
export const GNOSIS_MAINNET: NetworkDefinition = {
  chainId: 100,
  namespace: "eip155",
  name: "Gnosis Chain",
  shortName: "GNO",
  nativeCurrency: { symbol: "XDAI", name: "xDAI", decimals: 18 },
  rpcEndpoints: [
    "https://rpc.gnosischain.com",
    "https://gnosis-rpc.publicnode.com",
    "https://rpc.ankr.com/gnosis",
    "https://gnosis.drpc.org",
  ],
  blockExplorerUrl: "https://gnosisscan.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_xdai.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 5,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * zkSync Era (chain ID 324). Matter Labs' ZK rollup. EIP-1559 is not
 * supported — zkSync Era uses a single `maxFeePerGas` with on-chain pricing.
 */
export const ZKSYNC_ERA_MAINNET: NetworkDefinition = {
  chainId: 324,
  namespace: "eip155",
  name: "zkSync Era",
  shortName: "ZKSYNC",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://mainnet.era.zksync.io",
    "https://zksync.drpc.org",
    "https://zksync-era.blockpi.network/v1/rpc/public",
  ],
  blockExplorerUrl: "https://explorer.zksync.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_zksync%20era.jpg",
  isTestnet: false,
  supportsEip1559: false,
  averageBlockTime: 1,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Linea (chain ID 59144). ConsenSys' Type-2 zkEVM.
 */
export const LINEA_MAINNET: NetworkDefinition = {
  chainId: 59144,
  namespace: "eip155",
  name: "Linea",
  shortName: "LINEA",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://rpc.linea.build",
    "https://linea-rpc.publicnode.com",
    "https://linea.drpc.org",
  ],
  blockExplorerUrl: "https://lineascan.build",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_linea.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Scroll (chain ID 534352). Bytecode-level zkEVM rollup.
 */
export const SCROLL_MAINNET: NetworkDefinition = {
  chainId: 534352,
  namespace: "eip155",
  name: "Scroll",
  shortName: "SCR",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://rpc.scroll.io",
    "https://scroll-mainnet.public.blastapi.io",
    "https://scroll.drpc.org",
    "https://rpc.ankr.com/scroll",
  ],
  blockExplorerUrl: "https://scrollscan.com",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_scroll.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 3,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Mantle Network (chain ID 5000). Modular L2 with a native MNT token used
 * for gas.
 */
export const MANTLE_MAINNET: NetworkDefinition = {
  chainId: 5000,
  namespace: "eip155",
  name: "Mantle",
  shortName: "MNT",
  nativeCurrency: { symbol: "MNT", name: "Mantle", decimals: 18 },
  rpcEndpoints: [
    "https://rpc.mantle.xyz",
    "https://mantle-rpc.publicnode.com",
    "https://mantle.drpc.org",
    "https://rpc.ankr.com/mantle",
  ],
  blockExplorerUrl: "https://mantlescan.xyz",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_mantle.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Celo Mainnet (chain ID 42220). Mobile-first PoS chain. Celo transitioned
 * to an L2 in 2025 but the canonical chain ID is unchanged.
 */
export const CELO_MAINNET: NetworkDefinition = {
  chainId: 42220,
  namespace: "eip155",
  name: "Celo",
  shortName: "CELO",
  nativeCurrency: { symbol: "CELO", name: "Celo", decimals: 18 },
  rpcEndpoints: [
    "https://forno.celo.org",
    "https://rpc.ankr.com/celo",
    "https://celo.drpc.org",
  ],
  blockExplorerUrl: "https://celoscan.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_celo.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 5,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Fantom Opera (chain ID 250). High-throughput L1 using the Lachesis
 * consensus engine.
 */
export const FANTOM_MAINNET: NetworkDefinition = {
  chainId: 250,
  namespace: "eip155",
  name: "Fantom Opera",
  shortName: "FTM",
  nativeCurrency: { symbol: "FTM", name: "Fantom", decimals: 18 },
  rpcEndpoints: [
    "https://rpc.ftm.tools",
    "https://fantom-rpc.publicnode.com",
    "https://rpc.ankr.com/fantom",
    "https://fantom.drpc.org",
  ],
  blockExplorerUrl: "https://ftmscan.com",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_fantom.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 1,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Blast (chain ID 81457). L2 offering native yield on ETH and stablecoin
 * deposits.
 */
export const BLAST_MAINNET: NetworkDefinition = {
  chainId: 81457,
  namespace: "eip155",
  name: "Blast",
  shortName: "BLAST",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://rpc.blast.io",
    "https://blast-rpc.publicnode.com",
    "https://blast.drpc.org",
    "https://rpc.ankr.com/blast",
  ],
  blockExplorerUrl: "https://blastscan.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_blast.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Mode (chain ID 34443). OP Stack L2 focused on onchain DeFi incentives.
 */
export const MODE_MAINNET: NetworkDefinition = {
  chainId: 34443,
  namespace: "eip155",
  name: "Mode",
  shortName: "MODE",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://mainnet.mode.network",
    "https://mode.drpc.org",
  ],
  blockExplorerUrl: "https://explorer.mode.network",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_mode.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Zora Network (chain ID 7777777). Creator-focused OP Stack L2.
 */
export const ZORA_MAINNET: NetworkDefinition = {
  chainId: 7777777,
  namespace: "eip155",
  name: "Zora",
  shortName: "ZORA",
  nativeCurrency: { symbol: "ETH", name: "Ether", decimals: 18 },
  rpcEndpoints: [
    "https://rpc.zora.energy",
    "https://zora.drpc.org",
  ],
  blockExplorerUrl: "https://explorer.zora.energy",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_zora.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * opBNB (chain ID 204). BNB Chain's OP Stack L2.
 */
export const OPBNB_MAINNET: NetworkDefinition = {
  chainId: 204,
  namespace: "eip155",
  name: "opBNB",
  shortName: "OPBNB",
  nativeCurrency: { symbol: "BNB", name: "BNB", decimals: 18 },
  rpcEndpoints: [
    "https://opbnb-mainnet-rpc.bnbchain.org",
    "https://opbnb-rpc.publicnode.com",
    "https://opbnb.drpc.org",
  ],
  blockExplorerUrl: "https://opbnbscan.com",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_op_bnb.jpg",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 1,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Aethelred Mainnet (chain ID 42069 — **placeholder**).
 *
 * The production chain ID has not yet been registered with chainlist.org /
 * EIP-155 and must be re-confirmed before ship. The RPC endpoint below is a
 * local/staging placeholder; do **not** rely on it outside dev.
 */
export const AETHELRED_MAINNET: NetworkDefinition = {
  chainId: 42069,
  namespace: "eip155",
  name: "Aethelred",
  shortName: "AETH",
  nativeCurrency: { symbol: "AETH", name: "Aethelred", decimals: 18 },
  rpcEndpoints: ["https://rpc.aethelred.network"],
  blockExplorerUrl: "https://explorer.aethelred.network",
  iconUrl: "https://aethelred.network/icon.png",
  isTestnet: false,
  supportsEip1559: true,
  averageBlockTime: 2,
};

// ---------------------------------------------------------------------------
// Testnets
// ---------------------------------------------------------------------------

/**
 * Ethereum Sepolia testnet (chain ID 11155111). The current preferred
 * long-lived testnet after Goerli's deprecation.
 */
export const ETHEREUM_SEPOLIA: NetworkDefinition = {
  chainId: 11155111,
  namespace: "eip155",
  name: "Sepolia",
  shortName: "SEP",
  nativeCurrency: { symbol: "ETH", name: "Sepolia Ether", decimals: 18 },
  rpcEndpoints: [
    "https://ethereum-sepolia-rpc.publicnode.com",
    "https://rpc.sepolia.org",
    "https://rpc.ankr.com/eth_sepolia",
    "https://sepolia.drpc.org",
  ],
  blockExplorerUrl: "https://sepolia.etherscan.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg",
  isTestnet: true,
  supportsEip1559: true,
  averageBlockTime: 12,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Polygon Amoy testnet (chain ID 80002). Replaced Mumbai in April 2024.
 */
export const POLYGON_AMOY: NetworkDefinition = {
  chainId: 80002,
  namespace: "eip155",
  name: "Polygon Amoy",
  shortName: "AMOY",
  nativeCurrency: { symbol: "MATIC", name: "Polygon", decimals: 18 },
  rpcEndpoints: [
    "https://rpc-amoy.polygon.technology",
    "https://polygon-amoy-bor-rpc.publicnode.com",
    "https://polygon-amoy.drpc.org",
  ],
  blockExplorerUrl: "https://amoy.polygonscan.com",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_polygon.jpg",
  isTestnet: true,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Base Sepolia testnet (chain ID 84532).
 */
export const BASE_SEPOLIA: NetworkDefinition = {
  chainId: 84532,
  namespace: "eip155",
  name: "Base Sepolia",
  shortName: "BASE-SEP",
  nativeCurrency: { symbol: "ETH", name: "Sepolia Ether", decimals: 18 },
  rpcEndpoints: [
    "https://sepolia.base.org",
    "https://base-sepolia-rpc.publicnode.com",
    "https://base-sepolia.drpc.org",
  ],
  blockExplorerUrl: "https://sepolia.basescan.org",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_base.jpg",
  isTestnet: true,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Optimism Sepolia testnet (chain ID 11155420).
 */
export const OPTIMISM_SEPOLIA: NetworkDefinition = {
  chainId: 11155420,
  namespace: "eip155",
  name: "OP Sepolia",
  shortName: "OP-SEP",
  nativeCurrency: { symbol: "ETH", name: "Sepolia Ether", decimals: 18 },
  rpcEndpoints: [
    "https://sepolia.optimism.io",
    "https://optimism-sepolia-rpc.publicnode.com",
    "https://optimism-sepolia.drpc.org",
  ],
  blockExplorerUrl: "https://sepolia-optimism.etherscan.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_optimism.jpg",
  isTestnet: true,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Arbitrum Sepolia testnet (chain ID 421614).
 */
export const ARBITRUM_SEPOLIA: NetworkDefinition = {
  chainId: 421614,
  namespace: "eip155",
  name: "Arbitrum Sepolia",
  shortName: "ARB-SEP",
  nativeCurrency: { symbol: "ETH", name: "Sepolia Ether", decimals: 18 },
  rpcEndpoints: [
    "https://sepolia-rollup.arbitrum.io/rpc",
    "https://arbitrum-sepolia-rpc.publicnode.com",
    "https://arbitrum-sepolia.drpc.org",
  ],
  blockExplorerUrl: "https://sepolia.arbiscan.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg",
  isTestnet: true,
  supportsEip1559: true,
  averageBlockTime: 1,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * Avalanche Fuji testnet (chain ID 43113).
 */
export const AVALANCHE_FUJI: NetworkDefinition = {
  chainId: 43113,
  namespace: "eip155",
  name: "Avalanche Fuji",
  shortName: "FUJI",
  nativeCurrency: { symbol: "AVAX", name: "Avalanche", decimals: 18 },
  rpcEndpoints: [
    "https://api.avax-test.network/ext/bc/C/rpc",
    "https://avalanche-fuji-c-chain-rpc.publicnode.com",
    "https://rpc.ankr.com/avalanche_fuji",
  ],
  blockExplorerUrl: "https://testnet.snowtrace.io",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_avalanche.jpg",
  isTestnet: true,
  supportsEip1559: true,
  averageBlockTime: 2,
  multicall3Address: MULTICALL3_CANONICAL,
};

/**
 * BNB Smart Chain testnet (chain ID 97).
 */
export const BNB_TESTNET: NetworkDefinition = {
  chainId: 97,
  namespace: "eip155",
  name: "BNB Smart Chain Testnet",
  shortName: "BNB-T",
  nativeCurrency: { symbol: "tBNB", name: "Test BNB", decimals: 18 },
  rpcEndpoints: [
    "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    "https://bsc-testnet-rpc.publicnode.com",
    "https://bsc-testnet.drpc.org",
  ],
  blockExplorerUrl: "https://testnet.bscscan.com",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_binance.jpg",
  isTestnet: true,
  supportsEip1559: false,
  averageBlockTime: 3,
  multicall3Address: MULTICALL3_CANONICAL,
};

// ---------------------------------------------------------------------------
// Non-EVM networks (bip122 — Bitcoin, solana — Solana)
// ---------------------------------------------------------------------------

// Non-EVM chains do not expose an integer `chainId` in the EIP-155 sense.
// To keep our registry keyed by a single primitive we assign synthetic
// IDs that never collide with registered EVM chain IDs:
//   - Bitcoin uses 0 (mainnet) and -1 (testnet). A positive "1" would
//     collide with Ethereum mainnet, so we lean on a negative sentinel
//     instead; both values are documented as placeholders.
//   - Solana uses 101 (mainnet-beta), 102 (testnet), and 103 (devnet)
//     per the convention in
//     https://github.com/ChainAgnostic/namespaces/tree/main/solana.
// Consumers that care about the "real" network identity should branch
// on `namespace` and inspect chain-specific fields (`hrp`, `cluster`, …)
// published by the non-EVM helper packages.

/**
 * Bitcoin Mainnet network definition (`bip122` namespace).
 *
 * `chainId` of `0` is a sentinel — Bitcoin does not have a numeric
 * chain id in the EIP-155 sense. The RPC endpoints are public Bitcoin
 * REST APIs the wallet uses for UTXO fetch and transaction broadcast;
 * neither `multicall3Address` nor `supportsEip1559` apply.
 */
export const BITCOIN_MAINNET: NetworkDefinition = {
  chainId: 0,
  namespace: "bip122",
  name: "Bitcoin",
  shortName: "BTC",
  nativeCurrency: { symbol: "BTC", name: "Bitcoin", decimals: 8 },
  rpcEndpoints: [
    "https://blockstream.info/api",
    "https://mempool.space/api",
  ],
  blockExplorerUrl: "https://mempool.space",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_bitcoin.jpg",
  isTestnet: false,
  supportsEip1559: false,
  averageBlockTime: 600,
};

/**
 * Bitcoin Testnet (Testnet3) network definition.
 *
 * `chainId` is a negative sentinel (`-1`) because Bitcoin does not
 * expose a numeric chain identifier in the EIP-155 sense and the
 * natural candidate (`1`, matching SLIP-0044's coin-type-1 convention)
 * would collide with Ethereum Mainnet. Callers must branch on
 * `namespace` before interpreting `chainId`.
 */
export const BITCOIN_TESTNET: NetworkDefinition = {
  chainId: -1,
  namespace: "bip122",
  name: "Bitcoin Testnet",
  shortName: "tBTC",
  nativeCurrency: { symbol: "tBTC", name: "Test Bitcoin", decimals: 8 },
  rpcEndpoints: [
    "https://blockstream.info/testnet/api",
    "https://mempool.space/testnet/api",
  ],
  blockExplorerUrl: "https://mempool.space/testnet",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_bitcoin.jpg",
  isTestnet: true,
  supportsEip1559: false,
  averageBlockTime: 600,
};

/**
 * Solana Mainnet Beta (`chainId` 101 per CAIP solana-namespace convention).
 */
export const SOLANA_MAINNET: NetworkDefinition = {
  chainId: 101,
  namespace: "solana",
  name: "Solana",
  shortName: "SOL",
  nativeCurrency: { symbol: "SOL", name: "Solana", decimals: 9 },
  rpcEndpoints: [
    "https://api.mainnet-beta.solana.com",
    "https://mainnet.helius-rpc.com",
  ],
  blockExplorerUrl: "https://explorer.solana.com",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_solana.jpg",
  isTestnet: false,
  supportsEip1559: false,
  averageBlockTime: 1,
};

/**
 * Solana Devnet (`chainId` 103).
 */
export const SOLANA_DEVNET: NetworkDefinition = {
  chainId: 103,
  namespace: "solana",
  name: "Solana Devnet",
  shortName: "SOL-DEV",
  nativeCurrency: { symbol: "SOL", name: "Solana", decimals: 9 },
  rpcEndpoints: [
    "https://api.devnet.solana.com",
    "https://devnet.helius-rpc.com",
  ],
  blockExplorerUrl: "https://explorer.solana.com/?cluster=devnet",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_solana.jpg",
  isTestnet: true,
  supportsEip1559: false,
  averageBlockTime: 1,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Every network definition exported by this module, in a stable iteration
 * order (mainnets first, grouped by ecosystem, testnets last).
 *
 * This is the array {@link getNetwork} and friends delegate to. Callers who
 * need the whole catalogue — e.g. the "add network" settings screen — can
 * import it directly.
 */
export const ALL_NETWORKS: readonly NetworkDefinition[] = [
  ETHEREUM_MAINNET,
  POLYGON_MAINNET,
  BASE_MAINNET,
  OPTIMISM_MAINNET,
  ARBITRUM_MAINNET,
  AVALANCHE_MAINNET,
  BNB_MAINNET,
  GNOSIS_MAINNET,
  ZKSYNC_ERA_MAINNET,
  LINEA_MAINNET,
  SCROLL_MAINNET,
  MANTLE_MAINNET,
  CELO_MAINNET,
  FANTOM_MAINNET,
  BLAST_MAINNET,
  MODE_MAINNET,
  ZORA_MAINNET,
  OPBNB_MAINNET,
  AETHELRED_MAINNET,
  BITCOIN_MAINNET,
  SOLANA_MAINNET,
  ETHEREUM_SEPOLIA,
  POLYGON_AMOY,
  BASE_SEPOLIA,
  OPTIMISM_SEPOLIA,
  ARBITRUM_SEPOLIA,
  AVALANCHE_FUJI,
  BNB_TESTNET,
  BITCOIN_TESTNET,
  SOLANA_DEVNET,
];

/**
 * Pre-computed chainId to network lookup. Building the map once at module
 * load keeps {@link getNetwork} O(1) regardless of how many chains we add
 * later.
 */
const CHAIN_ID_INDEX: ReadonlyMap<number, NetworkDefinition> = new Map(
  ALL_NETWORKS.map((network) => [network.chainId, network] as const)
);

/**
 * Look up a network by its numeric chain ID.
 *
 * @returns The matching {@link NetworkDefinition}, or `undefined` if the
 *          chain is not registered.
 */
export const getNetwork = (chainId: number): NetworkDefinition | undefined => {
  return CHAIN_ID_INDEX.get(chainId);
};

/**
 * Return every registered mainnet network.
 *
 * The wallet's chain picker uses this for the "production networks" section.
 */
export const getMainnetNetworks = (): NetworkDefinition[] => {
  return ALL_NETWORKS.filter((network) => !network.isTestnet);
};

/**
 * Return every registered testnet network.
 *
 * Hidden by default in the UI; exposed via the developer-mode toggle.
 */
export const getTestnetNetworks = (): NetworkDefinition[] => {
  return ALL_NETWORKS.filter((network) => network.isTestnet);
};

/**
 * Return every network that belongs to a given CAIP-2 namespace.
 *
 * Populated namespaces today are `"eip155"` (EVM chains), `"bip122"`
 * (Bitcoin mainnet + testnet), and `"solana"` (mainnet-beta + devnet).
 * The signature is left namespace-parameterised so consumers can filter
 * uniformly across chain families.
 */
export const getNetworksForNamespace = (
  ns: ChainNamespace
): NetworkDefinition[] => {
  return ALL_NETWORKS.filter((network) => network.namespace === ns);
};
