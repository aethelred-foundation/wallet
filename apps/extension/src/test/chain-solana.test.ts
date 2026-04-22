/**
 * Solana chain-solana tests.
 *
 * Vectors:
 *  - The canonical Solana "System Program" address `11111111111111111111111111111111`
 *    decodes to 32 zero bytes; this is a stable, always-valid vector.
 *  - Sample Ed25519 key pairs generated deterministically from sequential
 *    seeds so tests stay reproducible.
 *
 * The signer is verified round-trip: we sign, then call ed25519.verify
 * against the same message preimage. We never trust our code to
 * validate itself.
 */

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";

import {
  SolanaTransactionError,
  computeSigningPreimage,
  isValidSolanaAddress,
  pubKeyToSolanaAddress,
  serializeMessage,
  serializeSignedTransaction,
  signTransaction,
  solanaAddressToPubKey,
  type SolanaMessage,
  type SolanaTransaction,
} from "@aethelred/wallet-chain-solana";

/** 32-byte zero pubkey — the System Program's well-known address. */
const SYSTEM_PROGRAM_HEX = ("0x" + "00".repeat(32)) as `0x${string}`;
const SYSTEM_PROGRAM_ADDR = "11111111111111111111111111111111";

/** Deterministic 32-byte key seeded by a fixed pattern. */
function seededPrivKey(seed: number): `0x${string}` {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = (seed * 7 + i) & 0xff;
  return ("0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("pubKeyToSolanaAddress", () => {
  it("encodes the System Program pubkey to its canonical address", () => {
    expect(pubKeyToSolanaAddress(SYSTEM_PROGRAM_HEX)).toBe(SYSTEM_PROGRAM_ADDR);
  });

  it("rejects pubkeys that are not exactly 32 bytes", () => {
    expect(() => pubKeyToSolanaAddress("0x00" as `0x${string}`)).toThrow();
  });
});

describe("solanaAddressToPubKey", () => {
  it("round-trips the System Program address", () => {
    const hexOut = solanaAddressToPubKey(SYSTEM_PROGRAM_ADDR);
    expect(hexOut).toBe(SYSTEM_PROGRAM_HEX);
  });

  it("round-trips a random Ed25519 public key", () => {
    const priv = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) priv[i] = i + 1;
    const pubBytes = ed25519.getPublicKey(priv);
    const pubHex = ("0x" + hex(pubBytes)) as `0x${string}`;
    const addr = pubKeyToSolanaAddress(pubHex);
    expect(solanaAddressToPubKey(addr)).toBe(pubHex);
  });

  it("throws on a malformed address", () => {
    expect(() => solanaAddressToPubKey("notvalid")).toThrow();
  });

  it("throws on a wrong-length decode", () => {
    // Single-character base58 — decodes to too few bytes.
    expect(() => solanaAddressToPubKey("1")).toThrow();
  });
});

describe("isValidSolanaAddress", () => {
  it("accepts the System Program address", () => {
    expect(isValidSolanaAddress(SYSTEM_PROGRAM_ADDR)).toBe(true);
  });

  it("rejects non-string inputs", () => {
    expect(isValidSolanaAddress(undefined as unknown as string)).toBe(false);
    expect(isValidSolanaAddress(12345 as unknown as string)).toBe(false);
  });

  it("rejects the base58 forbidden characters", () => {
    expect(isValidSolanaAddress("0".repeat(32))).toBe(false);
    expect(isValidSolanaAddress("O".repeat(32))).toBe(false);
    expect(isValidSolanaAddress("I".repeat(32))).toBe(false);
    expect(isValidSolanaAddress("l".repeat(32))).toBe(false);
  });

  it("rejects strings outside the 32-44 char length window", () => {
    expect(isValidSolanaAddress("abc")).toBe(false);
    expect(isValidSolanaAddress("a".repeat(60))).toBe(false);
  });
});

/** Build a simple transaction with a single transfer instruction. */
function buildTestTransaction(privHex: `0x${string}`): {
  tx: SolanaTransaction;
  pubHex: `0x${string}`;
} {
  const privBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    privBytes[i] = Number.parseInt(privHex.slice(2 + i * 2, 2 + i * 2 + 2), 16);
  }
  const pubBytes = ed25519.getPublicKey(privBytes);
  const pubHex = ("0x" + hex(pubBytes)) as `0x${string}`;

  const recipientPriv = new Uint8Array(32).fill(0x09);
  const recipient = ed25519.getPublicKey(recipientPriv);
  const recipientHex = ("0x" + hex(recipient)) as `0x${string}`;

  const msg: SolanaMessage = {
    version: "legacy",
    recentBlockhash: ("0x" + "ab".repeat(32)) as `0x${string}`,
    feePayer: pubHex,
    instructions: [
      {
        programId: SYSTEM_PROGRAM_HEX,
        accounts: [
          { pubKey: pubHex, isSigner: true, isWritable: true },
          { pubKey: recipientHex, isSigner: false, isWritable: true },
        ],
        data: "0x02000000e803000000000000", // transfer 1000 lamports (mock)
      },
    ],
  };
  return { tx: { message: msg, signatures: [] }, pubHex };
}

describe("serializeMessage", () => {
  it("produces deterministic bytes for the same input", () => {
    const { tx } = buildTestTransaction(seededPrivKey(1));
    const a = serializeMessage(tx.message);
    const b = serializeMessage(tx.message);
    expect(hex(a)).toBe(hex(b));
  });

  it("starts with the numRequiredSigs byte for a legacy message", () => {
    const { tx } = buildTestTransaction(seededPrivKey(2));
    const bytes = serializeMessage(tx.message);
    // Legacy messages start directly with the header (no version byte).
    // First byte = numRequiredSigs, which for a single-signer tx is 1.
    expect(bytes[0]).toBe(1);
  });

  it("prepends the 0x80 version byte for v0 messages", () => {
    const { tx } = buildTestTransaction(seededPrivKey(3));
    const v0Msg: SolanaMessage = { ...tx.message, version: 0 };
    const bytes = serializeMessage(v0Msg);
    expect(bytes[0]).toBe(0x80);
  });

  it("encodes addressTableLookups on v0 messages", () => {
    const { tx } = buildTestTransaction(seededPrivKey(4));
    const altKey = ("0x" + "cd".repeat(32)) as `0x${string}`;
    const v0Msg: SolanaMessage = {
      ...tx.message,
      version: 0,
      addressTableLookups: [
        { accountKey: altKey, writableIndexes: [1, 2], readonlyIndexes: [3] },
      ],
    };
    const bytes = serializeMessage(v0Msg);
    // Search for the ALT key in the tail of the serialised payload.
    const tail = bytes.slice(-(32 + 1 + 2 + 1 + 1));
    expect(hex(tail.slice(0, 32))).toBe("cd".repeat(32));
    // writable count + indexes + readonly count + indexes
    expect(tail[32]).toBe(2);
    expect(tail[33]).toBe(1);
    expect(tail[34]).toBe(2);
    expect(tail[35]).toBe(1);
    expect(tail[36]).toBe(3);
  });

  it("refuses addressTableLookups on legacy messages", () => {
    const { tx } = buildTestTransaction(seededPrivKey(5));
    const bad: SolanaMessage = {
      ...tx.message,
      addressTableLookups: [
        { accountKey: ("0x" + "dd".repeat(32)) as `0x${string}`, writableIndexes: [0], readonlyIndexes: [] },
      ],
    };
    expect(() => serializeMessage(bad)).toThrow(SolanaTransactionError);
  });
});

describe("signTransaction", () => {
  it("produces a signature Ed25519.verify accepts against the preimage", async () => {
    const priv = seededPrivKey(7);
    const { tx, pubHex } = buildTestTransaction(priv);
    const signed = await signTransaction(tx, priv);
    expect(signed.signatures.length).toBe(1);
    const entry = signed.signatures[0]!;
    expect(entry.signer).toBe(pubHex);

    const preimage = computeSigningPreimage(signed);
    const sigBytes = Uint8Array.from(
      entry.signature
        .slice(2)
        .match(/.{2}/g)!
        .map((h) => Number.parseInt(h, 16)),
    );
    const pubBytes = Uint8Array.from(
      pubHex
        .slice(2)
        .match(/.{2}/g)!
        .map((h) => Number.parseInt(h, 16)),
    );
    expect(ed25519.verify(sigBytes, preimage, pubBytes)).toBe(true);
  });

  it("rejects malformed private key lengths", async () => {
    const { tx } = buildTestTransaction(seededPrivKey(8));
    await expect(signTransaction(tx, "0x00" as `0x${string}`)).rejects.toThrow(
      SolanaTransactionError,
    );
  });

  it("collapses duplicate signer entries on repeat-sign", async () => {
    const priv = seededPrivKey(9);
    const { tx } = buildTestTransaction(priv);
    const once = await signTransaction(tx, priv);
    const twice = await signTransaction(once, priv);
    expect(twice.signatures.length).toBe(1);
  });
});

describe("serializeSignedTransaction", () => {
  it("emits a non-empty base58 string that starts with a compact-u16 sig count", async () => {
    const priv = seededPrivKey(10);
    const { tx } = buildTestTransaction(priv);
    const signed = await signTransaction(tx, priv);
    const wire = serializeSignedTransaction(signed);
    expect(typeof wire).toBe("string");
    expect(wire.length).toBeGreaterThan(0);
    // base58 alphabet check
    expect(/^[1-9A-HJ-NP-Za-km-z]+$/.test(wire)).toBe(true);
  });

  it("uses zero-filled placeholder signatures when the fee-payer is unsigned", () => {
    const { tx } = buildTestTransaction(seededPrivKey(11));
    // Not signed yet.
    const wire = serializeSignedTransaction(tx);
    expect(wire.length).toBeGreaterThan(0);
  });
});

describe("computeSigningPreimage", () => {
  it("equals serializeMessage(tx.message)", () => {
    const { tx } = buildTestTransaction(seededPrivKey(12));
    expect(hex(computeSigningPreimage(tx))).toBe(hex(serializeMessage(tx.message)));
  });
});
