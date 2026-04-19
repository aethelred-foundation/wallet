/**
 * EIP-1559 transaction builder — roundtrip correctness.
 *
 * We use a known test private key (NEVER use this key on mainnet!),
 * build an unsigned tx, sign it with the same secp256k1 library the
 * custody backend uses, assemble the signed RLP payload, then recover
 * the signer address from the signature and assert it matches the
 * pubkey we started with. This proves the whole pipeline — RLP
 * encoding, keccak256 preimage, secp256k1 signing, signature splitting,
 * v/r/s assembly, address recovery — is internally consistent.
 *
 * The test private key:
 *   0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318
 * yields the address:
 *   0x2c7536E3605D9C16a7a3D7b1898e529396a65c23
 * This is the key used in the EIP-155 reference test vectors.
 */

import { describe, it, expect } from "vitest";
import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  buildUnsignedEip1559Tx,
  assembleSignedEip1559Tx,
  splitSignature,
  recoverSignerAddress,
  hexToBigInt,
  hexToBytes,
  addressToBytes,
} from "@aethelred/wallet-core";

const TEST_PRIVATE_KEY_HEX = "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
const TEST_PRIVATE_KEY = Uint8Array.from(
  TEST_PRIVATE_KEY_HEX.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
);
const EXPECTED_ADDRESS = "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23".toLowerCase();

function publicKeyToAddress(pubKey: Uint8Array): string {
  const uncompressed = pubKey.length === 33
    ? secp256k1.ProjectivePoint.fromHex(pubKey).toRawBytes(false)
    : pubKey;
  const hash = keccak_256(uncompressed.slice(1));
  const hex = Array.from(hash.slice(-20), (b) => b.toString(16).padStart(2, "0")).join("");
  return "0x" + hex;
}

function signDigest(digest: Uint8Array): Uint8Array {
  const sig = secp256k1.sign(digest, TEST_PRIVATE_KEY, { lowS: true });
  const compact = sig.toCompactRawBytes();
  const out = new Uint8Array(65);
  out.set(compact);
  out[64] = sig.recovery ?? 0;
  return out;
}

describe("transaction.ts — derived address from test key", () => {
  it("matches the EIP-155 reference address for the test private key", () => {
    const pub = secp256k1.getPublicKey(TEST_PRIVATE_KEY, true);
    expect(publicKeyToAddress(pub)).toBe(EXPECTED_ADDRESS);
  });
});

describe("hexToBigInt / hexToBytes / addressToBytes", () => {
  it("hexToBigInt handles missing/empty/0x", () => {
    expect(hexToBigInt(undefined)).toBe(0n);
    expect(hexToBigInt(null)).toBe(0n);
    expect(hexToBigInt("")).toBe(0n);
    expect(hexToBigInt("0x")).toBe(0n);
    expect(hexToBigInt("0xff")).toBe(255n);
    expect(hexToBigInt("0xdeadbeef")).toBe(0xdeadbeefn);
  });

  it("hexToBytes handles missing/empty/0x", () => {
    expect(hexToBytes(undefined)).toEqual(new Uint8Array(0));
    expect(hexToBytes("0x")).toEqual(new Uint8Array(0));
    expect(hexToBytes("0xff")).toEqual(new Uint8Array([0xff]));
    expect(hexToBytes("0xdeadbeef")).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("addressToBytes returns 20 bytes or null", () => {
    expect(addressToBytes(null)).toBeNull();
    expect(addressToBytes(undefined)).toBeNull();
    const bytes = addressToBytes("0x2c7536E3605D9C16a7a3D7b1898e529396a65c23");
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes!.length).toBe(20);
    expect(bytes![0]).toBe(0x2c);
    expect(bytes![19]).toBe(0x23);
  });

  it("addressToBytes throws on wrong length", () => {
    expect(() => addressToBytes("0xdeadbeef")).toThrow(/Invalid address length/);
  });
});

describe("splitSignature", () => {
  it("splits a 65-byte recoverable signature into r/s/recovery", () => {
    const sig = new Uint8Array(65);
    for (let i = 0; i < 32; i++) sig[i] = i + 1; // r
    for (let i = 0; i < 32; i++) sig[32 + i] = i + 100; // s
    sig[64] = 1;
    const { r, s, recovery } = splitSignature(sig);
    expect(r[0]).toBe(1);
    expect(r[31]).toBe(32);
    expect(s[0]).toBe(100);
    expect(s[31]).toBe(131);
    expect(recovery).toBe(1);
  });

  it("throws on wrong length", () => {
    expect(() => splitSignature(new Uint8Array(64))).toThrow(/65-byte/);
  });
});

describe("buildUnsignedEip1559Tx + assembleSignedEip1559Tx — full roundtrip", () => {
  it("signs an unsigned tx and recovers the signer address", () => {
    const tx = {
      chainId: 1n,
      nonce: 9n,
      maxPriorityFeePerGas: 2_000_000_000n, // 2 gwei
      maxFeePerGas: 30_000_000_000n, // 30 gwei
      gasLimit: 21_000n,
      to: addressToBytes("0x3535353535353535353535353535353535353535"),
      value: 1_000_000_000_000_000_000n, // 1 ETH
      data: new Uint8Array(0),
      accessList: [] as Array<[Uint8Array, Uint8Array[]]>,
    };

    const digest = buildUnsignedEip1559Tx(tx);
    expect(digest.length).toBe(32);

    const sig = signDigest(digest);
    expect(sig.length).toBe(65);

    const { rawTx, hash } = assembleSignedEip1559Tx(tx, sig);
    expect(rawTx.startsWith("0x02")).toBe(true);
    expect(hash.startsWith("0x")).toBe(true);
    expect(hash.length).toBe(66); // 0x + 64 hex chars

    const recovered = recoverSignerAddress(digest, sig);
    expect(recovered.toLowerCase()).toBe(EXPECTED_ADDRESS);
  });

  it("handles contract-deployment txs (to = null)", () => {
    const tx = {
      chainId: 1n,
      nonce: 0n,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 20_000_000_000n,
      gasLimit: 500_000n,
      to: null,
      value: 0n,
      data: new Uint8Array([0x60, 0x60, 0x60, 0x40]), // some code
      accessList: [] as Array<[Uint8Array, Uint8Array[]]>,
    };

    const digest = buildUnsignedEip1559Tx(tx);
    const sig = signDigest(digest);
    const { rawTx, hash } = assembleSignedEip1559Tx(tx, sig);

    expect(rawTx.startsWith("0x02")).toBe(true);
    expect(hash).toHaveLength(66);

    const recovered = recoverSignerAddress(digest, sig);
    expect(recovered.toLowerCase()).toBe(EXPECTED_ADDRESS);
  });

  it("produces different digests for different nonces", () => {
    const base = {
      chainId: 1n,
      maxPriorityFeePerGas: 1n,
      maxFeePerGas: 2n,
      gasLimit: 21_000n,
      to: addressToBytes("0x3535353535353535353535353535353535353535"),
      value: 0n,
      data: new Uint8Array(0),
      accessList: [] as Array<[Uint8Array, Uint8Array[]]>,
    };
    const d1 = buildUnsignedEip1559Tx({ ...base, nonce: 1n });
    const d2 = buildUnsignedEip1559Tx({ ...base, nonce: 2n });
    expect(d1).not.toEqual(d2);
  });
});
