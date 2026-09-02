import { describe, expect, it } from "vitest";
import { getWalletAppCatalog } from "../background/app-catalog";

describe("background wallet catalog release behavior", () => {
  it("returns no static catalog entries or readiness claims in production", () => {
    const catalog = getWalletAppCatalog(true);

    expect(catalog).toEqual([]);
    expect(JSON.stringify(catalog)).not.toMatch(/live|planned|design|TEE|multisig/i);
  });

  it("keeps prototype entries isolated to non-production previews", () => {
    expect(getWalletAppCatalog(false).length).toBeGreaterThan(0);
  });
});
