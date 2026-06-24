/**
 * Tests for the EIP-7702 authorization primitive.
 *
 * The cryptographic correctness guarantee is the round-trip:
 *   sign(authorization, privKey)  →  recoverAuthority(...) === address(privKey)
 * which exercises the full RLP-encode → keccak → secp256k1 → ecrecover
 * path against a key whose address we derive independently. Tampering
 * with any signed field must break recovery — that's the replay /
 * substitution guard the spec relies on.
 */

import { describe, it, expect } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as secp256k1 from "@noble/secp256k1";
// Importing core runs its crypto bootstrap (wires hmacSha256Sync into
// @noble/secp256k1 so secp256k1.sign works synchronously).
import { bytesToHex, hexToBytes } from "@aethelred/wallet-core";
import {
  ANY_CHAIN_ID,
  AUTHORIZATION_MAGIC,
  SET_CODE_TX_TYPE,
  encodeSignedAuthorization,
  hashAuthorization,
  isWildcardAuthorization,
  recoverAuthority,
  signAuthorization,
  verifyAuthorization,
  type Authorization,
  type SignDigestFn,
} from "@aethelred/wallet-smart-account";

const PRIV_A = hexToBytes("0x" + "11".repeat(32));
const PRIV_B = hexToBytes("0x" + "22".repeat(32));
const DELEGATE = "0x6c0000000000000000000000000000000000c0de" as const;

/** Derive the lower-case EOA address for a private key. */
function addressOf(priv: Uint8Array): `0x${string}` {
  const pub = secp256k1.getPublicKey(priv, false); // uncompressed, 0x04 ‖ X ‖ Y
  return bytesToHex(keccak_256(pub.slice(1)).slice(-20)) as `0x${string}`;
}

/** A custody-shaped signer (digest → 65-byte r‖s‖v) for a known key. */
function signerFor(priv: Uint8Array): SignDigestFn {
  return (digest) => {
    const sig = secp256k1.sign(digest, priv, { lowS: true });
    const out = new Uint8Array(65);
    out.set(sig.toCompactRawBytes(), 0);
    out[64] = sig.recovery ?? 0;
    return out;
  };
}

const baseAuth: Authorization = { chainId: 1n, address: DELEGATE, nonce: 7n };

describe("EIP-7702 constants", () => {
  it("uses the spec magic and tx type", () => {
    expect(AUTHORIZATION_MAGIC).toBe(0x05);
    expect(SET_CODE_TX_TYPE).toBe(0x04);
    expect(ANY_CHAIN_ID).toBe(0n);
  });
});

describe("hashAuthorization", () => {
  it("is a deterministic 32-byte digest", () => {
    const a = hashAuthorization(baseAuth);
    const b = hashAuthorization({ ...baseAuth });
    expect(a).toHaveLength(32);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it("changes with every field", () => {
    const base = bytesToHex(hashAuthorization(baseAuth));
    expect(bytesToHex(hashAuthorization({ ...baseAuth, chainId: 2n }))).not.toBe(base);
    expect(bytesToHex(hashAuthorization({ ...baseAuth, nonce: 8n }))).not.toBe(base);
    expect(
      bytesToHex(hashAuthorization({ ...baseAuth, address: ("0x" + "ab".repeat(20)) as `0x${string}` })),
    ).not.toBe(base);
  });

  it("rejects a malformed delegate address", () => {
    expect(() => hashAuthorization({ ...baseAuth, address: "0xdeadbeef" as `0x${string}` })).toThrow(
      /invalid delegate address/,
    );
  });

  it("rejects negative chainId / nonce", () => {
    expect(() => hashAuthorization({ ...baseAuth, chainId: -1n })).toThrow(/chainId/);
    expect(() => hashAuthorization({ ...baseAuth, nonce: -1n })).toThrow(/nonce/);
  });
});

describe("signAuthorization → recoverAuthority round-trip", () => {
  it("recovers the signing EOA across chain ids and nonces", async () => {
    const authority = addressOf(PRIV_A);
    const sign = signerFor(PRIV_A);
    for (const chainId of [1n, ANY_CHAIN_ID, 8453n, 11155111n]) {
      for (const nonce of [0n, 1n, 42n, 2n ** 40n]) {
        const signed = await signAuthorization({ chainId, address: DELEGATE, nonce }, sign);
        expect(signed.yParity === 0 || signed.yParity === 1).toBe(true);
        expect(recoverAuthority(signed).toLowerCase()).toBe(authority.toLowerCase());
      }
    }
  });

  it("produces 32-byte r and s", async () => {
    const signed = await signAuthorization(baseAuth, signerFor(PRIV_A));
    expect(hexToBytes(signed.r)).toHaveLength(32);
    expect(hexToBytes(signed.s)).toHaveLength(32);
  });

  it("rejects a signature of the wrong length", async () => {
    const badSigner: SignDigestFn = () => new Uint8Array(64);
    await expect(signAuthorization(baseAuth, badSigner)).rejects.toThrow(/65-byte/);
  });
});

describe("verifyAuthorization", () => {
  it("accepts the true authority and rejects another", async () => {
    const signed = await signAuthorization(baseAuth, signerFor(PRIV_A));
    expect(verifyAuthorization(signed, addressOf(PRIV_A))).toBe(true);
    expect(verifyAuthorization(signed, addressOf(PRIV_B))).toBe(false);
  });

  it("rejects a tampered authorization (substitution guard)", async () => {
    const authority = addressOf(PRIV_A);
    const signed = await signAuthorization(baseAuth, signerFor(PRIV_A));
    // Flip the nonce after signing — recovery must no longer match.
    expect(verifyAuthorization({ ...signed, nonce: signed.nonce + 1n }, authority)).toBe(false);
    expect(verifyAuthorization({ ...signed, chainId: signed.chainId + 1n }, authority)).toBe(false);
    expect(
      verifyAuthorization({ ...signed, address: ("0x" + "ff".repeat(20)) as `0x${string}` }, authority),
    ).toBe(false);
  });

  it("returns false (not throw) on structurally invalid signatures", async () => {
    const signed = await signAuthorization(baseAuth, signerFor(PRIV_A));
    expect(verifyAuthorization({ ...signed, r: "0x00" as `0x${string}` }, addressOf(PRIV_A))).toBe(false);
  });
});

describe("encodeSignedAuthorization", () => {
  it("emits a 6-element RLP list", async () => {
    const signed = await signAuthorization(baseAuth, signerFor(PRIV_A));
    const encoded = encodeSignedAuthorization(signed);
    // RLP list payloads are prefixed with a byte >= 0xc0.
    expect(encoded[0]).toBeGreaterThanOrEqual(0xc0);
    expect(encoded.length).toBeGreaterThan(60); // address + r + s alone are 84 bytes
  });

  it("is sensitive to the signed contents", async () => {
    const s1 = await signAuthorization(baseAuth, signerFor(PRIV_A));
    const s2 = await signAuthorization({ ...baseAuth, nonce: 8n }, signerFor(PRIV_A));
    expect(bytesToHex(encodeSignedAuthorization(s1))).not.toBe(
      bytesToHex(encodeSignedAuthorization(s2)),
    );
  });
});

describe("isWildcardAuthorization", () => {
  it("flags chainId 0 as the cross-chain wildcard", () => {
    expect(isWildcardAuthorization({ ...baseAuth, chainId: 0n })).toBe(true);
    expect(isWildcardAuthorization(baseAuth)).toBe(false);
  });
});
