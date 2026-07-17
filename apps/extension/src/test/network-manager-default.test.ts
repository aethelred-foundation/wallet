/**
 * NetworkManager default-network contract.
 *
 * The background builds its RPC client from NetworkManager.getActive().rpcUrl,
 * so this registry — not the EVM registry in @aethelred/wallet-chain — decides
 * which chain the wallet talks to. For the public-testnet phase the wallet
 * must default to Aethelred (EVM chain-id 7332 = 0x1ca4) and point at a live
 * endpoint; the prior default (Ethereum mainnet) plus a non-resolving
 * placeholder RPC left the wallet unable to reach the testnet.
 */

import { NetworkManager } from "@aethelred/wallet-simulation";
import { describe, expect, it } from "vitest";

describe("NetworkManager default network", () => {
  it("defaults to the Aethelred testnet (0x1ca4) with a live endpoint", () => {
    const nm = new NetworkManager();
    expect(nm.getActiveChainId()).toBe("0x1ca4");

    const active = nm.getActive();
    expect(active.name).toBe("Aethelred Testnet");
    expect(active.isTestnet).toBe(true);
    expect(active.nativeCurrency.decimals).toBe(18); // EVM face (precisebank)
    // A reachable http(s) endpoint, not the old non-resolving placeholder.
    expect(active.rpcUrl).toMatch(/^https?:\/\/.+/);
    expect(active.rpcUrl).not.toContain("testnet-rpc.aethelred.io");
  });

  it("still registers the standard EVM chains and can switch to them", () => {
    const nm = new NetworkManager();
    expect(nm.getNetwork("0x1")?.name).toBe("Ethereum");
    const eth = nm.switchChain("0x1");
    expect(eth.chainId).toBe("0x1");
    expect(nm.getActiveChainId()).toBe("0x1");
    // And back to Aethelred.
    expect(nm.switchChain("0x1ca4").name).toBe("Aethelred Testnet");
  });

  it("lists Aethelred among the testnets", () => {
    const testnets = new NetworkManager().listTestnets().map((n) => n.chainId);
    expect(testnets).toContain("0x1ca4");
  });

  it("declares native-asset market ids honestly per network", () => {
    // The price service refuses to price a native asset unless the network
    // declares its market. AETHEL has no market — its entry must say so —
    // while Ethereum-native chains map to the real "ethereum" listing.
    const nm = new NetworkManager();
    expect(nm.getNetwork("0x1ca4")?.nativeCoingeckoId ?? null).toBeNull();
    expect(nm.getNetwork("0x1")?.nativeCoingeckoId).toBe("ethereum");
    expect(nm.getNetwork("0xa4b1")?.nativeCoingeckoId).toBe("ethereum"); // Arbitrum
    expect(nm.getNetwork("0x2105")?.nativeCoingeckoId).toBe("ethereum"); // Base
    expect(nm.getNetwork("0xa")?.nativeCoingeckoId).toBe("ethereum"); // Optimism
    // Sepolia's testnet ETH has no market either.
    expect(nm.getNetwork("0xaa36a7")?.nativeCoingeckoId ?? null).toBeNull();
  });

  it("updates only the RPC endpoint of an existing network", () => {
    // Bring-your-own-node: a local devnet can share the public chain id
    // (anvil as 7332), so the registry must allow re-pointing the endpoint
    // without touching chain identity.
    const nm = new NetworkManager();
    const updated = nm.updateNetworkRpc("0x1ca4", "http://127.0.0.1:8545");
    expect(updated.rpcUrl).toBe("http://127.0.0.1:8545");
    expect(updated.name).toBe("Aethelred Testnet");
    expect(updated.nativeCurrency.symbol).toBe("AETHEL");
    // The registry itself now serves the updated entry.
    expect(nm.getNetwork("0x1ca4")?.rpcUrl).toBe("http://127.0.0.1:8545");
    expect(nm.getActive().rpcUrl).toBe("http://127.0.0.1:8545");
  });

  it("rejects an RPC update for an unknown chain", () => {
    expect(() =>
      new NetworkManager().updateNetworkRpc("0xdead", "http://127.0.0.1:8545"),
    ).toThrow(/Network not found/);
  });
});
