import type { NetworkConfig } from "./types";

/**
 * NetworkManager handles chain configuration, switching, and multi-chain support.
 */
export class NetworkManager {
  private networks = new Map<string, NetworkConfig>();
  private activeChainId: string;

  constructor() {
    this.seedDefaultNetworks();
    // Aethelred is the wallet's home network: default to the live public
    // testnet (EVM chain-id 7332 = 0x1ca4) so a fresh install connects to the
    // chain out of the box. A persisted activeChainId, when present, overrides
    // this at unlock.
    this.activeChainId = "0x1ca4";
  }

  getActive(): NetworkConfig {
    return this.networks.get(this.activeChainId)!;
  }

  getActiveChainId(): string {
    return this.activeChainId;
  }

  switchChain(chainId: string): NetworkConfig {
    const network = this.networks.get(chainId);
    if (!network) {
      throw new Error(`Network not found: ${chainId}`);
    }
    this.activeChainId = chainId;
    return network;
  }

  getNetwork(chainId: string): NetworkConfig | undefined {
    return this.networks.get(chainId);
  }

  listNetworks(): NetworkConfig[] {
    return Array.from(this.networks.values());
  }

  listMainnets(): NetworkConfig[] {
    return this.listNetworks().filter((n) => !n.isTestnet);
  }

  listTestnets(): NetworkConfig[] {
    return this.listNetworks().filter((n) => n.isTestnet);
  }

  addCustomNetwork(config: NetworkConfig): void {
    this.networks.set(config.chainId, config);
  }

  /**
   * Point an existing network at a different RPC endpoint — how a user brings
   * their own node, or how a local devnet that shares a public chain id
   * (e.g. anvil running as 7332) becomes reachable. Only the rpcUrl changes;
   * chain identity, currency, and explorer stay as registered.
   */
  updateNetworkRpc(chainId: string, rpcUrl: string): NetworkConfig {
    const network = this.networks.get(chainId);
    if (!network) {
      throw new Error(`Network not found: ${chainId}`);
    }
    const updated = { ...network, rpcUrl };
    this.networks.set(chainId, updated);
    return updated;
  }

  removeCustomNetwork(chainId: string): void {
    const network = this.networks.get(chainId);
    if (network && !DEFAULT_CHAIN_IDS.has(chainId)) {
      this.networks.delete(chainId);
    }
  }

  private seedDefaultNetworks(): void {
    const defaults: NetworkConfig[] = [
      {
        // Aethelred public testnet — EVM face (chain-id 7332 = 0x1ca4). The
        // node exposes JSON-RPC; balances are 18-decimal via x/precisebank.
        // rpcUrl points at a live validator until a load-balanced DNS
        // endpoint (rpc.testnet.aethelred.io) is provisioned.
        chainId: "0x1ca4",
        name: "Aethelred Testnet",
        rpcUrl: "http://54.165.44.130:8545",
        nativeCurrency: { name: "AETHEL", symbol: "AETHEL", decimals: 18 },
        blockExplorerUrl: "https://explorer.testnet.aethelred.io",
        isTestnet: true,
      },
      {
        chainId: "0x1",
        name: "Ethereum",
        rpcUrl: "https://eth.llamarpc.com",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorerUrl: "https://etherscan.io",
        isTestnet: false,
      },
      {
        chainId: "0x89",
        name: "Polygon",
        rpcUrl: "https://polygon.llamarpc.com",
        nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
        blockExplorerUrl: "https://polygonscan.com",
        isTestnet: false,
      },
      {
        chainId: "0xa4b1",
        name: "Arbitrum One",
        rpcUrl: "https://arbitrum.llamarpc.com",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorerUrl: "https://arbiscan.io",
        isTestnet: false,
      },
      {
        chainId: "0x2105",
        name: "Base",
        rpcUrl: "https://base.llamarpc.com",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorerUrl: "https://basescan.org",
        isTestnet: false,
      },
      {
        chainId: "0xa",
        name: "Optimism",
        rpcUrl: "https://optimism.llamarpc.com",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorerUrl: "https://optimistic.etherscan.io",
        isTestnet: false,
      },
      {
        chainId: "0xaa36a7",
        name: "Sepolia",
        rpcUrl: "https://rpc.sepolia.org",
        nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
        blockExplorerUrl: "https://sepolia.etherscan.io",
        isTestnet: true,
      },
    ];

    for (const network of defaults) {
      this.networks.set(network.chainId, network);
    }
  }
}

const DEFAULT_CHAIN_IDS = new Set(["0x1ca4", "0x1", "0x89", "0xa4b1", "0x2105", "0xa", "0xaa36a7"]);
