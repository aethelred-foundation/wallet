/**
 * GasOracle — Aethelred-aware gas-limit buffering.
 *
 * The Aethelred EVM's eth_estimateGas under-reports gas for state-changing
 * calls (returns ≈intrinsic), so the wallet must buffer aggressively on
 * Aethelred networks or every contract call reverts out-of-gas. On other EVM
 * chains the estimate is accurate and only a modest 20% buffer is applied.
 * These tests pin both behaviours plus the fallback when eth_estimateGas fails.
 */

import { describe, expect, it, vi } from "vitest";

import { GasOracle } from "@aethelred/wallet-chain";
import type { RpcClient } from "@aethelred/wallet-chain";

/** Minimal RpcClient stub: answers eth_chainId + eth_estimateGas from a map. */
function stubRpc(responses: {
  chainId: number;
  estimateGasHex?: string;
  estimateThrows?: boolean;
}): RpcClient {
  const call = vi.fn(async (method: string) => {
    if (method === "eth_chainId") return "0x" + responses.chainId.toString(16);
    if (method === "eth_estimateGas") {
      if (responses.estimateThrows) throw new Error("execution reverted");
      return responses.estimateGasHex ?? "0x5c8a"; // 23690, a near-intrinsic estimate
    }
    throw new Error(`unexpected rpc method: ${method}`);
  });
  return { call } as unknown as RpcClient;
}

const CONTRACT_TX = {
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  data: "0xa9059cbb0000000000000000000000000000000000000000000000000000000000000001",
};
const SIMPLE_TRANSFER = {
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  value: "0xde0b6b3a7640000",
};

describe("GasOracle.estimateGas — Aethelred buffering", () => {
  it("floors a near-intrinsic contract-call estimate to 700k on Aethelred testnet (7332)", async () => {
    const oracle = new GasOracle(stubRpc({ chainId: 7332, estimateGasHex: "0x5c8a" }));
    // 23690 * 8 = 189520 < 700_000 floor -> floored.
    expect(await oracle.estimateGas(CONTRACT_TX)).toBe(BigInt(700_000));
  });

  it("applies the 8x multiplier when it exceeds the floor", async () => {
    // 150000 * 8 = 1_200_000 (> 700k floor, < 30M ceiling).
    const oracle = new GasOracle(stubRpc({ chainId: 7333, estimateGasHex: "0x249f0" }));
    expect(await oracle.estimateGas(CONTRACT_TX)).toBe(BigInt(1_200_000));
  });

  it("caps the buffered limit at the 30M ceiling", async () => {
    // 5_000_000 * 8 = 40M -> capped to 30M.
    const oracle = new GasOracle(stubRpc({ chainId: 7331, estimateGasHex: "0x4c4b40" }));
    expect(await oracle.estimateGas(CONTRACT_TX)).toBe(BigInt(30_000_000));
  });

  it("keeps the standard 20% buffer on non-Aethelred chains (mainnet=1)", async () => {
    // 23690 * 1.2 = 28428, no floor.
    const oracle = new GasOracle(stubRpc({ chainId: 1, estimateGasHex: "0x5c8a" }));
    expect(await oracle.estimateGas(CONTRACT_TX)).toBe(BigInt(28428));
  });

  it("does not floor a simple value transfer on Aethelred (no contract data)", async () => {
    // 21000 * 8 = 168000; not a contract call, so no 700k floor.
    const oracle = new GasOracle(stubRpc({ chainId: 7332, estimateGasHex: "0x5208" }));
    expect(await oracle.estimateGas(SIMPLE_TRANSFER)).toBe(BigInt(168_000));
  });

  it("falls back to the 700k contract floor when estimation throws on Aethelred", async () => {
    const oracle = new GasOracle(stubRpc({ chainId: 7332, estimateThrows: true }));
    expect(await oracle.estimateGas(CONTRACT_TX)).toBe(BigInt(700_000));
  });

  it("falls back to 21k for a simple transfer when estimation throws on a standard chain", async () => {
    const oracle = new GasOracle(stubRpc({ chainId: 1, estimateThrows: true }));
    expect(await oracle.estimateGas(SIMPLE_TRANSFER)).toBe(BigInt(21_000));
  });
});
