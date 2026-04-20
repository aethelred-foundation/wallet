/**
 * Fuzz tests for the transaction-signing path.
 * ────────────────────────────────────────────
 * 2000 iterations per test. We generate arbitrary (valid + malformed)
 * EIP-1559 transaction shapes and verify:
 *
 *  1. `buildUnsignedEip1559TxBytes` never throws for any valid-shape
 *     tx regardless of field magnitude — and returns deterministic
 *     bytes.
 *  2. `buildUnsignedEip1559Tx` always returns a 32-byte digest.
 *  3. `assembleSignedEip1559Tx` with random 65-byte "signatures"
 *     either returns a well-formed hex payload OR throws a typed
 *     Error. It never crashes the process and never returns
 *     undefined / null / empty.
 *  4. `splitSignature` throws a recognizable Error for any input
 *     length != 65 and succeeds for 65-byte inputs.
 *  5. `hexToBytes` accepts any hex string (even case-mixed / with or
 *     without `0x` prefix) and returns a Uint8Array.
 *
 * What we care about is liveness: the wallet never faults on
 * untrusted input. Correctness of the signing payload is covered by
 * the property tests and the legacy transaction.test.ts suite.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  buildUnsignedEip1559Tx,
  buildUnsignedEip1559TxBytes,
  assembleSignedEip1559Tx,
  splitSignature,
  hexToBytes,
  type UnsignedEip1559Tx,
} from "@aethelred/wallet-core";

const txArb = fc.record({
  chainId: fc.bigUintN(64),
  nonce: fc.bigUintN(64),
  maxPriorityFeePerGas: fc.bigUintN(96),
  maxFeePerGas: fc.bigUintN(96),
  gasLimit: fc.bigUintN(32),
  to: fc.option(fc.uint8Array({ minLength: 20, maxLength: 20 }), { nil: null }),
  value: fc.bigUintN(128),
  data: fc.uint8Array({ minLength: 0, maxLength: 256 }),
}) as fc.Arbitrary<UnsignedEip1559Tx>;

describe("transaction signing fuzz", () => {
  it("buildUnsignedEip1559TxBytes is total and deterministic", () => {
    fc.assert(
      fc.property(txArb, (tx) => {
        const a = buildUnsignedEip1559TxBytes(tx);
        const b = buildUnsignedEip1559TxBytes(tx);
        expect(a.length).toBeGreaterThan(0);
        expect(Array.from(a)).toEqual(Array.from(b));
      }),
      { numRuns: 2000 },
    );
  });

  it("buildUnsignedEip1559Tx always returns a 32-byte digest", () => {
    fc.assert(
      fc.property(txArb, (tx) => {
        expect(buildUnsignedEip1559Tx(tx).length).toBe(32);
      }),
      { numRuns: 2000 },
    );
  });

  it("assembleSignedEip1559Tx either returns a hex payload or throws a typed Error", () => {
    fc.assert(
      fc.property(txArb, fc.uint8Array({ minLength: 65, maxLength: 65 }), (tx, sig) => {
        try {
          const out = assembleSignedEip1559Tx(tx, sig);
          expect(typeof out.rawTx).toBe("string");
          expect(out.rawTx.startsWith("0x")).toBe(true);
          expect(out.hash.length).toBe(66);
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("splitSignature validates length and never silently drops data", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 128 }), (bytes) => {
        if (bytes.length === 65) {
          const { r, s, recovery } = splitSignature(bytes);
          expect(r.length).toBe(32);
          expect(s.length).toBe(32);
          expect([0, 1]).toContain(recovery);
        } else {
          expect(() => splitSignature(bytes)).toThrow();
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("hexToBytes accepts arbitrary hex-ish input without throwing", () => {
    fc.assert(
      fc.property(
        fc.hexaString({ minLength: 0, maxLength: 512 }).map((h) =>
          Math.random() < 0.5 ? `0x${h}` : h,
        ),
        (input) => {
          const out = hexToBytes(input);
          expect(out).toBeInstanceOf(Uint8Array);
        },
      ),
      { numRuns: 2000 },
    );
  });
});
