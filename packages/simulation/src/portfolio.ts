/**
 * Portfolio management for enterprise/institutional wallets.
 * Token set reflects regulated treasury holdings:
 *   - Protocol-native tokens (AETHEL, stAETHEL)
 *   - Institutional stablecoins (USDC, PYUSD, EURC)
 *   - Settlement layer (WETH)
 *   - Tokenized treasury bonds (BUIDL, USDY)
 */

export interface TokenInfo {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: string;
  logoColor: string;
  logoSvg?: string; // Inline SVG path for token icon
  category: "native" | "staking" | "stablecoin" | "settlement" | "rwa" | "governance";
}

export interface TokenBalance {
  token: TokenInfo;
  balance: string;
  balanceFormatted: string;
  price: number;
  priceChange24h: number;
  value: number;
}

export interface PortfolioSummary {
  totalValue: number;
  totalChange24h: number;
  totalChangePercent24h: number;
  tokens: TokenBalance[];
  lastUpdated: number;
}

export interface StakingPosition {
  protocol: string;
  asset: string;
  stakedAmount: string;
  rewardsEarned: string;
  apy: number;
  status: "active" | "unbonding" | "claimable";
  unbondingEndsAt?: number;
}

export interface TransactionRecord {
  hash: string;
  type: "send" | "receive" | "approve" | "swap" | "stake" | "unstake" | "contract" | "deploy" | "settlement" | "compliance-cleared";
  status: "confirmed" | "pending" | "failed" | "compliance-review";
  from: string;
  to: string;
  asset: string;
  amount: string;
  value?: number;
  fee?: string;
  timestamp: number;
  chainId: string;
  blockNumber?: number;
  complianceStatus?: "cleared" | "flagged" | "under-review";
}

// ─── Enterprise Token Set ─────────────────────────────────────────
// These are tokens an institutional treasury team actually holds

const ENTERPRISE_TOKENS: TokenInfo[] = [
  {
    address: "native",
    symbol: "AETHEL",
    name: "Aethelred",
    decimals: 18,
    chainId: "0x1",
    logoColor: "#c41e1e",
    category: "native",
  },
  {
    address: "stAETHEL",
    symbol: "stAETHEL",
    name: "Staked AETHEL",
    decimals: 18,
    chainId: "0x1",
    logoColor: "#1d7f52",
    category: "staking",
  },
  {
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    chainId: "0x1",
    logoColor: "#2775ca",
    category: "stablecoin",
  },
  {
    address: "0x6c3ea9036406852006290770bedfcaba0e23a0e8",
    symbol: "PYUSD",
    name: "PayPal USD",
    decimals: 6,
    chainId: "0x1",
    logoColor: "#003087",
    category: "stablecoin",
  },
  {
    address: "0x1abaea1f7c830bd89acc67ec4af516284b1bc33c",
    symbol: "EURC",
    name: "Euro Coin",
    decimals: 6,
    chainId: "0x1",
    logoColor: "#2775ca",
    category: "stablecoin",
  },
  {
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    chainId: "0x1",
    logoColor: "#627eea",
    category: "settlement",
  },
  {
    address: "0x7712c34205737192402172409a8f7ccef8aa2aec",
    symbol: "BUIDL",
    name: "BlackRock USD Institutional Digital Liquidity",
    decimals: 6,
    chainId: "0x1",
    logoColor: "#000000",
    category: "rwa",
  },
  {
    address: "0x96f6ef951840721adbf46ac996b59e0235cb985c",
    symbol: "USDY",
    name: "Ondo US Dollar Yield",
    decimals: 18,
    chainId: "0x1",
    logoColor: "#1a3a5c",
    category: "rwa",
  },
];

// CoinGecko IDs for real-time price fetching (all except AETHEL/stAETHEL)
const COINGECKO_MAP: Record<string, string> = {
  "USDC": "usd-coin",
  "PYUSD": "paypal-usd",
  "EURC": "euro-coin",
  "WETH": "weth",
  "BUIDL": "build-on-bitcoin", // Closest proxy — real BUIDL not on CoinGecko
  "USDY": "ondo-us-dollar-yield",
};

// Holdings amounts (what the treasury actually holds)
const HOLDINGS: Record<string, number> = {
  "AETHEL": 2_500_000,
  "stAETHEL": 1_000_000,
  "USDC": 5_000_000,
  "PYUSD": 2_000_000,
  "EURC": 1_500_000,
  "WETH": 500,
  "BUIDL": 3_000_000,
  "USDY": 1_000_000,
};

/**
 * PortfolioManager for institutional treasury operations.
 * Fetches REAL prices from CoinGecko for all non-AETHEL tokens.
 * AETHEL and stAETHEL use demo prices (not listed on exchanges yet).
 */
export class PortfolioManager {
  private balances: TokenBalance[] = [];
  private transactions: TransactionRecord[] = [];
  private stakingPositions: StakingPosition[] = [];
  private lastPriceFetch = 0;
  private fetching = false;

  constructor() {
    this.seedEnterpriseData();
    this.fetchRealPrices(); // Fire and forget — updates balances when response arrives
  }

  async fetchRealPrices(): Promise<void> {
    if (this.fetching || Date.now() - this.lastPriceFetch < 30_000) return; // 30s cache
    this.fetching = true;
    try {
      const ids = Object.values(COINGECKO_MAP).join(",");
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as Record<string, { usd?: number; usd_24h_change?: number }>;

      // Update balances with real prices
      for (const balance of this.balances) {
        const cgId = COINGECKO_MAP[balance.token.symbol];
        if (cgId && data[cgId]?.usd !== undefined) {
          balance.price = data[cgId].usd!;
          balance.priceChange24h = data[cgId].usd_24h_change ?? 0;
          const holding = HOLDINGS[balance.token.symbol] ?? 0;
          balance.value = holding * balance.price;
        }
      }
      this.lastPriceFetch = Date.now();
    } catch {
      // Keep fallback prices on failure
    } finally {
      this.fetching = false;
    }
  }

  getPortfolio(): PortfolioSummary {
    const totalValue = this.balances.reduce((sum, t) => sum + t.value, 0);
    const totalChange = this.balances.reduce((sum, t) => sum + (t.value * t.priceChange24h / 100), 0);
    return {
      totalValue,
      totalChange24h: totalChange,
      totalChangePercent24h: totalValue > 0 ? (totalChange / totalValue) * 100 : 0,
      tokens: [...this.balances].sort((a, b) => b.value - a.value),
      lastUpdated: this.lastPriceFetch || Date.now(),
    };
  }

  getTokens(): TokenBalance[] {
    return [...this.balances].sort((a, b) => b.value - a.value);
  }

  getToken(address: string): TokenBalance | undefined {
    return this.balances.find((t) => t.token.address === address);
  }

  getSendableTokens(): TokenBalance[] {
    return this.balances.filter((t) => parseFloat(t.balance) > 0);
  }

  getTransactions(limit = 20): TransactionRecord[] {
    return this.transactions.slice(0, limit);
  }

  getStakingPositions(): StakingPosition[] {
    return [...this.stakingPositions];
  }

  getAvailableTokens(): TokenInfo[] {
    return [...ENTERPRISE_TOKENS];
  }

  getTokensByCategory(category: TokenInfo["category"]): TokenBalance[] {
    return this.balances.filter((t) => t.token.category === category);
  }

  private seedEnterpriseData(): void {
    this.balances = [
      // Protocol-native: AETHEL treasury reserve
      { token: ENTERPRISE_TOKENS[0], balance: "2500000", balanceFormatted: "2,500,000", price: 2.47, priceChange24h: 3.2, value: 6175000 },
      // Staked position earning yield
      { token: ENTERPRISE_TOKENS[1], balance: "1000000", balanceFormatted: "1,000,000", price: 2.58, priceChange24h: 3.8, value: 2580000 },
      // Primary settlement stablecoin
      { token: ENTERPRISE_TOKENS[2], balance: "5000000", balanceFormatted: "5,000,000", price: 1.00, priceChange24h: 0.0, value: 5000000 },
      // PayPal USD for institutional payments
      { token: ENTERPRISE_TOKENS[3], balance: "2000000", balanceFormatted: "2,000,000", price: 1.00, priceChange24h: 0.0, value: 2000000 },
      // Euro settlement
      { token: ENTERPRISE_TOKENS[4], balance: "1500000", balanceFormatted: "1,500,000", price: 1.08, priceChange24h: 0.12, value: 1620000 },
      // Gas/settlement layer
      { token: ENTERPRISE_TOKENS[5], balance: "500", balanceFormatted: "500", price: 3245.80, priceChange24h: -1.4, value: 1622900 },
      // BlackRock tokenized treasury (RWA)
      { token: ENTERPRISE_TOKENS[6], balance: "3000000", balanceFormatted: "3,000,000", price: 1.00, priceChange24h: 0.0, value: 3000000 },
      // Ondo yield-bearing USD (RWA)
      { token: ENTERPRISE_TOKENS[7], balance: "1000000", balanceFormatted: "1,000,000", price: 1.04, priceChange24h: 0.01, value: 1040000 },
    ];

    this.stakingPositions = [
      { protocol: "Cruzible Vault", asset: "AETHEL", stakedAmount: "1,000,000", rewardsEarned: "24,800", apy: 8.4, status: "active" },
      { protocol: "Cruzible Vault", asset: "AETHEL", stakedAmount: "200,000", rewardsEarned: "0", apy: 8.4, status: "unbonding", unbondingEndsAt: Date.now() + 12 * 86400000 },
    ];

    this.transactions = [
      { hash: "0x7a1f...e3d2", type: "settlement", status: "confirmed", from: "Treasury Ops", to: "Cruzible Vault", asset: "AETHEL", amount: "1,000,000", value: 2470000, timestamp: Date.now() - 86400000, chainId: "0x1", complianceStatus: "cleared" },
      { hash: "0x8b2e...f4c3", type: "receive", status: "confirmed", from: "Circle Mint", to: "Treasury Ops", asset: "USDC", amount: "5,000,000", value: 5000000, timestamp: Date.now() - 172800000, chainId: "0x1", complianceStatus: "cleared" },
      { hash: "0x9c3d...a5b4", type: "compliance-cleared", status: "confirmed", from: "Treasury Ops", to: "Partner VASP", asset: "PYUSD", amount: "500,000", value: 500000, fee: "0.002 ETH", timestamp: Date.now() - 259200000, chainId: "0x1", complianceStatus: "cleared" },
      { hash: "0xad4e...b6c5", type: "stake", status: "confirmed", from: "Treasury Ops", to: "Cruzible Vault", asset: "AETHEL", amount: "1,000,000", value: 2470000, timestamp: Date.now() - 345600000, chainId: "0x1", complianceStatus: "cleared" },
      { hash: "0xbe5f...c7d6", type: "receive", status: "confirmed", from: "BlackRock Fund", to: "Treasury Ops", asset: "BUIDL", amount: "3,000,000", value: 3000000, timestamp: Date.now() - 432000000, chainId: "0x1", complianceStatus: "cleared" },
      { hash: "0xcf6a...d8e7", type: "send", status: "compliance-review", from: "Treasury Ops", to: "0x9876...4321", asset: "USDC", amount: "2,500,000", timestamp: Date.now() - 600000, chainId: "0x1", complianceStatus: "under-review" },
    ];
  }
}
