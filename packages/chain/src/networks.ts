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
 * (https://chainagnostic.org/CAIPs/caip-2). Non-EVM namespaces were
 * added to the union as the wallet gained non-EVM signer packages:
 *
 *   - `eip155` — EVM chains (Ethereum, Polygon, Base, ...)
 *   - `bip122` — Bitcoin (mainnet + testnet)
 *   - `solana` — Solana (mainnet-beta + devnet)
 *   - `cosmos` — Cosmos SDK chains whose chain ID is a string
 *     (e.g. `cosmoshub-4`, `osmosis-1`, `celestia`)
 *   - `aptos`  — Aptos (mainnet, testnet)
 *   - `sui`    — Sui, whose chain ID is a label string
 *     (`"mainnet"`, `"testnet"`)
 *
 * Callers that only handle EVM chains should narrow on
 * `namespace === "eip155"` before dereferencing EVM-specific fields
 * like `multicall3Address` or treating `chainId` as a chain-id in the
 * EIP-155 sense.
 */
export type ChainNamespace =
  | "eip155"
  | "bip122"
  | "solana"
  | "cosmos"
  | "aptos"
  | "sui";

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
   * Numeric chain ID as seen by `eth_chainId` for EVM chains.
   *
   * Canonical source is https://chainlist.org, cross-checked against the
   * chain's official docs.
   *
   * For non-EVM chains whose canonical chain id is a string (Cosmos SDK
   * chains, Sui), this is a synthetic numeric sentinel used only as the
   * registry key — the "real" chain id lives in
   * {@link chainIdString}. Sentinels are disjoint from every registered
   * EVM chain id and from every other namespace's sentinel block, so
   * `getNetwork(n)` always resolves to at most one network. See the
   * comment above the non-EVM section for the numbering scheme.
   *
   * **Type-system trade-off (Option B):** we deliberately keep this
   * field as `number` rather than widening to `number | string`.
   * Widening cascaded through RPC clients, policy engines, tx managers,
   * and persistence layers that already assume numeric ids; the
   * synthetic-sentinel approach we use for Bitcoin (chain ids 0 / -1)
   * predates Cosmos/Sui support and the registry stays consistent. The
   * cost is that callers comparing against a CAIP-2 string must read
   * {@link chainIdString} first — the additional string accessor
   * {@link getNetworkByChainIdString} makes that lookup explicit.
   */
  readonly chainId: number;
  /**
   * CAIP-2 namespace. Always `"eip155"` for EVM chains defined here.
   */
  readonly namespace: ChainNamespace;
  /**
   * String chain id, when the underlying ecosystem uses non-numeric
   * identifiers. Populated for `cosmos` and `sui` namespaces; omitted
   * for namespaces whose chain id is genuinely numeric (eip155, aptos).
   *
   * Examples: `"cosmoshub-4"`, `"osmosis-1"`, `"celestia"`,
   * `"mainnet"`, `"testnet"`.
   */
  readonly chainIdString?: string;
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
 * Aethelred (chain ID 7332 — **confirmed**).
 *
 * The chain id is no longer a placeholder: 7332 is the EIP-155 id baked into
 * aethelredd's in-state EVM chain config (`eth_chainId` returns `0x1ca4`).
 * Native currency is AETHEL with 18 decimals as presented by the EVM — the
 * chain's bank denom is 6-decimal `uaethel`, bridged 1e12 → `aaethel` by
 * x/precisebank, so wallet balances and tx values are exact wei-style values.
 *
 * RPC: the first endpoint is the local node's JSON-RPC
 * (`aethelredd start --json-rpc.enable`, default 127.0.0.1:8545) — the
 * supported endpoint while the chain is in its public-testnet phase. Prepend
 * the public RPC once it is live, and flip `isTestnet` only when a production
 * network actually exists.
 */
export const AETHELRED: NetworkDefinition = {
  chainId: 7332,
  namespace: "eip155",
  name: "Aethelred",
  shortName: "AETHEL",
  nativeCurrency: { symbol: "AETHEL", name: "Aethelred", decimals: 18 },
  // Public testnet endpoints (live since 2026-07-07; five genesis validators).
  // The RpcClient rotates through them on failure; the local node stays last
  // as the development fallback. Replace with DNS-based endpoints once the
  // rpc.testnet domain is provisioned.
  rpcEndpoints: [
    "http://54.165.44.130:8545",
    "http://35.255.95.138:8545",
    "http://35.253.47.12:8545",
    "http://34.44.135.107:8545",
    "http://35.232.198.204:8545",
    "http://127.0.0.1:8545",
  ],
  blockExplorerUrl: "https://explorer.aethelred.network",
  iconUrl: "https://aethelred.network/icon.png",
  isTestnet: true,
  supportsEip1559: true,
  averageBlockTime: 5,
};

/**
 * @deprecated The chain id is confirmed (7332) and no public mainnet exists
 * yet — use {@link AETHELRED}. Kept as an alias so existing consumers keep
 * compiling; remove after callers migrate.
 */
export const AETHELRED_MAINNET: NetworkDefinition = AETHELRED;

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
// Non-EVM networks (bip122 — Bitcoin, solana — Solana, cosmos — Cosmos SDK
// chains, aptos — Aptos, sui — Sui)
// ---------------------------------------------------------------------------

// Non-EVM chains do not expose an integer `chainId` in the EIP-155 sense.
// To keep our registry keyed by a single primitive we assign synthetic
// IDs that never collide with registered EVM chain IDs. Each namespace
// gets its own non-overlapping sentinel range so `getNetwork(n)` stays
// unambiguous:
//
//   - Bitcoin: 0 (mainnet) and -1 (testnet). A positive "1" would
//     collide with Ethereum mainnet, so we lean on a negative sentinel
//     for testnet instead; both values are documented as placeholders.
//   - Solana: 101 (mainnet-beta), 102 (testnet), and 103 (devnet) per
//     the convention in
//     https://github.com/ChainAgnostic/namespaces/tree/main/solana.
//   - Cosmos SDK: -100 block — Cosmos chain ids are strings
//     (cosmoshub-4, osmosis-1, ...), so the numeric key is synthetic
//     and `chainIdString` carries the real value.
//   - Aptos: 1 (mainnet) and 2 (testnet) — Aptos genuinely uses small
//     integer chain ids and these are the official values. They collide
//     with Ethereum Mainnet and Expanse Network respectively — callers
//     MUST branch on `namespace` before treating `chainId` as an
//     EIP-155 id.
//   - Sui: -200 block — Sui labels its environments with string IDs
//     (`"mainnet"`, `"testnet"`). Like Cosmos, the numeric key is
//     synthetic and the canonical id lives in `chainIdString`.
//
// Consumers that care about the "real" network identity should branch
// on `namespace` and inspect chain-specific fields (`hrp`, `cluster`,
// `chainIdString`, …) published by the non-EVM helper packages.

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

/**
 * Cosmos Hub (`chainIdString` `"cosmoshub-4"`). The root hub of the
 * Cosmos ecosystem, secured by ATOM staking. Public RPC endpoints are
 * taken from the Polkachu / Allnodes / Cosmos Directory public lists
 * and cross-referenced against https://cosmos.directory/cosmoshub.
 */
export const COSMOS_HUB_MAINNET: NetworkDefinition = {
  chainId: -100,
  chainIdString: "cosmoshub-4",
  namespace: "cosmos",
  name: "Cosmos Hub",
  shortName: "ATOM",
  nativeCurrency: { symbol: "ATOM", name: "Cosmos Hub Atom", decimals: 6 },
  rpcEndpoints: [
    "https://cosmos-rpc.publicnode.com:443",
    "https://rpc-cosmoshub.blockapsis.com",
    "https://cosmos-rpc.polkachu.com",
  ],
  blockExplorerUrl: "https://www.mintscan.io/cosmos",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_cosmos.jpg",
  isTestnet: false,
  supportsEip1559: false,
  averageBlockTime: 7,
};

/**
 * Osmosis (`chainIdString` `"osmosis-1"`). The largest Cosmos DEX and
 * AMM hub. Native currency is OSMO (6 decimals, like every Cosmos SDK
 * chain's default).
 */
export const OSMOSIS_MAINNET: NetworkDefinition = {
  chainId: -101,
  chainIdString: "osmosis-1",
  namespace: "cosmos",
  name: "Osmosis",
  shortName: "OSMO",
  nativeCurrency: { symbol: "OSMO", name: "Osmosis", decimals: 6 },
  rpcEndpoints: [
    "https://osmosis-rpc.publicnode.com:443",
    "https://rpc.osmosis.zone",
    "https://osmosis-rpc.polkachu.com",
  ],
  blockExplorerUrl: "https://www.mintscan.io/osmosis",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_osmosis.jpg",
  isTestnet: false,
  supportsEip1559: false,
  averageBlockTime: 6,
};

/**
 * Celestia (`chainIdString` `"celestia"`). Modular data-availability
 * layer launched in October 2023. TIA is the native currency.
 */
export const CELESTIA_MAINNET: NetworkDefinition = {
  chainId: -102,
  chainIdString: "celestia",
  namespace: "cosmos",
  name: "Celestia",
  shortName: "TIA",
  nativeCurrency: { symbol: "TIA", name: "Celestia", decimals: 6 },
  rpcEndpoints: [
    "https://celestia-rpc.publicnode.com:443",
    "https://rpc.lunaroasis.net",
    "https://celestia-rpc.polkachu.com",
  ],
  blockExplorerUrl: "https://www.mintscan.io/celestia",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_celestia.jpg",
  isTestnet: false,
  supportsEip1559: false,
  averageBlockTime: 6,
};

/**
 * Aptos Mainnet (chain id `1`). Aptos genuinely uses a small integer
 * chain id — the value collides with Ethereum Mainnet, so callers MUST
 * always branch on `namespace === "aptos"` before dereferencing
 * Aptos-specific fields.
 */
export const APTOS_MAINNET: NetworkDefinition = {
  chainId: 1,
  namespace: "aptos",
  name: "Aptos",
  shortName: "APT",
  nativeCurrency: { symbol: "APT", name: "Aptos", decimals: 8 },
  rpcEndpoints: [
    "https://fullnode.mainnet.aptoslabs.com/v1",
    "https://aptos-mainnet.pontem.network/v1",
  ],
  blockExplorerUrl: "https://explorer.aptoslabs.com",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_aptos.jpg",
  isTestnet: false,
  supportsEip1559: false,
  averageBlockTime: 1,
};

/**
 * Aptos Testnet (chain id `2`). Same caveat as {@link APTOS_MAINNET}:
 * the numeric id collides with Expanse Network (EVM chain id 2), so
 * callers MUST branch on namespace first.
 */
export const APTOS_TESTNET: NetworkDefinition = {
  chainId: 2,
  namespace: "aptos",
  name: "Aptos Testnet",
  shortName: "APT-T",
  nativeCurrency: { symbol: "APT", name: "Aptos", decimals: 8 },
  rpcEndpoints: [
    "https://fullnode.testnet.aptoslabs.com/v1",
  ],
  blockExplorerUrl: "https://explorer.aptoslabs.com/?network=testnet",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_aptos.jpg",
  isTestnet: true,
  supportsEip1559: false,
  averageBlockTime: 1,
};

/**
 * Sui Mainnet (`chainIdString` `"mainnet"`). Sui labels environments
 * with string IDs rather than numeric chain ids, so we use a synthetic
 * numeric sentinel and carry the canonical value in
 * {@link NetworkDefinition.chainIdString}.
 */
export const SUI_MAINNET: NetworkDefinition = {
  chainId: -200,
  chainIdString: "mainnet",
  namespace: "sui",
  name: "Sui",
  shortName: "SUI",
  nativeCurrency: { symbol: "SUI", name: "Sui", decimals: 9 },
  rpcEndpoints: [
    "https://fullnode.mainnet.sui.io",
    "https://sui-mainnet-rpc.publicnode.com",
    "https://sui-mainnet-endpoint.blockvision.org",
  ],
  blockExplorerUrl: "https://suiscan.xyz/mainnet",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_sui.jpg",
  isTestnet: false,
  supportsEip1559: false,
  averageBlockTime: 3,
};

/**
 * Sui Testnet (`chainIdString` `"testnet"`).
 */
export const SUI_TESTNET: NetworkDefinition = {
  chainId: -201,
  chainIdString: "testnet",
  namespace: "sui",
  name: "Sui Testnet",
  shortName: "SUI-T",
  nativeCurrency: { symbol: "SUI", name: "Sui", decimals: 9 },
  rpcEndpoints: [
    "https://fullnode.testnet.sui.io",
    "https://sui-testnet-rpc.publicnode.com",
  ],
  blockExplorerUrl: "https://suiscan.xyz/testnet",
  iconUrl: "https://icons.llamao.fi/icons/chains/rsz_sui.jpg",
  isTestnet: true,
  supportsEip1559: false,
  averageBlockTime: 3,
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
  AETHELRED,
  BITCOIN_MAINNET,
  SOLANA_MAINNET,
  COSMOS_HUB_MAINNET,
  OSMOSIS_MAINNET,
  CELESTIA_MAINNET,
  APTOS_MAINNET,
  SUI_MAINNET,
  ETHEREUM_SEPOLIA,
  POLYGON_AMOY,
  BASE_SEPOLIA,
  OPTIMISM_SEPOLIA,
  ARBITRUM_SEPOLIA,
  AVALANCHE_FUJI,
  BNB_TESTNET,
  BITCOIN_TESTNET,
  SOLANA_DEVNET,
  APTOS_TESTNET,
  SUI_TESTNET,
];

/**
 * Pre-computed chainId to network lookup.
 *
 * Because Aptos uses chain ids 1 and 2 (colliding with Ethereum mainnet
 * and Expanse), we prefer the EVM (`eip155`) entry when both exist —
 * existing `getNetwork(1)` callers nearly always mean "Ethereum". Aptos
 * consumers must go through {@link getNetworkByChainIdString} or
 * {@link getNetworksForNamespace} to avoid ambiguity. Building the map
 * once at module load keeps {@link getNetwork} O(1) regardless of how
 * many chains we add later.
 */
const CHAIN_ID_INDEX: ReadonlyMap<number, NetworkDefinition> = (() => {
  const m = new Map<number, NetworkDefinition>();
  // Two passes: EVM wins on collision, then non-EVM fills in any gaps.
  for (const n of ALL_NETWORKS) {
    if (n.namespace === "eip155") m.set(n.chainId, n);
  }
  for (const n of ALL_NETWORKS) {
    if (n.namespace !== "eip155" && !m.has(n.chainId)) m.set(n.chainId, n);
  }
  return m;
})();

/**
 * Pre-computed `chainIdString` to network lookup, keyed by
 * `${namespace}:${chainIdString}` to avoid collisions between
 * namespaces that happen to share an id (e.g. Sui's `"mainnet"` vs a
 * hypothetical future Aptos label).
 */
const CHAIN_ID_STRING_INDEX: ReadonlyMap<string, NetworkDefinition> = new Map(
  ALL_NETWORKS
    .filter((n): n is NetworkDefinition & { chainIdString: string } =>
      typeof n.chainIdString === "string"
    )
    .map((n) => [`${n.namespace}:${n.chainIdString}`, n] as const)
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
 * Look up a network by its string chain ID, scoped by namespace to
 * handle non-EVM chains (Cosmos SDK chains, Sui) whose canonical chain
 * id is a string rather than a number.
 *
 * Example:
 * ```ts
 * getNetworkByChainIdString("cosmos", "cosmoshub-4"); // COSMOS_HUB_MAINNET
 * getNetworkByChainIdString("sui", "mainnet");         // SUI_MAINNET
 * ```
 *
 * @returns The matching {@link NetworkDefinition}, or `undefined` if
 *          no chain in the given namespace has the requested id.
 */
export const getNetworkByChainIdString = (
  namespace: ChainNamespace,
  chainIdString: string,
): NetworkDefinition | undefined => {
  return CHAIN_ID_STRING_INDEX.get(`${namespace}:${chainIdString}`);
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
