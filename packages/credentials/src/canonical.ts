/**
 * Deterministic canonical encoding for attestations and presentations.
 *
 * Signature schemes must sign the SAME bytes a verifier can re-derive. JSON
 * stringification is not deterministic by default (object-key order is
 * implementation-specific), so this module recursively sorts object keys
 * and emits a stable UTF-8 byte sequence.
 *
 * Approach:
 *   - Arrays preserve order (semantically meaningful).
 *   - Objects have their keys sorted lexicographically, recursively.
 *   - `undefined` values are dropped (JSON has no undefined).
 *   - BigInt is rejected — callers must pre-encode BigInts as decimal
 *     strings so the canonical form is deterministic across platforms.
 *
 * @packageDocumentation
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";

import {
  type Attestation,
  type Presentation,
  type PresentationRequest,
  AttestationError,
} from "./types";

/** Hex-prefixed byte string. */
export type HexString = `0x${string}`;

/**
 * Convert a `Uint8Array` to a `0x`-prefixed lowercase hex string.
 *
 * @example
 * ```ts
 * bytesToHex(new Uint8Array([0xab, 0xcd])); // "0xabcd"
 * ```
 */
export function bytesToHex(bytes: Uint8Array): HexString {
  let s = "0x";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s as HexString;
}

/**
 * Parse a `0x`-prefixed hex string into a `Uint8Array`.
 *
 * @throws CredentialError when the string is not 0x-prefixed or has an odd length.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (!hex.startsWith("0x")) {
    throw new AttestationError("hex-malformed", "Hex string must start with 0x");
  }
  const body = hex.slice(2);
  if (body.length % 2 !== 0) {
    throw new AttestationError("hex-malformed", "Hex string must have an even length");
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(body.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new AttestationError("hex-malformed", "Hex string contains non-hex characters");
    }
    out[i] = byte;
  }
  return out;
}

/**
 * Recursively serialize a value in a deterministic, key-sorted form.
 *
 * The output is ASCII and contains no whitespace, so the byte sequence is
 * stable across runtimes.
 *
 * @throws AttestationError if the value contains a BigInt, symbol, or function.
 *
 * @example
 * ```ts
 * canonicalJson({ b: 2, a: 1 }); // "{\"a\":1,\"b\":2}"
 * ```
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AttestationError(
        "canonical-encoding",
        "Cannot canonical-encode non-finite numbers"
      );
    }
    // Use JSON.stringify for the numeric formatting so that integers vs
    // floats are stable and match what a verifier in a different runtime
    // would produce.
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") {
    throw new AttestationError(
      "canonical-encoding",
      "BigInt is not permitted; encode as decimal string first"
    );
  }
  if (typeof value === "symbol" || typeof value === "function") {
    throw new AttestationError(
      "canonical-encoding",
      `Cannot canonical-encode ${typeof value}`
    );
  }
  if (value === undefined) {
    // Defined behaviour: skipped when encountered as an object property,
    // but if it surfaces as a top-level value we return `null` so the
    // output stays valid JSON.
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries: string[] = [];
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      entries.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
    }
    return `{${entries.join(",")}}`;
  }
  throw new AttestationError(
    "canonical-encoding",
    `Cannot canonical-encode value of type ${typeof value}`
  );
}

/**
 * Keccak-256 digest of a canonical encoding.
 *
 * This is the hash the issuer signs and the verifier re-derives.
 */
export function keccak256Hex(data: Uint8Array | string): HexString {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return bytesToHex(keccak_256(bytes));
}

/**
 * SHA-256 digest of a canonical encoding. Provided for schemes that prefer
 * SHA-256 over Keccak (for example, when integrating with SD-JWT verifiers).
 */
export function sha256Hex(data: Uint8Array | string): HexString {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return bytesToHex(sha256(bytes));
}

/**
 * Build the deterministic Aethelred attestation UID.
 *
 * UID is `keccak256(canonicalJson(schemaId, issuerId, subject, issuedAt, nonce))`.
 * The UID is stable across runtimes and platforms — same inputs always
 * produce the same UID — so a holder can reproduce the identifier without
 * storing it alongside the attestation.
 */
export function computeAttestationUid(input: {
  schemaId: string;
  issuerId: string;
  subject: string;
  issuedAt: number;
  nonce: string;
}): HexString {
  return keccak256Hex(
    canonicalJson({
      issuedAt: input.issuedAt,
      issuerId: input.issuerId,
      nonce: input.nonce,
      schemaId: input.schemaId,
      subject: input.subject,
    })
  );
}

/**
 * Produce the canonical byte string that an issuer signs when creating
 * an attestation.
 *
 * The issuer signs `sha256(canonicalEncoding)` — SHA-256 is required by
 * `@noble/secp256k1` which expects a 32-byte message hash. The verifier
 * repeats the same encoding + hashing to check the signature.
 */
export function canonicalAttestationBytes(att: Attestation): Uint8Array {
  const canonical = canonicalJson({
    schemaId: att.schemaId,
    issuerId: att.issuer.id,
    subject: att.subject,
    claim: att.claim,
    issuedAt: att.issuedAt,
    expiresAt: att.expiresAt,
    revocable: att.revocable,
    nonce: att.nonce,
    uid: att.uid,
  });
  return new TextEncoder().encode(canonical);
}

/**
 * Hash of the canonical attestation encoding — the 32-byte digest that
 * passes through `secp256k1.sign` / `secp256k1.verify`.
 */
export function canonicalAttestationHash(att: Attestation): Uint8Array {
  return sha256(canonicalAttestationBytes(att));
}

/**
 * Deterministic bytes for a {@link Presentation} that the holder signs.
 *
 * Binds the challenge, nonce, and UID list so the signed bundle cannot
 * be replayed against a different request.
 */
export function canonicalPresentationBytes(
  request: PresentationRequest,
  pres: Omit<Presentation, "signature">
): Uint8Array {
  const canonical = canonicalJson({
    challenge: request.challenge,
    credentialUids: pres.credentials.map((c) => c.attestation.uid).sort(),
    nonce: pres.nonce,
    presentedAt: pres.presentedAt,
    requesterId: request.requesterId,
  });
  return new TextEncoder().encode(canonical);
}

/**
 * 32-byte digest used as the message hash when signing / verifying a
 * presentation.
 */
export function canonicalPresentationHash(
  request: PresentationRequest,
  pres: Omit<Presentation, "signature">
): Uint8Array {
  return sha256(canonicalPresentationBytes(request, pres));
}
