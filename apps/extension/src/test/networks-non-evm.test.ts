/**
 * Regression tests for the non-EVM additions to the chain registry.
 *
 * When we added Cosmos Hub / Osmosis / Celestia / Aptos / Sui we chose
 * "Option B" for the chain-id type system: keep {@link NetworkDefinition.chainId}
 * as `number` (using synthetic sentinels for non-numeric ecosystems)
 * and carry string chain ids in a new `chainIdString` field. These
 * tests lock down that contract so a future "simplification" can't
 * accidentally collapse Cosmos Hub and Osmosis into the same slot.
 */

import { describe, expect, it } from "vitest";
import {
  APTOS_MAINNET,
  APTOS_TESTNET,
  CELESTIA_MAINNET,
  COSMOS_HUB_MAINNET,
  OSMOSIS_MAINNET,
  SUI_MAINNET,
  SUI_TESTNET,
  getMainnetNetworks,
  getNetwork,
  getNetworkByChainIdString,
  getNetworksForNamespace,
} from "@aethelred/wallet-chain";

describe("non-EVM chain registry", () => {
  describe("Cosmos SDK chains", () => {
    it("returns Cosmos Hub by synthetic numeric id", () => {
      expect(getNetwork(-100)).toBe(COSMOS_HUB_MAINNET);
    });

    it("returns Cosmos Hub by string chain id", () => {
      expect(getNetworkByChainIdString("cosmos", "cosmoshub-4")).toBe(
        COSMOS_HUB_MAINNET,
      );
    });

    it("returns Osmosis by string chain id", () => {
      expect(getNetworkByChainIdString("cosmos", "osmosis-1")).toBe(
        OSMOSIS_MAINNET,
      );
    });

    it("returns Celestia by string chain id", () => {
      expect(getNetworkByChainIdString("cosmos", "celestia")).toBe(
        CELESTIA_MAINNET,
      );
    });

    it("exposes exactly three Cosmos chains in the namespace view", () => {
      const cosmos = getNetworksForNamespace("cosmos");
      expect(cosmos).toHaveLength(3);
      expect(cosmos).toEqual(
        expect.arrayContaining([
          COSMOS_HUB_MAINNET,
          OSMOSIS_MAINNET,
          CELESTIA_MAINNET,
        ]),
      );
    });

    it("uses string chain ids for every Cosmos chain", () => {
      for (const net of getNetworksForNamespace("cosmos")) {
        expect(typeof net.chainIdString).toBe("string");
        expect(net.chainIdString?.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Aptos", () => {
    it("returns Aptos Mainnet for chain id 1, but only after Ethereum wins the collision", () => {
      // Aptos chain id 1 collides with Ethereum Mainnet. The registry
      // deterministically prefers the EVM entry so existing callers
      // that wrote `getNetwork(1)` for Ethereum don't silently flip
      // to Aptos. Aptos consumers must use the namespace query instead.
      expect(getNetwork(1)?.namespace).toBe("eip155");

      const [aptosMainnet, aptosTestnet] = getNetworksForNamespace("aptos");
      expect(aptosMainnet).toBeDefined();
      expect(aptosMainnet?.chainId).toBe(1);
      expect(aptosMainnet?.name).toBe("Aptos");
      expect(aptosTestnet?.chainId).toBe(2);
      expect(aptosTestnet?.isTestnet).toBe(true);
    });

    it("exposes exactly two Aptos chains in the namespace view", () => {
      const aptos = getNetworksForNamespace("aptos");
      expect(aptos).toHaveLength(2);
      expect(aptos).toEqual(
        expect.arrayContaining([APTOS_MAINNET, APTOS_TESTNET]),
      );
    });

    it("does not set chainIdString on Aptos chains", () => {
      expect(APTOS_MAINNET.chainIdString).toBeUndefined();
      expect(APTOS_TESTNET.chainIdString).toBeUndefined();
    });
  });

  describe("Sui", () => {
    it("returns Sui Mainnet by synthetic numeric id", () => {
      expect(getNetwork(-200)).toBe(SUI_MAINNET);
    });

    it("returns Sui Mainnet by string chain id", () => {
      expect(getNetworkByChainIdString("sui", "mainnet")).toBe(SUI_MAINNET);
    });

    it("returns Sui Testnet by string chain id", () => {
      expect(getNetworkByChainIdString("sui", "testnet")).toBe(SUI_TESTNET);
    });

    it("exposes exactly two Sui chains in the namespace view", () => {
      const sui = getNetworksForNamespace("sui");
      expect(sui).toHaveLength(2);
      expect(sui).toEqual(
        expect.arrayContaining([SUI_MAINNET, SUI_TESTNET]),
      );
    });

    it("scopes string lookup by namespace so Sui's 'mainnet' label is not ambiguous", () => {
      // The string "mainnet" is generic — if lookup weren't scoped by
      // namespace, a future "aptos:mainnet" entry could collide.
      // Cross-namespace lookups must miss.
      expect(getNetworkByChainIdString("cosmos", "mainnet")).toBeUndefined();
      expect(getNetworkByChainIdString("aptos", "mainnet")).toBeUndefined();
    });
  });

  describe("integration with the main registry", () => {
    it("includes every new mainnet in getMainnetNetworks()", () => {
      const mainnets = getMainnetNetworks();
      expect(mainnets).toEqual(
        expect.arrayContaining([
          COSMOS_HUB_MAINNET,
          OSMOSIS_MAINNET,
          CELESTIA_MAINNET,
          APTOS_MAINNET,
          SUI_MAINNET,
        ]),
      );
    });

    it("gives every new chain at least one RPC endpoint", () => {
      const newChains = [
        COSMOS_HUB_MAINNET,
        OSMOSIS_MAINNET,
        CELESTIA_MAINNET,
        APTOS_MAINNET,
        APTOS_TESTNET,
        SUI_MAINNET,
        SUI_TESTNET,
      ];
      for (const chain of newChains) {
        expect(chain.rpcEndpoints.length).toBeGreaterThan(0);
        for (const url of chain.rpcEndpoints) {
          // Every endpoint should be a well-formed https URL, never a
          // localhost placeholder that escaped from dev config.
          expect(url).toMatch(/^https:\/\//);
        }
      }
    });

    it("gives every new chain a block explorer URL", () => {
      const newChains = [
        COSMOS_HUB_MAINNET,
        OSMOSIS_MAINNET,
        CELESTIA_MAINNET,
        APTOS_MAINNET,
        APTOS_TESTNET,
        SUI_MAINNET,
        SUI_TESTNET,
      ];
      for (const chain of newChains) {
        expect(chain.blockExplorerUrl).toMatch(/^https:\/\//);
      }
    });

    it("gives every new chain a non-EIP-1559 fee model flag", () => {
      // None of the new chains use EIP-1559 dynamic fees — Cosmos SDK
      // chains use their own gas-price/fee-denom model, Aptos uses a
      // `gas_unit_price` field, Sui uses reference gas price + budget.
      const newChains = [
        COSMOS_HUB_MAINNET,
        OSMOSIS_MAINNET,
        CELESTIA_MAINNET,
        APTOS_MAINNET,
        APTOS_TESTNET,
        SUI_MAINNET,
        SUI_TESTNET,
      ];
      for (const chain of newChains) {
        expect(chain.supportsEip1559).toBe(false);
      }
    });
  });
});
