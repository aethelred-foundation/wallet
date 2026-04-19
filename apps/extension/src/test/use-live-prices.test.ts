import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { __resetPriceCacheForTests, fetchPrices } from "../popup/hooks/use-live-prices";

describe("useLivePrices price fetching", () => {
  beforeEach(() => {
    __resetPriceCacheForTests(false);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    __resetPriceCacheForTests(false);
    vi.unstubAllGlobals();
  });

  it("fails closed in production mode when CoinGecko is unavailable", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    const prices = await fetchPrices(false);

    expect(prices).toEqual({});
  });

  it("returns live prices without adding preview-only tokens", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ethereum: { usd: 3200, usd_24h_change: 2.1 },
        "usd-coin": { usd: 1, usd_24h_change: 0 },
      }),
    });

    const prices = await fetchPrices(false);

    expect(prices.WETH.price).toBe(3200);
    expect(prices.USDC.price).toBe(1);
    expect(prices.AETHEL).toBeUndefined();
    expect(prices.stAETHEL).toBeUndefined();
  });

  it("allows preview fallback prices when explicitly enabled", async () => {
    __resetPriceCacheForTests(true);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    const prices = await fetchPrices(true);

    expect(prices.AETHEL?.price).toBeGreaterThan(0);
    expect(prices.stAETHEL?.price).toBeGreaterThan(0);
  });
});
