/**
 * Balance math must come from raw base units — never from display strings.
 *
 * Regression: the send view computed spendable balance with
 * `parseFloat(token.balance)`, but `balance` is the HUMAN-READABLE string
 * from the balance fetcher, which locale-formats the whole part —
 * `parseFloat("100,000.0")` is 100, so any holder of ≥ 1,000 tokens was
 * blocked with "Insufficient balance" for sends above the comma-truncated
 * figure (caught live by policy-rejection.e2e.ts sending 99,999 from a
 * 100,000 balance). Stripping separators is not a fix — locales disagree
 * on what a comma means — so the view derives the number from
 * `rawBalance` via the same base-unit conversion the policy spending
 * context uses.
 */

import { describe, expect, it } from "vitest";
import { baseUnitsToAmount } from "../background/spending-context";

describe("baseUnitsToAmount", () => {
  it("converts the exact failing case: 100,000 tokens of 18 decimals", () => {
    const raw = 100_000n * 10n ** 18n; // 0x152d02c7e14af6800000
    expect(baseUnitsToAmount(raw, 18)).toBe(100_000);
    // The spend gate that failed: 99,999 must fit inside 100,000.
    expect(99_999).toBeLessThanOrEqual(baseUnitsToAmount(raw, 18));
  });

  it("keeps fractional precision to micro-units", () => {
    const raw = 1_234_567_890_000_000_000n; // 1.23456789 tokens
    expect(baseUnitsToAmount(raw, 18)).toBeCloseTo(1.234567, 6);
  });

  it("handles zero and small-decimal assets", () => {
    expect(baseUnitsToAmount(0n, 18)).toBe(0);
    expect(baseUnitsToAmount(1_500_000n, 6)).toBe(1.5);
  });

  it("documents why display strings are banned from math", () => {
    // en-US formatting of the same balance — parseFloat stops at the comma.
    expect(parseFloat("100,000.0")).toBe(100);
  });
});
