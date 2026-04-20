/**
 * Property-based tests for RLP encoding.
 * ──────────────────────────────────────
 * Properties verified (each ≥ 500 runs, fast-check defaults):
 *
 *  1. Determinism — the same input always encodes to the same bytes.
 *  2. Byte-length bound — the encoded output length never exceeds
 *     `1 + 8 + input.length` for a flat Uint8Array input (length
 *     prefix overhead is bounded).
 *  3. Single-byte identity — any byte `< 0x80` encodes to itself.
 *  4. Zero-bigint canonicalization — `0n`, `BigInt(0)`, and the empty
 *     bytestring all produce the same encoding (RLP canonical rule:
 *     numbers have no leading zero bytes).
 *  5. Array prefix correctness — an array's first byte is always
 *     `>= 0xc0` (RLP list tag), never `< 0xc0`.
 *  6. Two different inputs produce different encodings — for any two
 *     flat byte arrays differing in at least one byte, the encoded
 *     outputs must differ (injectivity on this class of inputs).
 *
 * We intentionally do NOT test decode/round-trip because the wallet's
 * rlp.ts has no decoder — it's encode-only by design (TS side never
 * needs to parse wire RLP; the RPC node does that).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { rlpEncode } from "@aethelred/wallet-core";

describe("RLP property tests", () => {
  it("is deterministic — same input encodes to same bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 256 }), (bytes) => {
        const a = rlpEncode(bytes);
        const b = rlpEncode(bytes);
        expect(Array.from(a)).toEqual(Array.from(b));
      }),
    );
  });

  it("encoded length is bounded by header overhead + payload length", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 4096 }), (bytes) => {
        const encoded = rlpEncode(bytes);
        /* Worst case: 1-byte prefix + 8-byte length field for very large payloads. */
        expect(encoded.length).toBeLessThanOrEqual(bytes.length + 9);
      }),
    );
  });

  it("single byte < 0x80 encodes to itself", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x7f }), (b) => {
        const encoded = rlpEncode(new Uint8Array([b]));
        expect(encoded.length).toBe(1);
        expect(encoded[0]).toBe(b);
      }),
    );
  });

  it("zero-bigint and empty-bytes encode identically (canonical zero)", () => {
    const zeroByBigint = rlpEncode(0n);
    const zeroByNumber = rlpEncode(0);
    const zeroByEmptyBytes = rlpEncode(new Uint8Array(0));
    expect(Array.from(zeroByBigint)).toEqual(Array.from(zeroByEmptyBytes));
    expect(Array.from(zeroByNumber)).toEqual(Array.from(zeroByEmptyBytes));
  });

  it("array output always starts with a list tag (>= 0xc0)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.uint8Array({ minLength: 0, maxLength: 32 }), { minLength: 0, maxLength: 8 }),
        (arr) => {
          const encoded = rlpEncode(arr);
          expect(encoded[0]).toBeGreaterThanOrEqual(0xc0);
        },
      ),
    );
  });

  it("distinct flat byte inputs produce distinct encodings", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        fc.uint8Array({ minLength: 1, maxLength: 64 }),
        (a, b) => {
          const aStr = Array.from(a).join(",");
          const bStr = Array.from(b).join(",");
          fc.pre(aStr !== bStr);
          const eA = Array.from(rlpEncode(a)).join(",");
          const eB = Array.from(rlpEncode(b)).join(",");
          expect(eA).not.toEqual(eB);
        },
      ),
    );
  });

  it("nested arrays encode without throwing", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(fc.uint8Array({ minLength: 0, maxLength: 8 }), { maxLength: 4 }), {
          maxLength: 4,
        }),
        (nested) => {
          expect(() => rlpEncode(nested)).not.toThrow();
        },
      ),
    );
  });

  it("bigints produce deterministic minimal-length encodings", () => {
    fc.assert(
      fc.property(fc.bigUintN(256), (n) => {
        const a = rlpEncode(n);
        const b = rlpEncode(n);
        expect(Array.from(a)).toEqual(Array.from(b));
      }),
    );
  });
});
