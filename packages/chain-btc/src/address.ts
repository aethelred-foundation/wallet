/**
 * Bitcoin address derivation and encoding.
 *
 * Covers every address type the wallet currently signs for:
 *  - P2PKH (legacy)
 *  - P2WPKH (native segwit v0)
 *  - P2TR   (segwit v1, BIP-341)
 *
 * Nested segwit (`p2sh-p2wpkh`) is recognised by `decodeAddress` but
 * the package does not derive new nested addresses — new accounts
 * should default to native segwit or taproot.
 *
 * bech32 / bech32m and base58check are delegated to `@scure/base`
 * (already a transitive dep via `@scure/bip32`). SHA-256 and RIPEMD-160
 * come from `@noble/hashes`.
 */

import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58check as mkBase58check, bech32, bech32m } from "@scure/base";

import { getNetworkParams } from "./networks";
import { BitcoinAddressError, type AddressType, type BitcoinAddress, type BitcoinNetwork } from "./types";

const base58check = mkBase58check(sha256);

/**
 * Strip the `0x` prefix from a hex string, if present.
 *
 * Inline helper so every decoder accepts both `0x…` and bare-hex inputs.
 */
function stripHexPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

/**
 * Convert a hex string (with or without `0x`) to raw bytes.
 *
 * We do not depend on `Buffer` so the package works identically in
 * browser-extension, service-worker, and Node environments.
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = stripHexPrefix(hex);
  if (clean.length % 2 !== 0) {
    throw new BitcoinAddressError(`odd-length hex input: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new BitcoinAddressError(`invalid hex input: ${hex}`);
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Convert bytes to a lowercase `0x`-prefixed hex string.
 */
function bytesToHex0x(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out as `0x${string}`;
}

/**
 * Bitcoin `HASH160` primitive: `RIPEMD160(SHA256(x))`.
 *
 * Used by every pay-to-pubkey-hash address variant.
 */
function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

/**
 * Normalise a hex public key to a 33-byte compressed form, rejecting
 * malformed or uncompressed inputs.
 *
 * Segwit v0 output scripts are only defined for compressed keys (BIP-143
 * §"Specification"), so any attempt to derive a P2WPKH / P2PKH from an
 * uncompressed key is a programming error we surface immediately.
 */
function normaliseCompressedPubKey(pubKey: `0x${string}`): Uint8Array {
  const bytes = hexToBytes(pubKey);
  if (bytes.length !== 33 || (bytes[0] !== 0x02 && bytes[0] !== 0x03)) {
    throw new BitcoinAddressError(
      `expected a 33-byte compressed secp256k1 public key, got ${bytes.length} bytes (prefix 0x${bytes[0]?.toString(16) ?? "??"})`,
    );
  }
  return bytes;
}

/**
 * Normalise a hex public key to a 32-byte x-only form, accepting either
 * a 33-byte compressed key (drops the parity prefix) or an already
 * x-only 32-byte key.
 */
function normaliseXOnlyPubKey(pubKey: `0x${string}`): Uint8Array {
  const bytes = hexToBytes(pubKey);
  if (bytes.length === 32) {
    return bytes;
  }
  if (bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) {
    return bytes.slice(1);
  }
  throw new BitcoinAddressError(
    `expected a 32-byte x-only or 33-byte compressed secp256k1 key, got ${bytes.length} bytes`,
  );
}

/**
 * Encode a `(hrp, witnessVersion, program)` tuple as a bech32 /
 * bech32m address per BIP-173 / BIP-0350.
 *
 * Witness version 0 uses bech32; v1+ uses bech32m. `@scure/base`
 * already implements both; this helper centralises the version-based
 * coder selection so callers never pick the wrong one.
 *
 * @example
 * ```ts
 * encodeBech32("bc", 0, programBytes); // "bc1qw508d6..."
 * ```
 */
export function encodeBech32(hrp: string, witnessVersion: number, program: Uint8Array): string {
  if (witnessVersion < 0 || witnessVersion > 16) {
    throw new BitcoinAddressError(`witness version out of range: ${witnessVersion}`);
  }
  const words = [witnessVersion, ...bech32.toWords(program)];
  const coder = witnessVersion === 0 ? bech32 : bech32m;
  return coder.encode(hrp, words, 1023);
}

/**
 * Decode a bech32 / bech32m address into its parts.
 *
 * Returns `null` when the input is not a valid bech32 string — this
 * keeps callers from having to `try/catch` around expected-invalid
 * addresses during UI validation.
 */
export function decodeBech32(
  address: string,
): { hrp: string; witnessVersion: number; program: Uint8Array } | null {
  let parsed;
  try {
    parsed = bech32.decode(address.toLowerCase() as `${string}1${string}`, 1023);
  } catch {
    try {
      parsed = bech32m.decode(address.toLowerCase() as `${string}1${string}`, 1023);
    } catch {
      return null;
    }
  }
  if (parsed.words.length === 0) return null;
  const witnessVersion = parsed.words[0]!;
  if (witnessVersion < 0 || witnessVersion > 16) return null;

  // Re-select the checksum variant the caller actually used: v0 must be
  // bech32, v1+ must be bech32m. An input that round-trips through the
  // wrong checksum is invalid per BIP-0350.
  const expectedCoder = witnessVersion === 0 ? bech32 : bech32m;
  try {
    expectedCoder.decode(address.toLowerCase() as `${string}1${string}`, 1023);
  } catch {
    return null;
  }

  let program: Uint8Array;
  try {
    program = bech32.fromWords(parsed.words.slice(1));
  } catch {
    return null;
  }
  if (program.length < 2 || program.length > 40) return null;
  if (witnessVersion === 0 && program.length !== 20 && program.length !== 32) return null;

  return { hrp: parsed.prefix, witnessVersion, program };
}

/**
 * Compose a P2WPKH output script: `OP_0 <20-byte-keyhash>`.
 */
function p2wpkhScript(keyHash: Uint8Array): Uint8Array {
  const out = new Uint8Array(22);
  out[0] = 0x00; // OP_0
  out[1] = 0x14; // push 20 bytes
  out.set(keyHash, 2);
  return out;
}

/**
 * Compose a P2PKH output script: `OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG`.
 */
function p2pkhScript(keyHash: Uint8Array): Uint8Array {
  const out = new Uint8Array(25);
  out[0] = 0x76; // OP_DUP
  out[1] = 0xa9; // OP_HASH160
  out[2] = 0x14; // push 20
  out.set(keyHash, 3);
  out[23] = 0x88; // OP_EQUALVERIFY
  out[24] = 0xac; // OP_CHECKSIG
  return out;
}

/**
 * Compose a P2SH output script: `OP_HASH160 <20> OP_EQUAL`.
 */
function p2shScript(scriptHash: Uint8Array): Uint8Array {
  const out = new Uint8Array(23);
  out[0] = 0xa9; // OP_HASH160
  out[1] = 0x14; // push 20
  out.set(scriptHash, 2);
  out[22] = 0x87; // OP_EQUAL
  return out;
}

/**
 * Compose a P2TR output script: `OP_1 <32-byte-xonly-pubkey>`.
 */
function p2trScript(xOnly: Uint8Array): Uint8Array {
  const out = new Uint8Array(34);
  out[0] = 0x51; // OP_1
  out[1] = 0x20; // push 32
  out.set(xOnly, 2);
  return out;
}

/**
 * Derive a native-segwit-v0 (`bc1q…`) address from a compressed public key.
 *
 * @example
 * ```ts
 * const addr = pubKeyToP2WPKH("0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798", "mainnet");
 * addr.address; // "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
 * ```
 */
export function pubKeyToP2WPKH(pubKey: `0x${string}`, network: BitcoinNetwork): BitcoinAddress {
  const params = getNetworkParams(network);
  const compressed = normaliseCompressedPubKey(pubKey);
  const keyHash = hash160(compressed);
  const address = encodeBech32(params.hrp, 0, keyHash);
  return {
    address,
    type: "p2wpkh",
    network,
    scriptPubKey: bytesToHex0x(p2wpkhScript(keyHash)),
  };
}

/**
 * Derive a legacy (`1…` / `m…` / `n…`) P2PKH address from a compressed public key.
 *
 * @example
 * ```ts
 * const addr = pubKeyToP2PKH("0x0279be66...", "mainnet");
 * addr.type; // "p2pkh"
 * ```
 */
export function pubKeyToP2PKH(pubKey: `0x${string}`, network: BitcoinNetwork): BitcoinAddress {
  const params = getNetworkParams(network);
  const compressed = normaliseCompressedPubKey(pubKey);
  const keyHash = hash160(compressed);
  const versioned = new Uint8Array(21);
  versioned[0] = params.p2pkhPrefix;
  versioned.set(keyHash, 1);
  const address = base58check.encode(versioned);
  return {
    address,
    type: "p2pkh",
    network,
    scriptPubKey: bytesToHex0x(p2pkhScript(keyHash)),
  };
}

/**
 * Derive a Taproot (`bc1p…`) address from an x-only or compressed public key.
 *
 * The caller is responsible for any BIP-341 "tweak" — this helper
 * takes the already-tweaked output key and encodes it.
 *
 * @example
 * ```ts
 * const addr = pubKeyToP2TR("0xa3c5...32bytes...", "mainnet");
 * addr.type; // "p2tr"
 * ```
 */
export function pubKeyToP2TR(xOnlyPubKey: `0x${string}`, network: BitcoinNetwork): BitcoinAddress {
  const params = getNetworkParams(network);
  const xOnly = normaliseXOnlyPubKey(xOnlyPubKey);
  const address = encodeBech32(params.hrp, 1, xOnly);
  return {
    address,
    type: "p2tr",
    network,
    scriptPubKey: bytesToHex0x(p2trScript(xOnly)),
  };
}

/**
 * Parse an arbitrary address string into a `BitcoinAddress`.
 *
 * Returns `null` for any input we cannot positively identify as a
 * valid address for `network` — including addresses that are valid
 * for a *different* Bitcoin network. This is deliberate: using a
 * testnet address on mainnet (or vice versa) is a common foot-gun we
 * want to surface as invalid at the UI layer rather than silently
 * accepting.
 *
 * @example
 * ```ts
 * decodeAddress("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", "mainnet"); // p2wpkh
 * decodeAddress("tb1q...", "mainnet");                                     // null
 * ```
 */
export function decodeAddress(address: string, network: BitcoinNetwork): BitcoinAddress | null {
  const params = getNetworkParams(network);

  // Bech32 / bech32m path.
  if (address.toLowerCase().includes("1")) {
    const decoded = decodeBech32(address);
    if (decoded && decoded.hrp === params.hrp) {
      if (decoded.witnessVersion === 0 && decoded.program.length === 20) {
        return {
          address,
          type: "p2wpkh",
          network,
          scriptPubKey: bytesToHex0x(p2wpkhScript(decoded.program)),
        };
      }
      if (decoded.witnessVersion === 1 && decoded.program.length === 32) {
        return {
          address,
          type: "p2tr",
          network,
          scriptPubKey: bytesToHex0x(p2trScript(decoded.program)),
        };
      }
      // Valid HRP but unsupported version or program length.
      return null;
    }
    // Bech32 that isn't for the requested network.
    if (decoded) return null;
  }

  // Base58check path (P2PKH / P2SH / P2SH-P2WPKH share the encoding).
  let payload: Uint8Array;
  try {
    payload = base58check.decode(address);
  } catch {
    return null;
  }
  if (payload.length !== 21) return null;
  const version = payload[0]!;
  const hash = payload.slice(1);
  if (version === params.p2pkhPrefix) {
    return {
      address,
      type: "p2pkh",
      network,
      scriptPubKey: bytesToHex0x(p2pkhScript(hash)),
    };
  }
  if (version === params.p2shPrefix) {
    // We cannot distinguish p2sh-p2wpkh from bare p2sh purely from the
    // address; report the script type ("p2sh-p2wpkh") by convention
    // because every P2SH-encoded address the wallet hands out is a
    // nested segwit wrapper. Downstream signers still need witness
    // data to finalise.
    return {
      address,
      type: "p2sh-p2wpkh",
      network,
      scriptPubKey: bytesToHex0x(p2shScript(hash)),
    };
  }
  return null;
}

/**
 * Internal helper re-exported so the PSBT signer can reuse it without
 * importing `@noble/hashes` directly.
 *
 * @internal
 */
export const _addressInternals = {
  hash160,
  hexToBytes,
  bytesToHex0x,
  p2wpkhScript,
  p2pkhScript,
  normaliseCompressedPubKey,
  /** Re-export addressType helper for signer. */
  typeForScript(script: Uint8Array): AddressType | null {
    if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) return "p2wpkh";
    if (
      script.length === 25 &&
      script[0] === 0x76 &&
      script[1] === 0xa9 &&
      script[2] === 0x14 &&
      script[23] === 0x88 &&
      script[24] === 0xac
    )
      return "p2pkh";
    if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) return "p2tr";
    if (script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87) return "p2sh-p2wpkh";
    return null;
  },
};
