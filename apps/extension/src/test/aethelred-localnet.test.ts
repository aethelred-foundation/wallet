/**
 * Live adapter-path proof against a running Aethelred node (chain id 7332).
 *
 * This is the wallet-side half of the integration matrix's "prove the EVM
 * adapter path": the wallet's OWN RpcClient talks to aethelredd's JSON-RPC
 * and (a) confirms the chain identity matches the registry entry, (b) reads
 * chain state, (c) checks the fee scale is sane (guarding the 6→18-decimal
 * base-fee regression), and (d) reaches the ISeal verifiable-AI precompile at
 * 0x0900 via eth_call — the wallet can read Digital Seal verdicts with no
 * extra plumbing.
 *
 * Gated on AETHELRED_LOCALNET_RPC so CI stays green without a node:
 *
 *   # in the chain repo
 *   aethelredd start --json-rpc.enable            # JSON-RPC on 127.0.0.1:8545
 *   # in the wallet repo
 *   AETHELRED_LOCALNET_RPC=http://127.0.0.1:8545 \
 *     npx vitest run src/test/aethelred-localnet.test.ts
 */
import { describe, expect, it } from "vitest";

import { AETHELRED, RpcClient } from "@aethelred/wallet-chain";

const rpcUrl = process.env.AETHELRED_LOCALNET_RPC;

/** ISeal precompile address (see chain repo precompiles/seal). */
const ISEAL_ADDRESS = "0x0000000000000000000000000000000000000900";

/**
 * ABI-encoded calldata for `verifySeal("nonexistent-seal-xyz")` — selector
 * 0x62b6a103 plus the encoded string argument. A nonexistent seal returns a
 * clean ABI `false` (32 zero bytes), which proves the precompile executed
 * without needing any pre-seeded chain state.
 */
const VERIFY_SEAL_CALLDATA =
  "0x62b6a1030000000000000000000000000000000000000000000000000000000000000020" +
  "00000000000000000000000000000000000000000000000000000000000000146e6f6e65" +
  "78697374656e742d7365616c2d78797a000000000000000000000000";

const ABI_FALSE = `0x${"0".repeat(64)}`;

describe.skipIf(!rpcUrl)("Aethelred localnet — wallet adapter path (live)", () => {
  const client = new RpcClient({ url: rpcUrl as string, maxRetries: 1 });

  it("eth_chainId matches the registry entry (7332)", async () => {
    const chainIdHex = await client.call<string>("eth_chainId");
    expect(parseInt(chainIdHex, 16)).toBe(AETHELRED.chainId);
    expect(AETHELRED.chainId).toBe(7332);
  });

  it("reads chain state (block number is live)", async () => {
    const blockHex = await client.call<string>("eth_blockNumber");
    expect(parseInt(blockHex, 16)).toBeGreaterThan(0);
  });

  it("gas price is on the corrected 6→18-decimal scale", async () => {
    const gasPriceHex = await client.call<string>("eth_gasPrice");
    const gasPrice = BigInt(gasPriceHex);
    // Regression guard: before the feemarket genesis rescale, the base fee
    // was ~1e20 aaethel/gas (a transfer cost millions of AETHEL). Sane values
    // are gwei-scale; anything at or above 1e12 means the bridge broke again.
    expect(gasPrice > 0n).toBe(true);
    expect(gasPrice < 1_000_000_000_000n).toBe(true);
  });

  it("eth_call reaches the ISeal verifiable-AI precompile at 0x0900", async () => {
    const ret = await client.call<string>("eth_call", [
      { to: ISEAL_ADDRESS, data: VERIFY_SEAL_CALLDATA },
      "latest",
    ]);
    // A valid ABI bool false: the precompile executed and answered.
    expect(ret).toBe(ABI_FALSE);
  });
});

describe("Aethelred network registry entry", () => {
  it("is the confirmed 7332 definition, honestly flagged as testnet-phase", () => {
    expect(AETHELRED.chainId).toBe(7332);
    expect(AETHELRED.namespace).toBe("eip155");
    expect(AETHELRED.nativeCurrency.symbol).toBe("AETHEL");
    expect(AETHELRED.nativeCurrency.decimals).toBe(18);
    expect(AETHELRED.isTestnet).toBe(true);
    expect(AETHELRED.supportsEip1559).toBe(true);
    expect(AETHELRED.rpcEndpoints[0]).toBe("http://127.0.0.1:8545");
  });
});
