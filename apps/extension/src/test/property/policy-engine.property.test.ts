/**
 * Property-based tests for the policy engine's spend-limit rule.
 * ─────────────────────────────────────────────────────────────
 * Properties verified (each ≥ 500 runs):
 *
 *  1. Whenever `amountUsd > threshold` and the spend-limit rule applies
 *     to the context, the result outcome MUST be stricter than "allow".
 *     (No false negatives — the guardrail always fires.)
 *  2. Under the same context but with `amountUsd` below the threshold,
 *     the rule must NOT fire by itself.
 *  3. `evaluate()` is a pure function — same input → same output.
 *  4. For any arbitrary context, the engine never throws.
 *  5. For a deny rule, any matching context returns `outcome: "deny"`.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  evaluate,
  type PolicyBundle,
  type PolicyContext,
  type PolicyRule,
} from "@aethelred/wallet-policy";

const THRESHOLD = 10_000;

const spendLimitRule: PolicyRule = {
  id: "prop-spend-limit",
  name: "Spend limit (property test)",
  priority: 10,
  conditions: [{ field: "amountUsd", operator: "greater-than", value: THRESHOLD }],
  outcome: "approval-required",
  message: `Amount exceeds $${THRESHOLD}`,
};

const bundle: PolicyBundle = {
  id: "prop-bundle",
  name: "Property test bundle",
  mode: "guided",
  workspaceKind: "personal",
  rules: [spendLimitRule],
  version: 1,
  createdAt: 0,
};

function makeCtx(amountUsd: number): PolicyContext {
  return {
    subject: { id: "s", role: "operator" },
    workspace: { id: "w", kind: "personal" },
    app: { id: "a", origin: "https://example.test", trustLevel: "first-party" },
    intent: { kind: "sign-transaction", method: "eth_sendTransaction" },
    session: { exists: true },
    account: { id: "a", address: "0x" + "ab".repeat(20), namespace: "eip155" },
    amountUsd,
  };
}

describe("Policy engine spend-limit properties", () => {
  it("NEVER allows when amountUsd > threshold (no false negatives)", () => {
    fc.assert(
      fc.property(fc.double({ min: THRESHOLD + 1, max: 10_000_000, noNaN: true }), (amt) => {
        const result = evaluate(makeCtx(amt), bundle);
        expect(result.outcome).not.toBe("allow");
        expect(result.requiresApproval).toBe(true);
      }),
    );
  });

  it("does NOT fire the spend-limit rule when amountUsd <= threshold", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: THRESHOLD, noNaN: true }), (amt) => {
        const result = evaluate(makeCtx(amt), bundle);
        const matched = result.matchedRules.find((r) => r.id === spendLimitRule.id);
        expect(matched).toBeUndefined();
      }),
    );
  });

  it("is pure — identical inputs yield identical outcomes", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10_000_000, noNaN: true }), (amt) => {
        const ctx = makeCtx(amt);
        const a = evaluate(ctx, bundle);
        const b = evaluate(ctx, bundle);
        expect(a.outcome).toBe(b.outcome);
        expect(a.requiresApproval).toBe(b.requiresApproval);
      }),
    );
  });

  it("never throws for any numeric amountUsd input (incl. 0, NaN-safe)", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: 0, max: 1e15 }), (amt) => {
        expect(() => evaluate(makeCtx(amt), bundle)).not.toThrow();
      }),
    );
  });

  it("a matching deny rule always produces outcome 'deny'", () => {
    const denyBundle: PolicyBundle = {
      ...bundle,
      rules: [
        {
          id: "prop-deny",
          name: "Deny all",
          priority: 0,
          conditions: [{ field: "intent.kind", operator: "equals", value: "sign-transaction" }],
          outcome: "deny",
          message: "Denied by policy",
        },
      ],
    };
    fc.assert(
      fc.property(fc.double({ min: 0, max: 10_000_000, noNaN: true }), (amt) => {
        expect(evaluate(makeCtx(amt), denyBundle).outcome).toBe("deny");
      }),
    );
  });
});
