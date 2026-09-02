import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { __resetPriceCacheForTests, fetchPrices } from "../popup/hooks/use-live-prices";

describe("useLivePrices price fetching", () => {
  beforeEach(() => {
    __resetPriceCacheForTests();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    __resetPriceCacheForTests();
    vi.unstubAllGlobals();
  });

  it("fails closed in production mode when CoinGecko is unavailable", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValueOnce(new Error("offline"));

    const prices = await fetchPrices();

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

    const prices = await fetchPrices();

    expect(prices.WETH.price).toBe(3200);
    expect(prices.USDC.price).toBe(1);
    expect(prices.AETHEL).toBeUndefined();
    expect(prices.stAETHEL).toBeUndefined();
  });

  it("retains only the last successfully fetched authoritative response when offline", async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ethereum: { usd: 3200, usd_24h_change: 2.1 },
      }),
    });

    const first = await fetchPrices();
    expect(first.WETH).toEqual({ price: 3200, change24h: 2.1 });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const cached = await fetchPrices();

    expect(cached).toEqual(first);
    expect(cached.AETHEL).toBeUndefined();
    expect(cached.stAETHEL).toBeUndefined();
  });
});
