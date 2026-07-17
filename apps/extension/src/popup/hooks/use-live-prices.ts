/**
 * Shared hook: fetches real-time prices from CoinGecko.
 *
 * This module never seeds, perturbs, or reconstructs prices. The cache contains
 * only values returned by the configured provider, and a failed refresh keeps
 * the last successfully fetched authoritative response. Assets without a
 * provider mapping (including AETHEL/stAETHEL) remain unpriced.
 */

import { useState, useEffect, useCallback } from "react";

export interface LivePrice {
  price: number;
  change24h: number;
}

// Map our wallet symbols → CoinGecko IDs
const COINGECKO_IDS: Record<string, string> = {
  WETH: "ethereum",
  USDC: "usd-coin",
  EURC: "euro-coin",
  PYUSD: "paypal-usd",
  USDY: "ondo-us-dollar-yield",
  BUIDL: "blackrock-usd-institutional-digital-liquidity-fund",
  SOL: "solana",
  BTC: "bitcoin",
};

const API_URL = "https://api.coingecko.com/api/v3/simple/price";

type PriceMap = Record<string, LivePrice>;

let cachedPrices: PriceMap = {};
let lastFetchTime = 0;

export function __resetPriceCacheForTests(): void {
  cachedPrices = {};
  lastFetchTime = 0;
}

export async function fetchPrices(): Promise<PriceMap> {
  const ids = Object.values(COINGECKO_IDS).join(",");
  const url = `${API_URL}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Preserve previous authoritative entries when the provider returns a
    // partial response. Never populate an entry unless this or an earlier
    // successful provider response supplied it.
    const result: PriceMap = { ...cachedPrices };
    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      const entry = data[geckoId];
      const price = Number(entry?.usd);
      if (Number.isFinite(price) && price > 0) {
        const change24h = Number(entry?.usd_24h_change);
        result[symbol] = {
          price,
          change24h: Number.isFinite(change24h)
            ? change24h
            : result[symbol]?.change24h ?? 0,
        };
      }
    }

    cachedPrices = result;
    lastFetchTime = Date.now();
    return result;
  } catch {
    return cachedPrices;
  }
}

export function useLivePrices(intervalMs = 30000): PriceMap {
  const [prices, setPrices] = useState<PriceMap>(cachedPrices);

  const refresh = useCallback(async () => {
    const p = await fetchPrices();
    setPrices(p);
  }, []);

  useEffect(() => {
    // Fetch immediately if stale (>15s since last fetch)
    if (Date.now() - lastFetchTime > 15000) {
      refresh();
    }

    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, refresh]);

  return prices;
}

/**
 * Returns the live price for a given symbol, falling back to a default.
 */
export function getPrice(prices: PriceMap, symbol: string, fallbackPrice = 0): LivePrice {
  return prices[symbol] ?? { price: fallbackPrice, change24h: 0 };
}
