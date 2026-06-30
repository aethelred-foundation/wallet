/**
 * Vendor-swap test for the MPC-TSS adapters. Two distinct vendor SDK shapes
 * (Silence Labs / ZenGo), both backed by the same distributed key, each drop
 * into the SAME MpcTssAdapter and pass its recovery cross-check — i.e. an
 * enterprise switches MPC provider with a constructor change while keeping the
 * exact same adapter (and the compliance pipeline above it). Also covers the
 * normalisation of each vendor's differing signature encoding.
 */

import { describe, it, expect } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as secp256k1 from "@noble/secp256k1";
import {
  MpcTssAdapter,
  SilenceLabsThresholdSigner,
  ZenGoThresholdSigner,
  type SilenceLabsClient,
  type ZenGoClient,
  type TypedDataRequest,
} from "@aethelred/wallet-custody-adapters";

const PRIV = hexToBytes("33".repeat(32));

function addressOf(priv: Uint8Array): `0x${string}` {
  const pub = secp256k1.getPublicKey(priv, false);
  return `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
}
function rawSign(priv: Uint8Array, digest: Uint8Array) {
  const sig = secp256k1.sign(digest, priv, { lowS: true });
  const c = sig.toCompactRawBytes();
  return { r: c.slice(0, 32), s: c.slice(32, 64), recovery: (sig.recovery ?? 0) as 0 | 1 };
}

// Silence Labs SDK shape: sign(keyId, digest) → {r,s,recovery}, raw hex (no 0x).
function silenceLabsClient(priv: Uint8Array): SilenceLabsClient {
  return {
    async sign(_keyId, digest) {
      const { r, s, recovery } = rawSign(priv, digest);
      return { r: bytesToHex(r), s: bytesToHex(s), recovery };
    },
  };
}
// ZenGo SDK shape: generateSignature({vaultId, messageHash}) → {signature:{r,s,recid}},
// 0x-prefixed hex and an Ethereum-style recid (27/28).
function zenGoClient(priv: Uint8Array): ZenGoClient {
  return {
    async generateSignature({ messageHash }) {
      const { r, s, recovery } = rawSign(priv, messageHash);
      return { signature: { r: `0x${bytesToHex(r)}`, s: `0x${bytesToHex(s)}`, recid: 27 + recovery } };
    },
  };
}

const REQ: TypedDataRequest = {
  domain: { name: "Aethelred", version: "1", chainId: 1, verifyingContract: `0x${"00".repeat(20)}` },
  types: { Transfer: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }] },
  primaryType: "Transfer",
  message: { to: `0x${"11".repeat(20)}`, amount: "1000000" },
};

describe("MPC vendor swap (same adapter, different provider)", () => {
  it("Silence Labs signer passes the adapter recovery cross-check", async () => {
    const adapter = new MpcTssAdapter({
      signer: new SilenceLabsThresholdSigner({ client: silenceLabsClient(PRIV), keyId: "key-1", threshold: 2, parties: 3 }),
      address: addressOf(PRIV),
    });
    await expect(adapter.signTypedData(REQ)).resolves.toMatch(/^0x[0-9a-f]{130}$/);
    expect(adapter.capabilities.label).toContain("silence-labs");
  });

  it("ZenGo signer (different SDK shape, 27/28 recid) passes the same cross-check", async () => {
    const adapter = new MpcTssAdapter({
      signer: new ZenGoThresholdSigner({ client: zenGoClient(PRIV), vaultId: "vault-1", threshold: 2, parties: 3 }),
      address: addressOf(PRIV),
    });
    await expect(adapter.signTypedData(REQ)).resolves.toMatch(/^0x[0-9a-f]{130}$/);
    expect(adapter.capabilities.label).toContain("zengo");
  });

  it("swapping the vendor is the only change — identical adapter config + address", async () => {
    const address = addressOf(PRIV);
    const sigs = await Promise.all(
      [
        new SilenceLabsThresholdSigner({ client: silenceLabsClient(PRIV), keyId: "k", threshold: 2, parties: 3 }),
        new ZenGoThresholdSigner({ client: zenGoClient(PRIV), vaultId: "v", threshold: 2, parties: 3 }),
      ].map((signer) => new MpcTssAdapter({ signer, address }).signTypedData(REQ)),
    );
    // Both vendors sign for the same key → identical deterministic signature.
    expect(sigs[0]).toBe(sigs[1]);
  });

  it("a vendor signing for the wrong key is rejected by the cross-check", async () => {
    const adapter = new MpcTssAdapter({
      signer: new SilenceLabsThresholdSigner({ client: silenceLabsClient(PRIV), keyId: "k", threshold: 2, parties: 3 }),
      address: addressOf(hexToBytes("44".repeat(32))), // different address than the key signs for
    });
    await expect(adapter.signTypedData(REQ)).rejects.toMatchObject({ code: "signing-failed" });
  });
});
