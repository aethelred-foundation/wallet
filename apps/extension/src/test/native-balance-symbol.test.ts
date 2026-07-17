/**
 * The native balance row must carry the ACTIVE network's coin, not a
 * hardcoded "ETH". On Aethelred the funded balance is AETHEL; labelling it
 * ETH (and tagging the Aethelred tokens as chain-id 1) is why a funded
 * wallet appeared to hold nothing on the testnet.
 */

import { BalanceFetcher, RpcClient, TokenListService } from "@aethelred/wallet-chain";
import { describe, expect, it } from "vitest";

/** RpcClient stub returning a fixed eth_getBalance. */
function stubRpc(balanceHex: string): RpcClient {
  return {
    call: async (method: string) => {
      if (method === "eth_getBalance") return balanceHex;
      throw new Error(`unexpected rpc call: ${method}`);
    },
  } as unknown as RpcClient;
}

describe("native balance carries the active network's coin", () => {
  const oneThousandAethel = "0x" + (1000n * 10n ** 18n).toString(16);

  it("labels the native balance AETHEL when the network is Aethelred", async () => {
    const fetcher = new BalanceFetcher(stubRpc(oneThousandAethel), {
      symbol: "AETHEL",
      name: "Aethelred",
      decimals: 18,
    });
    const bal = await fetcher.getNativeBalance("0xabc");
    expect(bal.symbol).toBe("AETHEL");
    expect(bal.name).toBe("Aethelred");
    // Formatted with a thousands separator; the point is it is 1000, not 0.
    expect(bal.balance.replace(/,/g, "")).toBe("1000");
  });

  it("defaults to ETH when no native currency is supplied (Ethereum)", async () => {
    const bal = await new BalanceFetcher(stubRpc("0x0")).getNativeBalance("0xabc");
    expect(bal.symbol).toBe("ETH");
  });
});

describe("Aethelred token list", () => {
  it("exposes AETHEL as the native coin on chain 7332, without Ethereum ERC-20s", () => {
    const tokens = new TokenListService().getTokensForChain(7332);
    const symbols = tokens.map((t) => t.symbol);
    expect(symbols).toContain("AETHEL");
    const aethel = tokens.find((t) => t.symbol === "AETHEL");
    expect(aethel?.isNative).toBe(true);
    expect(aethel?.address).toBe("native");
    // The Ethereum stablecoins live on chain 1 and must not appear here.
    expect(symbols).not.toContain("USDT");
    expect(symbols).not.toContain("USDC");
    expect(symbols).not.toContain("DAI");
  });

  it("still exposes the Ethereum token set on chain 1", () => {
    const symbols = new TokenListService().getTokensForChain(1).map((t) => t.symbol);
    expect(symbols).toContain("ETH");
    expect(symbols).toContain("USDC");
  });
});
