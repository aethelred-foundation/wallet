/**
 * Token list service for auto-detecting and managing tracked tokens.
 * Uses popular token lists (Uniswap, 1inch, CoinGecko) as sources.
 */

export interface TokenListEntry {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoColor: string;
  isNative?: boolean;
}

// Curated default token list for Ethereum mainnet
const DEFAULT_TOKENS: TokenListEntry[] = [
  { chainId: 1, address: "native", name: "Ether", symbol: "ETH", decimals: 18, logoColor: "#627eea", isNative: true },
  { chainId: 1, address: "0xdac17f958d2ee523a2206206994597c13d831ec7", name: "Tether USD", symbol: "USDT", decimals: 6, logoColor: "#26a17b" },
  { chainId: 1, address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", name: "USD Coin", symbol: "USDC", decimals: 6, logoColor: "#1a1a1a" },
  { chainId: 1, address: "0x6b175474e89094c44da98b954eedeac495271d0f", name: "Dai Stablecoin", symbol: "DAI", decimals: 18, logoColor: "#f5ac37" },
  { chainId: 1, address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", name: "Wrapped Ether", symbol: "WETH", decimals: 18, logoColor: "#333333" },
  { chainId: 1, address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", name: "Uniswap", symbol: "UNI", decimals: 18, logoColor: "#ff007a" },
  { chainId: 1, address: "0x514910771af9ca656af840dff83e8264ecf986ca", name: "Chainlink", symbol: "LINK", decimals: 18, logoColor: "#375bd2" },
  { chainId: 1, address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", name: "Aave", symbol: "AAVE", decimals: 18, logoColor: "#b6509e" },
];

// Aethelred ecosystem tokens
const AETHELRED_TOKENS: TokenListEntry[] = [
  { chainId: 1, address: "aethel-native", name: "Aethelred", symbol: "AETHEL", decimals: 18, logoColor: "#c41e1e", isNative: true },
  { chainId: 1, address: "stAETHEL", name: "Staked AETHEL", symbol: "stAETHEL", decimals: 18, logoColor: "#1d7f52" },
];

export class TokenListService {
  private tokens: TokenListEntry[] = [];
  private customTokens: TokenListEntry[] = [];

  constructor() {
    this.tokens = [...AETHELRED_TOKENS, ...DEFAULT_TOKENS];
  }

  getTokensForChain(chainId: number): TokenListEntry[] {
    return [...this.tokens, ...this.customTokens].filter((t) => t.chainId === chainId);
  }

  getAllTokens(): TokenListEntry[] {
    return [...this.tokens, ...this.customTokens];
  }

  getToken(address: string): TokenListEntry | undefined {
    const lower = address.toLowerCase();
    return [...this.tokens, ...this.customTokens].find(
      (t) => t.address.toLowerCase() === lower
    );
  }

  searchTokens(query: string): TokenListEntry[] {
    const q = query.toLowerCase();
    return this.getAllTokens().filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
    );
  }

  addCustomToken(token: TokenListEntry): void {
    const existing = this.getToken(token.address);
    if (!existing) {
      this.customTokens.push(token);
    }
  }

  removeCustomToken(address: string): void {
    this.customTokens = this.customTokens.filter(
      (t) => t.address.toLowerCase() !== address.toLowerCase()
    );
  }

  isCustomToken(address: string): boolean {
    return this.customTokens.some(
      (t) => t.address.toLowerCase() === address.toLowerCase()
    );
  }

  loadFromSnapshot(custom: TokenListEntry[]): void {
    this.customTokens = custom;
  }

  toSnapshot(): TokenListEntry[] {
    return [...this.customTokens];
  }
}
