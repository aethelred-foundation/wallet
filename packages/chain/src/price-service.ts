/**
 * Token price service with caching and fail-closed behavior.
 * Fetches prices from CoinGecko API (free tier, no key needed).
 * When pricing is unavailable, we keep the last successful snapshot or
 * return zero-valued placeholders instead of inventing market prices.
 */

export interface TokenPrice {
  address: string;
  symbol: string;
  priceUsd: number;
  change24h: number;
  lastUpdated: number;
}

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const CACHE_TTL_MS = 60_000; // 1 minute

// Well-known CoinGecko IDs for common tokens
const COINGECKO_IDS: Record<string, string> = {
  native: "ethereum",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "tether",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "usd-coin",
  "0x6b175474e89094c44da98b954eedeac495271d0f": "dai",
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "weth",
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": "uniswap",
};

export class PriceService {
  private cache = new Map<string, TokenPrice>();
  private lastFetch = 0;
  private fetching = false;

  async getPrice(address: string): Promise<TokenPrice> {
    const cached = this.cache.get(address.toLowerCase());
    if (cached && Date.now() - cached.lastUpdated < CACHE_TTL_MS) {
      return cached;
    }

    await this.refreshPrices();
    return this.cache.get(address.toLowerCase()) ?? this.fallbackPrice(address);
  }

  async getPrices(addresses: string[]): Promise<Map<string, TokenPrice>> {
    await this.refreshPrices();
    const result = new Map<string, TokenPrice>();
    for (const addr of addresses) {
      const price = this.cache.get(addr.toLowerCase()) ?? this.fallbackPrice(addr);
      result.set(addr.toLowerCase(), price);
    }
    return result;
  }

  async refreshPrices(): Promise<void> {
    if (this.fetching) return;
    if (Date.now() - this.lastFetch < CACHE_TTL_MS) return;

    this.fetching = true;
    try {
      const ids = Object.values(COINGECKO_IDS).join(",");
      const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as Record<string, {
        usd?: number;
        usd_24h_change?: number;
      }>;

      // Map CoinGecko IDs back to addresses
      for (const [address, cgId] of Object.entries(COINGECKO_IDS)) {
        const priceData = data[cgId];
        if (priceData?.usd !== undefined) {
          this.cache.set(address.toLowerCase(), {
            address,
            symbol: cgId,
            priceUsd: priceData.usd,
            change24h: priceData.usd_24h_change ?? 0,
            lastUpdated: Date.now(),
          });
        }
      }

      this.lastFetch = Date.now();
    } catch {
      // Fail closed. Keep the last successful cache and never synthesize
      // fresh price data when the provider is unavailable.
    } finally {
      this.fetching = false;
    }
  }

  private fallbackPrice(address: string): TokenPrice {
    return {
      address,
      symbol: "UNKNOWN",
      priceUsd: 0,
      change24h: 0,
      lastUpdated: Date.now(),
    };
  }
}
