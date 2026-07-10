/**
 * Tests for the compliance receipt — the EIP-712 attestation an EIP-7702
 * delegate verifies on-chain. Correctness guarantee: sign→ecrecover round-trip
 * recovers the authority; tampering any field, expiry, a non-allow decision, or
 * a wrong authority all fail verification (so the delegate would reject the tx).
 */

import { describe, it, expect } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as secp256k1 from "@noble/secp256k1";
import { bytesToHex, hexToBytes } from "@aethelred/wallet-core";
import {
  computeIntentHash,
  signComplianceReceipt,
  recoverReceiptAuthority,
  verifyComplianceReceipt,
  RECEIPT_DECISION,
  type ComplianceReceipt,
  type ReceiptDomain,
  type TransactionIntent,
} from "@aethelred/wallet-smart-account";

const PRIV_AUTH = hexToBytes("0x" + "a1".repeat(32));
const PRIV_OTHER = hexToBytes("0x" + "b2".repeat(32));

function addressOf(priv: Uint8Array): `0x${string}` {
  const pub = secp256k1.getPublicKey(priv, false);
  return bytesToHex(keccak_256(pub.slice(1)).slice(-20)) as `0x${string}`;
}
function signer(priv: Uint8Array) {
  return (digest: Uint8Array) => {
    const sig = secp256k1.sign(digest, priv, { lowS: true });
    const out = new Uint8Array(65);
    out.set(sig.toCompactRawBytes(), 0);
    out[64] = sig.recovery ?? 0;
    return out;
  };
}

const DOMAIN: ReceiptDomain = { chainId: 8453, verifyingContract: ("0x" + "de".repeat(20)) as `0x${string}` };
const INTENT: TransactionIntent = {
  chainId: 8453,
  to: ("0x" + "11".repeat(20)) as `0x${string}`,
  value: "1000000000000000000",
  data: "0xdeadbeef",
  nonce: 7,
};
const NOW = 1_750_000_000;

function receipt(over: Partial<ComplianceReceipt> = {}): ComplianceReceipt {
  return {
    intentHash: computeIntentHash(INTENT),
    subject: ("0x" + "ab".repeat(20)) as `0x${string}`,
    decision: RECEIPT_DECISION.allow,
    issuedAt: NOW,
    expiry: NOW + 300,
    pipelineHash: ("0x" + "cd".repeat(32)) as `0x${string}`,
    ...over,
  };
}

describe("computeIntentHash", () => {
  it("is deterministic and sensitive to every field", () => {
    const base = computeIntentHash(INTENT);
    expect(base).toMatch(/^0x[0-9a-f]{64}$/);
    expect(computeIntentHash({ ...INTENT })).toBe(base);
    expect(computeIntentHash({ ...INTENT, nonce: 8 })).not.toBe(base);
    expect(computeIntentHash({ ...INTENT, value: "1" })).not.toBe(base);
    expect(computeIntentHash({ ...INTENT, to: ("0x" + "22".repeat(20)) as `0x${string}` })).not.toBe(base);
    expect(computeIntentHash({ ...INTENT, data: "0xdead" })).not.toBe(base);
  });
});

describe("sign / recover round-trip", () => {
  it("recovers the signing authority", async () => {
    const authority = addressOf(PRIV_AUTH);
    const signed = await signComplianceReceipt(receipt(), DOMAIN, signer(PRIV_AUTH));
    expect(recoverReceiptAuthority(signed, DOMAIN).toLowerCase()).toBe(authority.toLowerCase());
  });

  it("rejects a wrong-length signature", async () => {
    await expect(signComplianceReceipt(receipt(), DOMAIN, () => new Uint8Array(64))).rejects.toThrow(/65-byte/);
  });
});

describe("verifyComplianceReceipt", () => {
  it("accepts a valid allow receipt within its window", async () => {
    const signed = await signComplianceReceipt(receipt(), DOMAIN, signer(PRIV_AUTH));
    expect(verifyComplianceReceipt(signed, DOMAIN, addressOf(PRIV_AUTH), NOW + 1).valid).toBe(true);
  });

  it("rejects a wrong authority", async () => {
    const signed = await signComplianceReceipt(receipt(), DOMAIN, signer(PRIV_AUTH));
    expect(verifyComplianceReceipt(signed, DOMAIN, addressOf(PRIV_OTHER), NOW + 1).valid).toBe(false);
  });

  it("rejects a non-allow decision", async () => {
    const signed = await signComplianceReceipt(receipt({ decision: RECEIPT_DECISION.review }), DOMAIN, signer(PRIV_AUTH));
    const v = verifyComplianceReceipt(signed, DOMAIN, addressOf(PRIV_AUTH), NOW + 1);
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/not allow/);
  });

  it("rejects an expired or not-yet-valid receipt", async () => {
    const signed = await signComplianceReceipt(receipt(), DOMAIN, signer(PRIV_AUTH));
    expect(verifyComplianceReceipt(signed, DOMAIN, addressOf(PRIV_AUTH), NOW + 999).reason).toMatch(/expired/);
    expect(verifyComplianceReceipt(signed, DOMAIN, addressOf(PRIV_AUTH), NOW - 10).reason).toMatch(/not yet valid/);
  });

  it("rejects a tampered receipt (substitution guard)", async () => {
    const authority = addressOf(PRIV_AUTH);
    const signed = await signComplianceReceipt(receipt(), DOMAIN, signer(PRIV_AUTH));
    // swap the bound intent after signing — recovery no longer matches authority
    const tampered = { ...signed, intentHash: computeIntentHash({ ...INTENT, value: "999" }) };
    expect(verifyComplianceReceipt(tampered, DOMAIN, authority, NOW + 1).valid).toBe(false);
  });
});
