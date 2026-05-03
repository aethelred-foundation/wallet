/**
 * Secp256k1OracleSignatureVerifier — production-grade
 * {@link OracleSignatureVerifier} for the most common oracle
 * signing scheme.
 *
 * Why this exists:
 *   PR #152's `JsonFeedLiabilityAttestor` shipped two reference
 *   verifiers: `PASSTHROUGH_VERIFIER` (transport-trust mode) and
 *   `REJECT_ALL_VERIFIER` (test-only). Operators wiring real oracles
 *   need cryptographic verification. This module provides the
 *   secp256k1 case — by far the most common signing scheme across
 *   Chainlink, vendor APIs, and bespoke oracle deployments.
 *
 * Design properties:
 *   - Per-`oracleId` key pinning: the verifier holds a map from
 *     oracleId to public-key bytes. An attestation claiming
 *     `oracleId: "chainlink:custody:komainu"` is verified against
 *     the pinned key for THAT oracle id only — no key-swap attacks.
 *   - Multiple key formats accepted: compressed (33 bytes), uncompressed
 *     (65 bytes), or raw bytes/hex. The verifier normalizes internally.
 *   - Two signature formats accepted: 64-byte compact (r||s) and
 *     65-byte Ethereum-style (r||s||v with the recovery byte
 *     stripped). DER-encoded signatures are NOT accepted — `@noble/
 *     secp256k1` v2 deliberately doesn't ship DER. Operators dealing
 *     with DER-signing oracles transcode to compact upstream.
 *   - Never throws (per the {@link OracleSignatureVerifier} contract).
 *     Every error path → `false`.
 *
 * Trust model:
 *   The pinned public keys are part of the WALLET'S configuration,
 *   not the oracle's claim. An attacker who controls the oracle can
 *   send any payload signed by their key, but the verifier rejects
 *   anything not signed by the pinned key for that oracleId.
 *   Operators rotate keys by updating the pin map; they can also
 *   pin multiple keys per oracleId during rotation windows.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import * as secp256k1 from "@noble/secp256k1";

import type { OracleSignatureVerifier } from "./json-feed-attestor";

// ─── Public types ──────────────────────────────────────────────────

/**
 * Pinned public key entry for one oracle id.
 *
 * `keyBytes` may be:
 *   - 33-byte compressed (0x02 / 0x03 prefix)
 *   - 65-byte uncompressed (0x04 prefix)
 *   - 64-byte raw uncompressed (no prefix — internally re-prefixed)
 *
 * Hex strings (with or without 0x prefix) are accepted at construction
 * time; bytes are normalized into a stable internal representation.
 */
export type PinnedKey = Uint8Array | string;

export interface Secp256k1OracleVerifierConfig {
  /**
   * Map from oracleId → list of acceptable public keys for that
   * oracle. Multiple keys are useful during rotation windows: the
   * old key still verifies in-flight signed snapshots while the new
   * key takes over for fresh ones.
   *
   * Empty array OR missing oracleId → no pinned key, verification
   * fails closed.
   */
  readonly pinnedKeys: ReadonlyMap<string, ReadonlyArray<PinnedKey>>;
  /**
   * Hash function used to produce the signing digest from the
   * payload. Default `sha256`. Some oracles sign over keccak256 or
   * a custom digest — operators inject the correct hash here.
   */
  readonly hash?: (input: Uint8Array) => Uint8Array;
}

// ─── Implementation ──────────────────────────────────────────────

/**
 * Verifies that a payload was signed by the secp256k1 private key
 * corresponding to one of the public keys pinned for `oracleId`.
 */
export class Secp256k1OracleSignatureVerifier
  implements OracleSignatureVerifier
{
  private readonly normalizedKeys: Map<string, Uint8Array[]>;
  private readonly hashFn: (input: Uint8Array) => Uint8Array;

  constructor(config: Secp256k1OracleVerifierConfig) {
    this.hashFn = config.hash ?? sha256;
    this.normalizedKeys = new Map();
    for (const [oracleId, keys] of config.pinnedKeys.entries()) {
      const normalized: Uint8Array[] = [];
      for (const key of keys) {
        const norm = tryNormalizePublicKey(key);
        if (norm !== null) normalized.push(norm);
      }
      if (normalized.length > 0) {
        this.normalizedKeys.set(oracleId, normalized);
      }
    }
  }

  verify(input: {
    readonly oracleId: string;
    readonly payload: Uint8Array;
    readonly signature: `0x${string}`;
  }): boolean {
    const keys = this.normalizedKeys.get(input.oracleId);
    if (!keys || keys.length === 0) return false;

    let digest: Uint8Array;
    try {
      digest = this.hashFn(input.payload);
    } catch {
      return false;
    }

    const sigBytes = tryNormalizeSignature(input.signature);
    if (sigBytes === null) return false;

    for (const key of keys) {
      try {
        // `@noble/secp256k1` v2: `verify(sig, msgHash, pubKey)`.
        // `lowS: true` enforces the Ethereum-style canonical signature
        // requirement (EIP-2). Oracles that produce non-low-s sigs
        // will fail here — that's correct behavior; canonical sigs
        // are the security baseline.
        const ok = secp256k1.verify(sigBytes, digest, key, { lowS: true });
        if (ok) return true;
      } catch {
        // Try the next key. A single key throwing (e.g., malformed
        // pin) shouldn't block another pinned key from matching.
        continue;
      }
    }
    return false;
  }
}

// ─── Normalization helpers ────────────────────────────────────────

function tryNormalizePublicKey(input: PinnedKey): Uint8Array | null {
  let bytes: Uint8Array;
  try {
    bytes = typeof input === "string" ? hexToBytes(input) : input;
  } catch {
    return null;
  }

  // 33 / 65 byte forms accepted directly.
  if (bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) {
    return bytes;
  }
  if (bytes.length === 65 && bytes[0] === 0x04) {
    return bytes;
  }
  // 64-byte raw uncompressed — re-prefix with 0x04 so noble accepts it.
  if (bytes.length === 64) {
    const out = new Uint8Array(65);
    out[0] = 0x04;
    out.set(bytes, 1);
    return out;
  }
  return null;
}

function tryNormalizeSignature(sig: `0x${string}`): Uint8Array | null {
  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(sig);
  } catch {
    return null;
  }

  // 64-byte compact (r||s) — direct.
  if (bytes.length === 64) return bytes;

  // 65-byte Ethereum-style (r||s||v): strip recovery byte. Verify
  // doesn't need v, only r and s.
  if (bytes.length === 65) return bytes.subarray(0, 64);

  return null;
}

function hexToBytes(input: string): Uint8Array {
  const trimmed = input.startsWith("0x") || input.startsWith("0X")
    ? input.slice(2)
    : input;
  if (trimmed.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  if (!/^[0-9a-fA-F]*$/.test(trimmed)) {
    throw new Error("hex string contains non-hex characters");
  }
  const out = new Uint8Array(trimmed.length / 2);
  for (let i = 0; i < trimmed.length; i += 2) {
    out[i / 2] = parseInt(trimmed.substring(i, i + 2), 16);
  }
  return out;
}
