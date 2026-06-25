/**
 * Tests for the vendor-agnostic MPC-TSS custody adapter. A fake
 * ThresholdSigner backed by a known key produces real recoverable
 * signatures, so the recovery cross-check (the adapter's core security
 * property) is genuinely exercised: correct address → accepted, wrong
 * address → rejected before the signature leaves the adapter.
 */

import { describe, it, expect } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as secp256k1 from "@noble/secp256k1";
import {
  MpcTssAdapter,
  CustodyError,
  type ThresholdSigner,
  type TypedDataRequest,
} from "@aethelred/wallet-custody-adapters";

const PRIV_A = hexToBytes("11".repeat(32));
const PRIV_B = hexToBytes("22".repeat(32));

function addressOf(priv: Uint8Array): `0x${string}` {
  const pub = secp256k1.getPublicKey(priv, false);
  return `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
}

function signerFor(priv: Uint8Array, label = "fake-cohort", threshold = 2, parties = 3): ThresholdSigner {
  return {
    label,
    threshold,
    parties,
    async signDigest(digest: Uint8Array) {
      const sig = secp256k1.sign(digest, priv, { lowS: true });
      const compact = sig.toCompactRawBytes();
      return {
        r: `0x${bytesToHex(compact.slice(0, 32))}` as `0x${string}`,
        s: `0x${bytesToHex(compact.slice(32, 64))}` as `0x${string}`,
        recovery: (sig.recovery ?? 0) as 0 | 1,
      };
    },
  };
}

const REQ: TypedDataRequest = {
  domain: { name: "Aethelred", version: "1", chainId: 1, verifyingContract: `0x${"00".repeat(20)}` },
  types: { Transfer: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }] },
  primaryType: "Transfer",
  message: { to: `0x${"11".repeat(20)}`, amount: "1000000" },
};

function expectCode(fn: () => Promise<unknown>, code: string) {
  return expect(fn()).rejects.toMatchObject({ code });
}

describe("MpcTssAdapter signing + recovery cross-check", () => {
  it("signs typed data and passes the recovery cross-check for the right address", async () => {
    const adapter = new MpcTssAdapter({ signer: signerFor(PRIV_A), address: addressOf(PRIV_A) });
    const sig = await adapter.signTypedData(REQ);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/); // r(32)+s(32)+v(1)
    const v = parseInt(sig.slice(-2), 16);
    expect(v === 27 || v === 28).toBe(true);
  });

  it("rejects a signature that recovers to a different address (cohort mismatch)", async () => {
    // signer holds PRIV_A but the adapter is configured for PRIV_B's address
    const adapter = new MpcTssAdapter({ signer: signerFor(PRIV_A), address: addressOf(PRIV_B) });
    await expectCode(() => adapter.signTypedData(REQ), "signing-failed");
  });

  it("skips the cross-check when verifyRecovery is false", async () => {
    const adapter = new MpcTssAdapter({ signer: signerFor(PRIV_A), address: addressOf(PRIV_B), verifyRecovery: false });
    await expect(adapter.signTypedData(REQ)).resolves.toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("signs an arbitrary 32-byte digest and rejects wrong sizes", async () => {
    const adapter = new MpcTssAdapter({ signer: signerFor(PRIV_A), address: addressOf(PRIV_A) });
    await expect(adapter.signDigest(keccak_256(new Uint8Array([1, 2, 3])))).resolves.toMatch(/^0x[0-9a-f]{130}$/);
    await expectCode(() => adapter.signDigest(new Uint8Array(31)), "signature-malformed");
  });
});

describe("MpcTssAdapter error handling", () => {
  it("wraps a signer failure as signing-failed", async () => {
    const broken: ThresholdSigner = { label: "x", threshold: 2, parties: 3, async signDigest() { throw new Error("cohort offline"); } };
    const adapter = new MpcTssAdapter({ signer: broken, address: addressOf(PRIV_A) });
    await expectCode(() => adapter.signTypedData(REQ), "signing-failed");
  });

  it("rejects an out-of-range recovery id", async () => {
    const weird: ThresholdSigner = {
      label: "x", threshold: 2, parties: 3,
      async signDigest() { return { r: `0x${"11".repeat(32)}`, s: `0x${"22".repeat(32)}`, recovery: 2 as unknown as 0 }; },
    };
    const adapter = new MpcTssAdapter({ signer: weird, address: addressOf(PRIV_A) });
    await expectCode(() => adapter.signDigest(new Uint8Array(32)), "signature-malformed");
  });

  it("validates config", () => {
    expect(() => new MpcTssAdapter({ signer: signerFor(PRIV_A), address: "0xbad" as `0x${string}` })).toThrow(CustodyError);
    expect(() => new MpcTssAdapter({ signer: signerFor(PRIV_A, "x", 4, 3), address: addressOf(PRIV_A) })).toThrow(/threshold/);
  });
});

describe("MpcTssAdapter contract surface", () => {
  it("exposes capabilities and an x402 TypedDataSigner", async () => {
    const adapter = new MpcTssAdapter({ signer: signerFor(PRIV_A), address: addressOf(PRIV_A) });
    expect(adapter.capabilities.canSignTypedData).toBe(true);
    expect(adapter.capabilities.canSignRawTransaction).toBe(false);
    expect(adapter.capabilities.label).toContain("mpc-tss-2of3");
    const signer = adapter.asTypedDataSigner();
    expect(signer.address).toBe(addressOf(PRIV_A));
    await expect(signer.signTypedData(REQ)).resolves.toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("refuses use after dispose", async () => {
    const adapter = new MpcTssAdapter({ signer: signerFor(PRIV_A), address: addressOf(PRIV_A) });
    await adapter.dispose();
    await expectCode(() => adapter.signTypedData(REQ), "adapter-disposed");
  });
});
