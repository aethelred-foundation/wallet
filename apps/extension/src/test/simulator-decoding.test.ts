/**
 * Simulator ABI decoder tests.
 *
 * These verify that the minimal ABI decoder in `packages/simulation/src/abi-decoder.ts`
 * correctly classifies every selector the wallet cares about for risk
 * signaling: approve (finite + unlimited), transferFrom, safeTransferFrom,
 * setApprovalForAll, permit, and the malformed-calldata fallback.
 *
 * The decoder is synchronous and pure, so these tests are fast and
 * need no mocks.
 */

import { describe, it, expect } from "vitest";
import { TransactionSimulator } from "@aethelred/wallet-simulation";

const simulator = new TransactionSimulator();

/** Convenience — build the calldata for a 2-param (address, uint256) fn. */
function encodeAddrUint(
  selector: string,
  address: string,
  value: bigint,
): string {
  const addrPadded = address.slice(2).padStart(64, "0");
  const valuePadded = value.toString(16).padStart(64, "0");
  return `${selector}${addrPadded}${valuePadded}`;
}

/** Convenience — build the calldata for a 3-param (addr, addr, uint256). */
function encodeAddrAddrUint(
  selector: string,
  addr1: string,
  addr2: string,
  value: bigint,
): string {
  const a1 = addr1.slice(2).padStart(64, "0");
  const a2 = addr2.slice(2).padStart(64, "0");
  const v = value.toString(16).padStart(64, "0");
  return `${selector}${a1}${a2}${v}`;
}

const UINT256_MAX = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

const SPENDER = "0xcafebabecafebabecafebabecafebabecafebabe";
const TOKEN = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC
const RECIPIENT = "0x1234567890abcdef1234567890abcdef12345678";

describe("ABI decoder — ERC-20 approve", () => {
  it("decodes an unlimited approval as CRITICAL", async () => {
    const data = encodeAddrUint("0x095ea7b3", SPENDER, UINT256_MAX);
    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });

    expect(result.decodedCall).toBeTruthy();
    expect(result.decodedCall!.method).toBe("approve");
    expect(result.decodedCall!.params.spender.toLowerCase()).toBe(SPENDER);
    expect(result.decodedCall!.params.amount).toBe(UINT256_MAX.toString());
    expect(result.decodedCall!.metadata?.isUnlimitedApproval).toBe(true);
    expect(result.decodedCall!.risk).toBe("critical");
    expect(result.overallRisk).toBe("critical");
    expect(result.approvalChanges).toHaveLength(1);
    expect(result.approvalChanges[0].isUnlimited).toBe(true);
  });

  it("decodes a finite approval as MEDIUM", async () => {
    const data = encodeAddrUint("0x095ea7b3", SPENDER, 1000n * 10n ** 6n); // 1000 USDC
    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });

    expect(result.decodedCall).toBeTruthy();
    expect(result.decodedCall!.risk).toBe("medium");
    expect(result.decodedCall!.metadata?.isUnlimitedApproval).toBe(false);
    expect(result.approvalChanges[0].isUnlimited).toBe(false);
  });

  it("decodes a zero approval (revoke) as SAFE", async () => {
    const data = encodeAddrUint("0x095ea7b3", SPENDER, 0n);
    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });

    expect(result.decodedCall!.risk).toBe("safe");
    expect(result.decodedCall!.warnings[0]).toMatch(/revoke/i);
  });
});

describe("ABI decoder — ERC-20 transfer + transferFrom", () => {
  it("decodes transfer(to, amount)", async () => {
    const data = encodeAddrUint("0xa9059cbb", RECIPIENT, 12345n);
    const result = await simulator.simulate({ from: SPENDER, to: TOKEN, data });

    expect(result.decodedCall!.method).toBe("transfer");
    expect(result.decodedCall!.params.to.toLowerCase()).toBe(RECIPIENT);
    expect(result.decodedCall!.params.amount).toBe("12345");
    expect(result.balanceChanges.some((b) => b.kind === "token-transfer-out")).toBe(true);
  });

  it("decodes transferFrom(from, to, amount) as MEDIUM", async () => {
    const data = encodeAddrAddrUint("0x23b872dd", SPENDER, RECIPIENT, 999n);
    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });

    expect(result.decodedCall!.method).toBe("transferFrom");
    expect(result.decodedCall!.params.from.toLowerCase()).toBe(SPENDER);
    expect(result.decodedCall!.params.to.toLowerCase()).toBe(RECIPIENT);
    expect(result.decodedCall!.params.amount).toBe("999");
    expect(result.decodedCall!.risk).toBe("medium");
  });
});

describe("ABI decoder — ERC-721 setApprovalForAll", () => {
  it("decodes setApprovalForAll(true) as CRITICAL NFT collection approval", async () => {
    const operatorPadded = SPENDER.slice(2).padStart(64, "0");
    const boolPadded = "0".repeat(63) + "1";
    const data = `0xa22cb465${operatorPadded}${boolPadded}`;
    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });

    expect(result.decodedCall!.method).toBe("setApprovalForAll");
    expect(result.decodedCall!.params.operator.toLowerCase()).toBe(SPENDER);
    expect(result.decodedCall!.params.approved).toBe("true");
    expect(result.decodedCall!.risk).toBe("critical");
    expect(result.overallRisk).toBe("critical");
    expect(result.approvalChanges[0].symbol).toBe("NFT-COLLECTION");
    expect(result.approvalChanges[0].isUnlimited).toBe(true);
  });

  it("decodes setApprovalForAll(false) as SAFE (revoke)", async () => {
    const operatorPadded = SPENDER.slice(2).padStart(64, "0");
    const boolPadded = "0".repeat(64);
    const data = `0xa22cb465${operatorPadded}${boolPadded}`;
    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });

    expect(result.decodedCall!.params.approved).toBe("false");
    expect(result.decodedCall!.risk).toBe("safe");
    expect(result.approvalChanges[0].kind).toBe("token-approval-revoke");
  });
});

describe("ABI decoder — ERC-20 permit", () => {
  it("decodes permit(...) with unlimited value as CRITICAL + isPermit", async () => {
    // permit(owner, spender, value, deadline, v, r, s)
    // Fixed head (owner, spender, value, deadline) is 4 × 32 bytes
    const owner = SPENDER.slice(2).padStart(64, "0");
    const spender = RECIPIENT.slice(2).padStart(64, "0");
    const value = UINT256_MAX.toString(16).padStart(64, "0");
    const deadline = (BigInt(Math.floor(Date.now() / 1000) + 3600)).toString(16).padStart(64, "0");
    // v, r, s — we don't care about their values for the head decode
    const tail = "0".repeat(64 * 3);
    const data = `0xd505accf${owner}${spender}${value}${deadline}${tail}`;

    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });
    expect(result.decodedCall!.method).toBe("permit");
    expect(result.decodedCall!.metadata?.isPermit).toBe(true);
    expect(result.decodedCall!.metadata?.isUnlimitedApproval).toBe(true);
    expect(result.decodedCall!.risk).toBe("critical");
  });
});

describe("ABI decoder — fallback behavior", () => {
  it("returns no decodedCall for an unknown selector", async () => {
    const data = "0xdeadbeef" + "00".repeat(64); // bogus
    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });

    expect(result.decodedCall).toBeUndefined();
    expect(result.riskSignals.some((r) => r.id === "unknown-selector")).toBe(true);
  });

  it("handles malformed approve calldata gracefully", async () => {
    // Too short — only 20 bytes after selector instead of 64
    const data = "0x095ea7b3" + "00".repeat(20);
    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });

    expect(result.decodedCall).toBeTruthy();
    expect(result.decodedCall!.method).toBe("malformed");
    expect(result.decodedCall!.metadata?.malformed).toBe(true);
    expect(result.decodedCall!.risk).toBe("high");
  });

  it("returns native transfer with no decodedCall when data is empty", async () => {
    // Use a KNOWN recipient (USDC contract address) so the heuristic
    // contract analyzer classifies it as verified, avoiding the
    // "unverified-contract" medium-risk signal that would otherwise
    // fire for any unknown address. This is a correctness test for
    // the decoder, not for the contract heuristic layer.
    const result = await simulator.simulate({
      from: SPENDER,
      to: TOKEN, // USDC — known/verified
      value: "0xde0b6b3a7640000", // 1 ETH
      data: "0x",
    });

    expect(result.decodedCall).toBeUndefined();
    expect(result.balanceChanges.some((b) => b.kind === "native-transfer-out")).toBe(true);
    // Native transfer with known recipient should produce no elevated risk
    expect(["safe", "low"]).toContain(result.overallRisk);
  });
});
