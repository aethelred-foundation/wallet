/**
 * TEE-attestation binding layer for x402.
 *
 * This is the moat. Vanilla x402 proves *a wallet holds funds + signed
 * consent*. Our extension proves *the payment was authored by an agent
 * running approved code inside approved silicon*, and proves it *in a
 * way that cannot be separated from the payment itself*.
 *
 * The wire protocol is backwards-compatible — a receiver that doesn't
 * care about attestation ignores the `X-PAYMENT-ATTESTATION` header,
 * and an attestation-requiring receiver rejects requests that omit
 * it with a standard 402 carrying an `AttestationRequirement` block
 * in its accepts list.
 *
 * The binding primitive is:
 *
 *     bindingHash = sha256( structHash || sha256(canonicalQuoteBytes) )
 *
 * where `structHash` is the EIP-712 struct hash of the payment
 * authorization (recomputable from the signed data) and
 * `canonicalQuoteBytes` is the JSON-canonical serialization of the
 * TEE quote. Including both means:
 *
 *   a) A MITM cannot swap in a different agent's valid quote — the
 *      binding would change because `structHash` ties the quote to
 *      *this exact payment*.
 *   b) A compromised signer cannot pair a valid quote with a
 *      different payment — the binding would change because
 *      `canonicalQuoteBytes` ties the payment to *this exact
 *      attestation round*.
 *
 * The receiver recomputes `bindingHash` from the payment + quote
 * it observes and rejects if they don't match. This is the
 * "cannot be separated" property.
 *
 * Why sha256 (not keccak256)? Attestation is a TEE-side contract
 * and TEE SDKs (Intel DCAP, AMD SEV, Nitro) all expose sha256 as
 * a primitive; keccak256 would require embedding a non-standard
 * hasher in every platform verifier we support. The payment
 * struct hash remains keccak256 because that's EIP-712's contract;
 * we chain between algorithms deliberately.
 *
 * Canonical JSON serialization rules (must match
 * `@aethelred/wallet-credentials/canonical.ts` — same RFC 8785
 * JSON Canonicalization Scheme):
 *
 *   - Object keys sorted lexicographically.
 *   - No insignificant whitespace.
 *   - UTF-8 bytes, NFC-normalized.
 *   - Numbers serialized with shortest round-tripping decimal.
 *
 * This ensures the same quote object hashes to the same bytes
 * across runtimes (V8, SpiderMonkey, JavaScriptCore, Bun).
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { TeeQuote } from "@aethelred/wallet-compliance";

import type { PaymentAttestationPayload } from "./types";
import { X402Error } from "./errors";

/**
 * Build the canonical JSON-encoded bytes of a `TeeQuote`, suitable
 * for hashing. The canonicalization is deterministic: for any two
 * quotes with semantically identical values, this function
 * returns byte-identical output, regardless of input object
 * key ordering.
 *
 * Pure; synchronous; no allocations beyond the returned Uint8Array.
 */
export function canonicalQuoteBytes(quote: TeeQuote): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson(quote));
}

/**
 * Compute the binding hash for a (payment, quote) pair.
 *
 * @param structHash The payment struct hash from
 *   `computeTransferAuthStructHash` — a `0x`-prefixed 32-byte hex.
 * @param quote      The TEE quote the client is attaching.
 * @returns          `0x`-prefixed 32-byte hex binding hash.
 */
export function computeBindingHash(
  structHash: `0x${string}`,
  quote: TeeQuote,
): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(structHash)) {
    throw new X402Error(
      "attestation-binding-failed",
      `structHash must be a 32-byte hex, got length ${structHash.length}`,
    );
  }

  const quoteBytes = canonicalQuoteBytes(quote);
  const quoteDigest = sha256(quoteBytes); // 32 bytes

  const combined = new Uint8Array(32 + 32);
  combined.set(hexToBytes(structHash), 0);
  combined.set(quoteDigest, 32);

  const binding = sha256(combined);
  return ("0x" + bytesToHex(binding)) as `0x${string}`;
}

/**
 * Pack the `X-PAYMENT-ATTESTATION` header value.
 *
 * Returns a base64-encoded JSON string. The caller sets it directly
 * as an HTTP header value; `atob` on the receiver side reverses.
 */
export function encodeAttestationHeader(payload: PaymentAttestationPayload): string {
  return base64Encode(new TextEncoder().encode(JSON.stringify(payload)));
}

/**
 * Parse an `X-PAYMENT-ATTESTATION` header back into the typed
 * struct. Throws on malformed input.
 *
 * Receivers MUST validate the binding hash against the
 * payment's struct hash after parsing — this function does NOT
 * do that because the caller may want to run other checks
 * (rate limits, replay cache) first.
 */
export function decodeAttestationHeader(raw: string): PaymentAttestationPayload {
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(base64Decode(raw));
  } catch (cause) {
    throw new X402Error(
      "attestation-binding-failed",
      "X-PAYMENT-ATTESTATION header is not valid base64",
      { cause },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch (cause) {
    throw new X402Error(
      "attestation-binding-failed",
      "X-PAYMENT-ATTESTATION header is not valid JSON",
      { cause },
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { x402Version?: unknown }).x402Version !== 1 ||
    typeof (parsed as { bindingHash?: unknown }).bindingHash !== "string"
  ) {
    throw new X402Error(
      "attestation-binding-failed",
      "X-PAYMENT-ATTESTATION does not match PaymentAttestationPayload shape",
      { details: { shape: typeof parsed } },
    );
  }

  return parsed as PaymentAttestationPayload;
}

/**
 * Verify that the quote + payment present in the headers were
 * generated together. Receivers MUST call this before accepting
 * the payment.
 *
 * Returns `true` if the binding holds; `false` otherwise. The
 * caller decides whether a mismatch is an audit-worthy event
 * (usually yes — mismatches are evidence of tampering).
 */
export function verifyBindingHash(input: {
  readonly structHash: `0x${string}`;
  readonly quote: TeeQuote;
  readonly claimedBindingHash: `0x${string}`;
}): boolean {
  const expected = computeBindingHash(input.structHash, input.quote);
  // Constant-time compare over hex; 64 hex chars + "0x" = 66 chars.
  if (expected.length !== input.claimedBindingHash.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ input.claimedBindingHash.charCodeAt(i);
  }
  return diff === 0;
}

// ─── Canonical JSON (RFC 8785 subset) ───────────────────────────

/**
 * Minimal RFC-8785-compliant JSON canonicalizer. Does NOT handle
 * BigInt, Symbol, Function, or undefined — `TeeQuote` is a pure
 * JSON-shaped type so these never appear. If a caller smuggles
 * one in, `JSON.stringify` returns `undefined` and we throw.
 */
function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // Primitives: delegate to stringify (handles strings,
    // numbers, booleans). Stringify on undefined/function is
    // implementation-defined so we guard.
    const s = JSON.stringify(value);
    if (s === undefined) {
      throw new X402Error(
        "attestation-binding-failed",
        "Non-canonicalizable value in quote (undefined/function/Symbol)",
      );
    }
    return s;
  }

  if (Array.isArray(value)) {
    return "[" + value.map(canonicalizeJson).join(",") + "]";
  }

  // Object: sort keys + recurse
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    return JSON.stringify(k) + ":" + canonicalizeJson((value as Record<string, unknown>)[k]);
  });
  return "{" + parts.join(",") + "}";
}

// ─── Base64 (no dependencies — works in Node + extension) ────────

function base64Encode(bytes: Uint8Array): string {
  // atob/btoa operate on latin-1; encode per byte directly.
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const stripped = hex.slice(2);
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
