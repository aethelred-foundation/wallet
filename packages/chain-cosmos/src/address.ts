/**
 * Aethelred native address encoding — the `aethel1…` ⇄ `0x…` bridge.
 *
 * Aethelred is a sovereign Cosmos-SDK L1 with an integrated EVM
 * (cosmos/evm). Every account is ONE secp256k1 keypair with TWO renderings
 * of the same 20-byte account identifier:
 *
 *   - native (canonical): bech32 with HRP `aethel` → `aethel1…`
 *     (chain repo `app/app.go`: `AccountAddressPrefix = "aethel"`)
 *   - EVM view:           EIP-55 checksummed hex   → `0x…`
 *
 * Because Aethelred accounts use the `eth_secp256k1` key type, the 20 bytes
 * are derived the *Ethereum* way — `keccak256(uncompressedPubkey[1:])[12:]`
 * — and then bech32-encoded. This differs from vanilla Cosmos chains
 * (`ripemd160(sha256(compressedPubkey))`); both derivations are provided so
 * the package can also address standard `cosmos`-namespace chains.
 *
 * bech32 encoding is delegated to `@scure/base` (the same audited primitive
 * `chain-btc` uses); keccak/sha/ripemd come from `@noble/hashes`.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import * as secp256k1 from "@noble/secp256k1";
import { bech32 } from "@scure/base";

/** Canonical account HRP for Aethelred (chain repo `AccountAddressPrefix`). */
export const AETHELRED_HRP = "aethel";

/** Aethelred validator-operator HRP (`aethelvaloper1…`). */
export const AETHELRED_VALOPER_HRP = "aethelvaloper";

/** Error thrown for malformed or mismatched addresses. */
export class CosmosAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CosmosAddressError";
  }
}

/** How a chain derives its 20-byte account id from a secp256k1 pubkey. */
export type SignatureAlgo = "eth_secp256k1" | "secp256k1";

/**
 * Derive the 20-byte account id from a 33-byte compressed secp256k1 public
 * key, using the chain's signature algorithm:
 *
 *   - `eth_secp256k1` (Aethelred): keccak256(uncompressed[1:])[12:]
 *   - `secp256k1` (vanilla Cosmos): ripemd160(sha256(compressed))
 */
export function addressBytesFromPubkey(
  compressedPubkey: Uint8Array,
  algo: SignatureAlgo,
): Uint8Array {
  if (compressedPubkey.length !== 33) {
    throw new CosmosAddressError(
      `expected 33-byte compressed pubkey, got ${compressedPubkey.length}`,
    );
  }
  if (algo === "eth_secp256k1") {
    // Ethereum-style: hash the 64-byte uncompressed point (without the 0x04
    // prefix byte) and keep the last 20 bytes.
    const uncompressed = secp256k1.ProjectivePoint.fromHex(compressedPubkey)
      .toRawBytes(false);
    return keccak_256(uncompressed.subarray(1)).subarray(12);
  }
  // Vanilla Cosmos: RIPEMD-160 over SHA-256 of the compressed key.
  return ripemd160(sha256(compressedPubkey));
}

/** Encode a 20-byte account id as a bech32 address under `hrp`. */
export function toBech32(hrp: string, addressBytes: Uint8Array): string {
  if (addressBytes.length !== 20) {
    throw new CosmosAddressError(
      `expected 20-byte address, got ${addressBytes.length}`,
    );
  }
  return bech32.encode(hrp, bech32.toWords(addressBytes));
}

/** Decode a bech32 address to its HRP and 20-byte account id. */
export function fromBech32(address: string): {
  hrp: string;
  bytes: Uint8Array;
} {
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(address as `${string}1${string}`);
  } catch (e) {
    // String(e) rather than an instanceof-Error ternary: @scure/base only
    // ever throws Error objects, so the non-Error arm would be dead code.
    throw new CosmosAddressError(
      `invalid bech32 address "${address}": ${String(e)}`,
    );
  }
  const bytes = bech32.fromWords(decoded.words);
  if (bytes.length !== 20) {
    throw new CosmosAddressError(
      `expected 20-byte payload in "${address}", got ${bytes.length}`,
    );
  }
  return { hrp: decoded.prefix, bytes: Uint8Array.from(bytes) };
}

/** Lowercase (non-checksummed) `0x` hex for a 20-byte account id. */
function toHexLower(addressBytes: Uint8Array): string {
  return `0x${Array.from(addressBytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * EIP-55 checksummed `0x` hex rendering of a 20-byte account id — the EVM
 * view of the same account the bech32 address names.
 */
export function toEip55Hex(addressBytes: Uint8Array): string {
  const lower = toHexLower(addressBytes).slice(2);
  const hash = keccak_256(new TextEncoder().encode(lower));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    const nibble = (hash[i >> 1] >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
    out += nibble >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return out;
}

/** Parse a `0x` hex address (any casing) into its 20 raw bytes. */
export function fromHexAddress(hex: string): Uint8Array {
  if (!/^0x[0-9a-fA-F]{40}$/.test(hex)) {
    throw new CosmosAddressError(`invalid 0x address: "${hex}"`);
  }
  const body = hex.slice(2);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    bytes[i] = parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Convert an EVM `0x…` address to its native `aethel1…` rendering. */
export function ethHexToBech32(hex: string, hrp: string = AETHELRED_HRP): string {
  return toBech32(hrp, fromHexAddress(hex));
}

/**
 * Convert a native bech32 address to its EIP-55 `0x…` EVM view.
 * When `expectedHrp` is given, a mismatched prefix is rejected — so a
 * Cosmos-Hub address cannot silently be treated as an Aethelred account.
 */
export function bech32ToEthHex(address: string, expectedHrp?: string): string {
  const { hrp, bytes } = fromBech32(address);
  if (expectedHrp !== undefined && hrp !== expectedHrp) {
    throw new CosmosAddressError(
      `expected HRP "${expectedHrp}", got "${hrp}" in "${address}"`,
    );
  }
  return toEip55Hex(bytes);
}
