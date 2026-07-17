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

describe("ABI decoder — Aethelred first-party (Cruzible liquid staking)", () => {
  const VAULT = "0x5d7372f9609613b4b505d151f04b71afd55909d8";

  /** ABI-encode a single dynamic string argument. */
  function encodeStringArg(selector: string, s: string): string {
    const bytes = Buffer.from(s, "utf8");
    const offset = (32).toString(16).padStart(64, "0");
    const len = bytes.length.toString(16).padStart(64, "0");
    const data = bytes.toString("hex").padEnd(Math.ceil(bytes.length / 32) * 64, "0");
    return `${selector}${offset}${len}${data}`;
  }

  it("decodes stake() as a low-risk liquid-staking deposit", async () => {
    const result = await simulator.simulate({
      from: RECIPIENT,
      to: VAULT,
      value: "0x29a2241af62c0000", // 3 AETHEL
      data: "0x3a4b66f1",
    });
    expect(result.decodedCall!.method).toBe("stake");
    expect(result.decodedCall!.metadata?.protocol).toBe("cruzible");
    expect(["safe", "low"]).toContain(result.decodedCall!.risk);
  });

  it("decodes stakeWithSeal(jobId) including the dynamic string", async () => {
    const data = encodeStringArg("0xf916cc4f", "job-alice-7");
    const result = await simulator.simulate({ from: RECIPIENT, to: VAULT, data });
    expect(result.decodedCall!.method).toBe("stakeWithSeal");
    expect(result.decodedCall!.params.jobId).toBe("job-alice-7");
    expect(result.decodedCall!.metadata?.protocol).toBe("cruzible");
  });

  it("decodes unstake(shares) and explains the unbonding queue", async () => {
    const shares = 5n * 10n ** 18n;
    const data = "0x2e17de78" + shares.toString(16).padStart(64, "0");
    const result = await simulator.simulate({ from: RECIPIENT, to: VAULT, data });
    expect(result.decodedCall!.method).toBe("unstake");
    expect(result.decodedCall!.params.shares).toBe(shares.toString());
    expect(result.decodedCall!.warnings.join(" ")).toMatch(/unbonding/i);
  });

  it("decodes instantUnstake(shares, minOut) and mentions the exit fee", async () => {
    const shares = 2n * 10n ** 18n;
    const minOut = 19n * 10n ** 17n;
    const data =
      "0xbd0461aa" +
      shares.toString(16).padStart(64, "0") +
      minOut.toString(16).padStart(64, "0");
    const result = await simulator.simulate({ from: RECIPIENT, to: VAULT, data });
    expect(result.decodedCall!.method).toBe("instantUnstake");
    expect(result.decodedCall!.params.shares).toBe(shares.toString());
    expect(result.decodedCall!.params.minOut).toBe(minOut.toString());
    expect(result.decodedCall!.warnings.join(" ")).toMatch(/fee/i);
  });

  it("decodes withdraw(id) as a queue claim", async () => {
    const data = "0x2e1a7d4d" + (7n).toString(16).padStart(64, "0");
    const result = await simulator.simulate({ from: RECIPIENT, to: VAULT, data });
    expect(result.decodedCall!.method).toBe("withdraw");
    expect(result.decodedCall!.params.value).toBe("7");
  });

  it("decodes claimStakingRewards(validator) as permissionless and safe", async () => {
    const data = encodeStringArg("0xd8d8422a", "aethelvaloper1u3jzqe3v22utqngmh9hgexz6ardhc5w82nc6tc");
    const result = await simulator.simulate({ from: RECIPIENT, to: VAULT, data });
    expect(result.decodedCall!.method).toBe("claimStakingRewards");
    expect(result.decodedCall!.params.validator).toMatch(/^aethelvaloper1/);
    expect(["safe", "low"]).toContain(result.decodedCall!.risk);
  });

  it("decodes wstAETHEL wrap/unwrap", async () => {
    const amount = 4n * 10n ** 18n;
    const wrap = await simulator.simulate({
      from: RECIPIENT,
      to: VAULT,
      data: "0xea598cb0" + amount.toString(16).padStart(64, "0"),
    });
    expect(wrap.decodedCall!.method).toBe("wrap");
    expect(wrap.decodedCall!.params.amount).toBe(amount.toString());

    const unwrap = await simulator.simulate({
      from: RECIPIENT,
      to: VAULT,
      data: "0xde0e9a3e" + amount.toString(16).padStart(64, "0"),
    });
    expect(unwrap.decodedCall!.method).toBe("unwrap");
  });
});

describe("ABI decoder — Aethelred first-party (ZeroID identity)", () => {
  const REGISTRY = "0x20c3a69318303eb9a79a88fba58652ee8094d5ce";

  it("decodes registerIdentity(didHash, recoveryHash)", async () => {
    const didHash = "ab".repeat(32);
    const recoveryHash = "cd".repeat(32);
    const data = "0x3ffb0036" + didHash + recoveryHash;
    const result = await simulator.simulate({ from: RECIPIENT, to: REGISTRY, data });
    expect(result.decodedCall!.method).toBe("registerIdentity");
    expect(result.decodedCall!.params.didHash).toBe(`0x${didHash}`);
    expect(result.decodedCall!.params.recoveryHash).toBe(`0x${recoveryHash}`);
    expect(result.decodedCall!.metadata?.protocol).toBe("zeroid");
    expect(["safe", "low"]).toContain(result.decodedCall!.risk);
  });
});

describe("ABI decoder — unknown-call blind-sign hardening", () => {
  it("raises risk and warns prominently when calldata cannot be decoded", async () => {
    // A selector the decoder does not know, with plausible calldata.
    const data = "0xdeadbeef" + "11".repeat(64);
    const result = await simulator.simulate({ from: RECIPIENT, to: TOKEN, data });

    expect(result.decodedCall).toBeFalsy();
    // Never a quiet blind-sign: the severity chip reflects it…
    const unknown = result.riskSignals.find((s) => s.id === "unknown-selector");
    expect(unknown?.level).toBe("medium");
    expect(["medium", "high", "critical"]).toContain(result.overallRisk);
    // …and the prominent warnings block tells the user explicitly.
    expect((result.warnings ?? []).join(" ")).toMatch(/could not decode this contract call/i);
    expect((result.warnings ?? []).join(" ")).toContain("0xdeadbeef");
  });
});

describe("ABI decoder — Aethelred first-party (NoblePay settlement)", () => {
  const NOBLEPAY = "0x064b252636a8ee3c7d49256e67ea21a3f4ed1323";
  const PAYEE = "0x2ea3036f71755507d9276c7d94bfcf1d34f7e919";

  it("decodes initiatePayment with recipient, amount, and token", async () => {
    const amount = 250n * 10n ** 18n;
    const data =
      "0x6c2fa3a2" +
      PAYEE.slice(2).padStart(64, "0") +
      amount.toString(16).padStart(64, "0") +
      "00".repeat(32) + // native token (zero address)
      "ab".repeat(32) + // purposeHash
      "555344" + "00".repeat(29); // "USD" bytes3, right-padded
    const result = await simulator.simulate({ from: RECIPIENT, to: NOBLEPAY, data });
    expect(result.decodedCall!.method).toBe("initiatePayment");
    expect(result.decodedCall!.params.recipient).toBe(PAYEE);
    expect(result.decodedCall!.params.amount).toBe(amount.toString());
    expect(result.decodedCall!.metadata?.protocol).toBe("noblepay");
  });

  it("decodes settlePayment and warns about fund release", async () => {
    const paymentId = "cd".repeat(32);
    const result = await simulator.simulate({
      from: RECIPIENT,
      to: NOBLEPAY,
      data: "0x325fda8a" + paymentId,
    });
    expect(result.decodedCall!.method).toBe("settlePayment");
    expect(result.decodedCall!.params.paymentId).toBe(`0x${paymentId}`);
    expect(result.decodedCall!.warnings.join(" ")).toMatch(/escrowed/i);
  });

  it("decodes the corridor clearance with payer, payee, and job id", async () => {
    const jobId = "job-screen-eu-042";
    const bytes = Buffer.from(jobId, "utf8");
    const data =
      "0x6dfa3aef" +
      RECIPIENT.slice(2).padStart(64, "0") +
      PAYEE.slice(2).padStart(64, "0") +
      (96).toString(16).padStart(64, "0") + // string offset (3 head words)
      bytes.length.toString(16).padStart(64, "0") +
      bytes.toString("hex").padEnd(64, "0");
    const result = await simulator.simulate({ from: RECIPIENT, to: NOBLEPAY, data });
    expect(result.decodedCall!.method).toBe("clearCorridor");
    expect(result.decodedCall!.params.payer).toBe(RECIPIENT);
    expect(result.decodedCall!.params.payee).toBe(PAYEE);
    expect(result.decodedCall!.params.jobId).toBe(jobId);
    expect(["safe", "low"]).toContain(result.decodedCall!.risk);
  });
});
