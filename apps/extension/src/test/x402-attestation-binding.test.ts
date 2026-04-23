/**
 * Property + unit tests for the x402 TEE-attestation binding layer.
 *
 * The binding is the differentiating moat piece — if it breaks
 * silently, an attacker can staple a valid TEE quote from any agent
 * onto a signed payment from a different agent and pass verification.
 * These tests pin the invariants that make that attack impossible.
 *
 * We run them in the extension's vitest suite because the extension
 * workspace is where all shared-package tests live; x402 itself
 * doesn't ship its own test runner config.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { TeeQuote } from "@aethelred/wallet-compliance";
import {
  canonicalQuoteBytes,
  computeBindingHash,
  decodeAttestationHeader,
  encodeAttestationHeader,
  verifyBindingHash,
  X402Error,
} from "@aethelred/wallet-x402";

function baselineQuote(overrides: Partial<TeeQuote> = {}): TeeQuote {
  return {
    platform: "aws-nitro",
    version: "4",
    quote: ("0x" + "de".repeat(32)) as `0x${string}`,
    nonce: ("0x" + "cd".repeat(32)) as `0x${string}`,
    generatedAt: 1_700_000_000,
    measurements: {
      codeHash: ("0x" + "ef".repeat(32)) as `0x${string}`,
      configHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
      platformSecurityVersion: "2.0.0",
    },
    ...overrides,
  };
}

const SAMPLE_STRUCT_HASH =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`;

describe("attestation binding — determinism", () => {
  it("produces the same hash for the same (struct, quote) pair", () => {
    const quote = baselineQuote();
    const a = computeBindingHash(SAMPLE_STRUCT_HASH, quote);
    const b = computeBindingHash(SAMPLE_STRUCT_HASH, quote);
    expect(a).toBe(b);
  });

  it("is order-independent over JSON key permutations of the quote", () => {
    // This is the canonical-JSON property: two semantically identical
    // quotes with different key order must hash to the same bindingHash.
    const quote = baselineQuote();
    const reordered: TeeQuote = {
      nonce: quote.nonce,
      platform: quote.platform,
      generatedAt: quote.generatedAt,
      quote: quote.quote,
      version: quote.version,
      measurements: quote.measurements,
    };
    const a = computeBindingHash(SAMPLE_STRUCT_HASH, quote);
    const b = computeBindingHash(SAMPLE_STRUCT_HASH, reordered);
    expect(a).toBe(b);
  });

  it("changes when the struct hash changes (payment-bound)", () => {
    const quote = baselineQuote();
    const a = computeBindingHash(SAMPLE_STRUCT_HASH, quote);
    const other = ("0x" + "ff".repeat(32)) as `0x${string}`;
    const b = computeBindingHash(other, quote);
    expect(a).not.toBe(b);
  });

  it("changes when any byte of the quote changes (quote-bound)", () => {
    const base = computeBindingHash(SAMPLE_STRUCT_HASH, baselineQuote());
    const drifted = computeBindingHash(
      SAMPLE_STRUCT_HASH,
      baselineQuote({ nonce: ("0x" + "ee".repeat(32)) as `0x${string}` }),
    );
    expect(base).not.toBe(drifted);
  });
});

describe("attestation binding — structural guards", () => {
  it("rejects malformed struct hash", () => {
    expect(() =>
      computeBindingHash("0xshort" as `0x${string}`, baselineQuote()),
    ).toThrow(X402Error);
  });

  it("rejects quote containing undefined via canonical JSON", () => {
    const bogusQuote = { platform: undefined } as unknown as TeeQuote;
    expect(() => canonicalQuoteBytes(bogusQuote)).toThrow(X402Error);
  });
});

describe("attestation binding — verification", () => {
  it("verifyBindingHash returns true for the computed hash", () => {
    const quote = baselineQuote();
    const bindingHash = computeBindingHash(SAMPLE_STRUCT_HASH, quote);
    expect(
      verifyBindingHash({
        structHash: SAMPLE_STRUCT_HASH,
        quote,
        claimedBindingHash: bindingHash,
      }),
    ).toBe(true);
  });

  it("verifyBindingHash rejects a swapped quote", () => {
    const quote = baselineQuote();
    const bindingHash = computeBindingHash(SAMPLE_STRUCT_HASH, quote);
    const swappedQuote = baselineQuote({ nonce: ("0x" + "11".repeat(32)) as `0x${string}` });
    expect(
      verifyBindingHash({
        structHash: SAMPLE_STRUCT_HASH,
        quote: swappedQuote,
        claimedBindingHash: bindingHash,
      }),
    ).toBe(false);
  });

  it("verifyBindingHash rejects a swapped struct hash", () => {
    const quote = baselineQuote();
    const bindingHash = computeBindingHash(SAMPLE_STRUCT_HASH, quote);
    const other = ("0x" + "ff".repeat(32)) as `0x${string}`;
    expect(
      verifyBindingHash({
        structHash: other,
        quote,
        claimedBindingHash: bindingHash,
      }),
    ).toBe(false);
  });

  it("verifyBindingHash rejects a length-mismatched claim", () => {
    const quote = baselineQuote();
    expect(
      verifyBindingHash({
        structHash: SAMPLE_STRUCT_HASH,
        quote,
        claimedBindingHash: "0xdeadbeef" as `0x${string}`,
      }),
    ).toBe(false);
  });
});

describe("attestation binding — header round-trip", () => {
  it("encode → decode preserves the payload exactly", () => {
    const quote = baselineQuote();
    const bindingHash = computeBindingHash(SAMPLE_STRUCT_HASH, quote);
    const header = encodeAttestationHeader({
      x402Version: 1,
      quote,
      bindingHash,
    });
    const decoded = decodeAttestationHeader(header);
    expect(decoded.x402Version).toBe(1);
    expect(decoded.bindingHash).toBe(bindingHash);
    expect(decoded.quote.platform).toBe("aws-nitro");
  });

  it("decodeAttestationHeader throws on bad base64", () => {
    expect(() => decodeAttestationHeader("not base64 !!!")).toThrow(X402Error);
  });

  it("decodeAttestationHeader throws on JSON without x402Version=1", () => {
    const bad = btoa(JSON.stringify({ x402Version: 2, quote: {}, bindingHash: "0x00" }));
    expect(() => decodeAttestationHeader(bad)).toThrow(X402Error);
  });
});

/* ─── Property-based tests ──────────────────────────────────── */

describe("attestation binding — property tests", () => {
  const hexByte = fc.integer({ min: 0, max: 255 }).map((n) => n.toString(16).padStart(2, "0"));
  const structHashArb = fc
    .array(hexByte, { minLength: 32, maxLength: 32 })
    .map((bytes) => ("0x" + bytes.join("")) as `0x${string}`);

  it("binding hash is a 32-byte 0x-prefixed hex for any valid input", () => {
    fc.assert(
      fc.property(structHashArb, (structHash) => {
        const h = computeBindingHash(structHash, baselineQuote());
        expect(/^0x[0-9a-f]{64}$/.test(h)).toBe(true);
      }),
      { numRuns: 64 },
    );
  });

  it("two distinct struct hashes never produce the same binding for a fixed quote", () => {
    fc.assert(
      fc.property(structHashArb, structHashArb, (a, b) => {
        if (a === b) return; // skip collisions
        const quote = baselineQuote();
        expect(computeBindingHash(a, quote)).not.toBe(computeBindingHash(b, quote));
      }),
      { numRuns: 64 },
    );
  });

  it("encode then decode round-trips for any valid payload", () => {
    fc.assert(
      fc.property(structHashArb, (structHash) => {
        const quote = baselineQuote();
        const bindingHash = computeBindingHash(structHash, quote);
        const header = encodeAttestationHeader({
          x402Version: 1,
          quote,
          bindingHash,
        });
        const decoded = decodeAttestationHeader(header);
        expect(decoded.bindingHash).toBe(bindingHash);
      }),
      { numRuns: 32 },
    );
  });
});
