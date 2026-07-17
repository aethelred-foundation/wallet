/**
 * Native-asset pricing must be network-aware and fail closed.
 *
 * Regression: PriceService hardcoded `native: "ethereum"` in its
 * CoinGecko id map, so the native balance row was enriched with
 * ETHEREUM's market price on EVERY network — on Aethelred that priced
 * AETHEL (which has no market at all) at ~$3,000+ whenever a price
 * fetch succeeded, showing wildly wrong fiat values in the portfolio
 * and home surfaces. The policy layer refuses to invent native prices;
 * the display path must behave the same: the native asset is only priced when the active
 * network declares a trustworthy CoinGecko id for it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PriceService } from "@aethelred/wallet-chain";

const COINGECKO_PAYLOAD = {
  ethereum: { usd: 3200, usd_24h_change: 1.5 },
  tether: { usd: 1, usd_24h_change: 0 },
  "usd-coin": { usd: 1, usd_24h_change: 0 },
  dai: { usd: 1, usd_24h_change: 0 },
  uniswap: { usd: 11, usd_24h_change: 0.4 },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => COINGECKO_PAYLOAD,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PriceService native-asset pricing", () => {
  it("fails closed for the native asset by default (no market id declared)", async () => {
    const service = new PriceService();
    const prices = await service.getPrices(["native"]);
    // Ethereum's price must NOT leak onto an undeclared native asset.
    expect(prices.has("native")).toBe(false);
    expect(await service.getPrice("native")).toBeNull();
  });

  it("prices the native asset when the network declares its market id", async () => {
    const service = new PriceService({ nativeCoingeckoId: "ethereum" });
    const prices = await service.getPrices(["native"]);
    expect(prices.get("native")?.priceUsd).toBe(3200);
  });

  it("stays failed-closed for an explicit null id (market-less chains)", async () => {
    const service = new PriceService({ nativeCoingeckoId: null });
    const prices = await service.getPrices(["native"]);
    expect(prices.has("native")).toBe(false);
    expect(await service.getPrice("native")).toBeNull();
  });

  it("still prices well-known ERC-20s regardless of the native id", async () => {
    const service = new PriceService({ nativeCoingeckoId: null });
    const prices = await service.getPrices([
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
    ]);
    expect(
      prices.get("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")?.priceUsd,
    ).toBe(1);
  });
});
