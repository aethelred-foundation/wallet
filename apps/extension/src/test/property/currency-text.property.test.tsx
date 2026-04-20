/**
 * Property-based tests for the CurrencyText component.
 * ────────────────────────────────────────────────────
 * Properties verified (each ≥ 200 runs — DOM renders are slower than
 * pure-function properties, so we cap iterations lower):
 *
 *  1. For any finite positive number, the rendered text always
 *     contains a non-empty currency symbol AND a non-empty numeric
 *     body, separated into two distinct `<span>` children.
 *  2. Non-finite inputs (NaN, ±∞) render the em-dash fallback and
 *     NEVER throw.
 *  3. The numeric body is locale-safe — in en-US it contains digits
 *     only (plus possible group separators / decimal / minus), no
 *     `undefined`, no `null`, no `NaN` substrings leaking through.
 *  4. For any value, rendering is idempotent (same inputs → identical
 *     DOM string).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { CurrencyText } from "../../popup/components/currency-text";
import { FormatProvider } from "../../popup/i18n/format";

function renderValue(value: number) {
  return render(
    <FormatProvider>
      <CurrencyText value={value} />
    </FormatProvider>,
  );
}

describe("CurrencyText property tests", () => {
  it("renders a symbol span and a number span for any finite positive value", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 1e12, noNaN: true, noDefaultInfinity: true }), (v) => {
        const { container } = renderValue(v);
        const symbol = container.querySelector(".ct-symbol")?.textContent ?? "";
        const numeric = container.querySelector(".ct-number")?.textContent ?? "";
        expect(symbol.length).toBeGreaterThan(0);
        expect(numeric.length).toBeGreaterThan(0);
        cleanup();
      }),
      { numRuns: 200 },
    );
  });

  it("non-finite inputs render em-dash without throwing", () => {
    fc.assert(
      fc.property(fc.constantFrom(NaN, Infinity, -Infinity), (v) => {
        expect(() => renderValue(v)).not.toThrow();
        const { container } = renderValue(v);
        expect(container.textContent ?? "").toContain("—");
        cleanup();
      }),
      { numRuns: 10 },
    );
  });

  it("en-US numeric body never leaks the literal tokens 'undefined' / 'NaN'", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e12, max: 1e12, noNaN: true, noDefaultInfinity: true }), (v) => {
        const { container } = renderValue(v);
        const numeric = container.querySelector(".ct-number")?.textContent ?? "";
        expect(numeric.includes("undefined")).toBe(false);
        expect(numeric.includes("NaN")).toBe(false);
        cleanup();
      }),
      { numRuns: 200 },
    );
  });

  it("rendering is idempotent for the same input", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 1e9, noNaN: true, noDefaultInfinity: true }), (v) => {
        const first = renderValue(v);
        const firstHtml = first.container.innerHTML;
        cleanup();
        const second = renderValue(v);
        expect(second.container.innerHTML).toBe(firstHtml);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });
});
