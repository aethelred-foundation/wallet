/**
 * Solana address encoding.
 *
 * Solana addresses are raw 32-byte Ed25519 public keys rendered as
 * base58. `@scure/base` ships a canonical, audited base58 coder we
 * reuse; we do not roll our own.
 *
 * The validation rules the wallet enforces are intentionally
 * pessimistic:
 *  - Decode must succeed.
 *  - Result length must be exactly 32 bytes.
 *  - Alphabet must match Bitcoin-style base58 (no `0OIl`).
 *
 * We do **not** attempt to verify the key is "on-curve" — program
 * derived addresses (PDAs) are valid Solana addresses by construction
 * and deliberately lie off the curve. Higher layers that only ever
 * sign for on-curve keys must check that property separately.
 */

import { base58 } from "@scure/base";

import { SolanaAddressError } from "./types";

/**
 * Strip a `0x` prefix if present.
 */
function stripHexPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

/**
 * Parse a hex string to bytes.
 *
 * Duplicated from chain-btc to keep the package self-contained — these
 * are micro-helpers rather than a shared dependency.
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = stripHexPrefix(hex);
  if (clean.length % 2 !== 0) {
    throw new SolanaAddressError(`odd-length hex input: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new SolanaAddressError(`invalid hex input: ${hex}`);
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Render bytes as a `0x`-prefixed lowercase hex string.
 */
function bytesToHex0x(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out as `0x${string}`;
}

/**
 * Render a 32-byte raw public key (hex) as a Solana base58 address.
 *
 * @example
 * ```ts
 * // The Solana System Program has a 32-byte pubkey of all zeros.
 * pubKeyToSolanaAddress("0x0000000000000000000000000000000000000000000000000000000000000000");
 * // "11111111111111111111111111111111"
 * ```
 */
export function pubKeyToSolanaAddress(pubKey: `0x${string}`): string {
  const bytes = hexToBytes(pubKey);
  if (bytes.length !== 32) {
    throw new SolanaAddressError(
      `Solana public keys must be 32 bytes; got ${bytes.length}`,
    );
  }
  return base58.encode(bytes);
}

/**
 * Decode a Solana base58 address back into its raw 32-byte hex form.
 *
 * Throws `SolanaAddressError` on malformed input — consumers that want
 * a boolean check should call `isValidSolanaAddress` instead.
 *
 * @example
 * ```ts
 * solanaAddressToPubKey("11111111111111111111111111111111");
 * // "0x0000000000000000000000000000000000000000000000000000000000000000"
 * ```
 */
export function solanaAddressToPubKey(address: string): `0x${string}` {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) {
    throw new SolanaAddressError(
      `Solana base58 addresses are 32-44 characters; got length ${address?.length ?? 0}`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(address);
  } catch (err) {
    throw new SolanaAddressError(
      `base58 decode failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (bytes.length !== 32) {
    throw new SolanaAddressError(
      `decoded key must be 32 bytes; got ${bytes.length}`,
    );
  }
  return bytesToHex0x(bytes);
}

/**
 * Return `true` iff `address` is a syntactically-valid Solana address.
 *
 * This is the UI-layer validator: it rejects anything that is not
 * base58, has the wrong length, or contains characters outside the
 * base58 alphabet (`0`, `O`, `I`, `l`).
 *
 * @example
 * ```ts
 * isValidSolanaAddress("11111111111111111111111111111111"); // true
 * isValidSolanaAddress("not-a-real-address");               // false
 * isValidSolanaAddress("0IlO");                             // false
 * ```
 */
export function isValidSolanaAddress(address: string): boolean {
  if (typeof address !== "string") return false;
  // Solana pubkeys encode to either 43 or 44 base58 characters once
  // they're 32 bytes. Anything shorter than 32 chars or longer than
  // 44 is decisively wrong, even for base58's non-constant ratio.
  if (address.length < 32 || address.length > 44) return false;
  if (/[0OIl]/.test(address)) return false;
  try {
    const bytes = base58.decode(address);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

/**
 * Internal helpers exposed for the transaction serializer.
 *
 * @internal
 */
export const _addressInternals = {
  hexToBytes,
  bytesToHex0x,
};
