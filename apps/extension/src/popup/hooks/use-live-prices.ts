/**
 * Shared hook: fetches real-time prices from CoinGecko for non-Aethelred tokens.
 * Production builds fail closed when pricing is unavailable so we do not
 * synthesize live-looking values. Development previews can opt into a small
 * preview cache for local UI work.
 */

import { useState, useEffect, useCallback } from "react";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

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

const PREVIEW_PRICES: PriceMap = {
  AETHEL: { price: 2.47, change24h: 3.2 },
  stAETHEL: { price: 2.58, change24h: 3.8 },
  BTC: { price: 97480, change24h: 1.8 },
  WETH: { price: 3245.8, change24h: -1.4 },
  SOL: { price: 178.42, change24h: 5.6 },
  USDC: { price: 1, change24h: 0 },
  EURC: { price: 1.08, change24h: 0.12 },
  PYUSD: { price: 1, change24h: 0 },
  USDY: { price: 1.04, change24h: 0.01 },
  BUIDL: { price: 1, change24h: 0 },
};

let cachedPrices: PriceMap = IS_PRODUCTION_BUILD ? {} : { ...PREVIEW_PRICES };
let lastFetchTime = 0;

export function __resetPriceCacheForTests(allowPreviewFallback = !IS_PRODUCTION_BUILD): void {
  cachedPrices = allowPreviewFallback ? { ...PREVIEW_PRICES } : {};
  lastFetchTime = 0;
}

export async function fetchPrices(allowPreviewFallback = !IS_PRODUCTION_BUILD): Promise<PriceMap> {
  const ids = Object.values(COINGECKO_IDS).join(",");
  const url = `${API_URL}?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const result: PriceMap = allowPreviewFallback ? { ...cachedPrices } : {};
    for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
      const entry = data[geckoId];
      if (entry) {
        result[symbol] = {
          price: entry.usd ?? 0,
          change24h: entry.usd_24h_change ?? 0,
        };
      }
    }

    if (allowPreviewFallback) {
      // Local preview only: keep protocol-native tokens visible for the dev shell.
      for (const sym of ["AETHEL", "stAETHEL"]) {
        const base = PREVIEW_PRICES[sym];
        result[sym] = {
          price: parseFloat((base.price + (Math.random() - 0.48) * base.price * 0.003).toFixed(4)),
          change24h: parseFloat((base.change24h + (Math.random() - 0.48) * 0.2).toFixed(2)),
        };
      }
    }

    cachedPrices = result;
    lastFetchTime = Date.now();
    return result;
  } catch {
    if (allowPreviewFallback) {
      cachedPrices = { ...PREVIEW_PRICES };
      return cachedPrices;
    }
    return lastFetchTime > 0 ? cachedPrices : {};
  }
}

export function useLivePrices(intervalMs = 30000): PriceMap {
  const [prices, setPrices] = useState<PriceMap>(cachedPrices);

  const refresh = useCallback(async () => {
    const p = await fetchPrices(!IS_PRODUCTION_BUILD);
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
