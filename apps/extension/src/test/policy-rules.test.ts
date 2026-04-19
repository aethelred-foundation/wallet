/**
 * Policy engine rule tests.
 *
 * Proves that the spend-limit, velocity, and destination-allowlist
 * rules actually fire against a populated PolicyContext — something
 * the previous hardcoded bundles couldn't do because the
 * context-builder never populated `amount`/`destination`/`amountUsd`.
 *
 * Also tests the VelocityTracker's sliding-window semantics end-to-end
 * (record → getVelocity → prune → record → reread).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluate,
  personalPolicyBundle,
  enterprisePolicyBundle,
  VelocityTracker,
  type PolicyContext,
  type VelocityStorageAdapter,
} from "@aethelred/wallet-policy";

/** Build a minimal PolicyContext for a sign-transaction intent. */
function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    subject: { id: "subj-1", role: "owner" },
    workspace: { id: "ws-1", kind: "personal" },
    app: { id: "app-1", origin: "https://example.com", trustLevel: "unverified" },
    intent: { kind: "sign-transaction", method: "eth_sendTransaction" },
    session: { exists: true },
    account: { id: "acc-1", address: "0x1234", namespace: "eip155" },
    ...overrides,
  };
}

/* ─── Spend-limit rule tests ─────────────────────────────────── */

describe("Personal bundle — spend limits", () => {
  it("fires warn when amountUsd > $10,000", () => {
    const result = evaluate(
      ctx({ amountUsd: 15_000 }),
      personalPolicyBundle,
    );
    expect(result.matchedRules.some((r) => r.id === "personal-spend-per-tx-limit")).toBe(true);
    expect(result.warnings.some((w) => w.includes("10,000"))).toBe(true);
  });

  it("does NOT fire spend-limit when amountUsd is under threshold", () => {
    const result = evaluate(
      ctx({ amountUsd: 5_000 }),
      personalPolicyBundle,
    );
    expect(result.matchedRules.some((r) => r.id === "personal-spend-per-tx-limit")).toBe(false);
  });

  it("does NOT fire spend-limit when amountUsd is undefined", () => {
    const result = evaluate(ctx(), personalPolicyBundle);
    expect(result.matchedRules.some((r) => r.id === "personal-spend-per-tx-limit")).toBe(false);
  });
});

describe("Enterprise bundle — dual-control over $100k", () => {
  it("requires approval when amountUsd > $100,000", () => {
    const result = evaluate(
      ctx({
        workspace: { id: "ws-1", kind: "enterprise" },
        amountUsd: 250_000,
        app: { id: "app-1", origin: "https://example.com", trustLevel: "first-party" },
      }),
      enterprisePolicyBundle,
    );
    expect(result.outcome).toBe("approval-required");
    expect(result.matchedRules.some((r) => r.id === "enterprise-high-value-tx")).toBe(true);
  });

  it("allows below threshold (still goes through approval for enterprise)", () => {
    const result = evaluate(
      ctx({
        workspace: { id: "ws-1", kind: "enterprise" },
        amountUsd: 5_000,
        app: { id: "app-1", origin: "https://example.com", trustLevel: "first-party" },
      }),
      enterprisePolicyBundle,
    );
    // Enterprise's all-transactions rule still fires
    expect(result.outcome).toBe("approval-required");
    expect(result.matchedRules.some((r) => r.id === "enterprise-high-value-tx")).toBe(false);
  });
});

/* ─── Velocity rule tests ────────────────────────────────────── */

describe("Velocity rules", () => {
  it("personal: warns after 50 operations in 24h", () => {
    const result = evaluate(
      ctx({ requestedOperationCount24h: 51 }),
      personalPolicyBundle,
    );
    expect(result.matchedRules.some((r) => r.id === "personal-velocity-count")).toBe(true);
  });

  it("personal: warns after $50k cumulative in 24h", () => {
    const result = evaluate(
      ctx({ cumulativeValueSpentUsd24h: 60_000 }),
      personalPolicyBundle,
    );
    expect(result.matchedRules.some((r) => r.id === "personal-velocity-value")).toBe(true);
  });

  it("enterprise: denies at 201 operations in 24h", () => {
    const result = evaluate(
      ctx({
        workspace: { id: "ws-1", kind: "enterprise" },
        requestedOperationCount24h: 201,
        app: { id: "app-1", origin: "https://example.com", trustLevel: "first-party" },
      }),
      enterprisePolicyBundle,
    );
    expect(result.outcome).toBe("deny");
    expect(result.matchedRules.some((r) => r.id === "enterprise-velocity-count-deny")).toBe(true);
  });
});

/* ─── Destination allowlist tests ────────────────────────────── */

describe("Destination rules", () => {
  it("personal: warns on unknown destination + value", () => {
    const result = evaluate(
      ctx({ destinationCategory: "unknown", amountUsd: 500 }),
      personalPolicyBundle,
    );
    expect(result.matchedRules.some((r) => r.id === "personal-destination-unknown")).toBe(true);
  });

  it("personal: does NOT warn on unknown destination with trivial value", () => {
    const result = evaluate(
      ctx({ destinationCategory: "unknown", amountUsd: 50 }),
      personalPolicyBundle,
    );
    expect(result.matchedRules.some((r) => r.id === "personal-destination-unknown")).toBe(false);
  });

  it("personal: DENIES blacklisted destination regardless of amount", () => {
    const result = evaluate(
      ctx({ destinationCategory: "blacklisted", amountUsd: 10 }),
      personalPolicyBundle,
    );
    expect(result.outcome).toBe("deny");
    expect(result.matchedRules.some((r) => r.id === "personal-destination-blacklisted")).toBe(true);
  });
});

/* ─── VelocityTracker tests ──────────────────────────────────── */

describe("VelocityTracker — sliding window", () => {
  let storage: VelocityStorageAdapter;
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    storage = {
      async get(key) { return store[key] ?? null; },
      async set(key, value) { store[key] = value; },
      async delete(key) { delete store[key]; },
    };
  });

  it("starts with zero velocity", async () => {
    const tracker = new VelocityTracker(storage);
    const stats = await tracker.getVelocity("subj-1");
    expect(stats.count24h).toBe(0);
    expect(stats.valueUsd24h).toBe(0);
  });

  it("records operations and aggregates by subject", async () => {
    const tracker = new VelocityTracker(storage);
    await tracker.recordOperation({ recordId: "op-1", subjectId: "subj-1", amountUsd: 100, assetSymbol: "USDC" });
    await tracker.recordOperation({ recordId: "op-2", subjectId: "subj-1", amountUsd: 200, assetSymbol: "USDC" });
    await tracker.recordOperation({ recordId: "op-3", subjectId: "subj-2", amountUsd: 99, assetSymbol: "USDC" });

    const s1 = await tracker.getVelocity("subj-1");
    expect(s1.count24h).toBe(2);
    expect(s1.valueUsd24h).toBe(300);

    const s2 = await tracker.getVelocity("subj-2");
    expect(s2.count24h).toBe(1);
    expect(s2.valueUsd24h).toBe(99);
  });

  it("dedupes by recordId (idempotent record)", async () => {
    const tracker = new VelocityTracker(storage);
    await tracker.recordOperation({ recordId: "op-1", subjectId: "subj-1", amountUsd: 100, assetSymbol: "USDC" });
    await tracker.recordOperation({ recordId: "op-1", subjectId: "subj-1", amountUsd: 100, assetSymbol: "USDC" });
    await tracker.recordOperation({ recordId: "op-1", subjectId: "subj-1", amountUsd: 100, assetSymbol: "USDC" });

    const stats = await tracker.getVelocity("subj-1");
    expect(stats.count24h).toBe(1);
  });

  it("prunes entries older than the window", async () => {
    const tracker = new VelocityTracker(storage, { windowMs: 1000 });
    const now = Date.now();
    // Record one entry 5 seconds in the past (outside the 1s window)
    await tracker.recordOperation({
      recordId: "old",
      subjectId: "subj-1",
      amountUsd: 100,
      assetSymbol: "USDC",
      timestamp: now - 5000,
    });
    // And one fresh
    await tracker.recordOperation({ recordId: "new", subjectId: "subj-1", amountUsd: 50, assetSymbol: "USDC" });

    const stats = await tracker.getVelocity("subj-1");
    // Only the fresh record should survive the prune
    expect(stats.count24h).toBe(1);
    expect(stats.valueUsd24h).toBe(50);
  });

  it("persists across new tracker instances (via storage)", async () => {
    const tracker1 = new VelocityTracker(storage);
    await tracker1.recordOperation({ recordId: "op-1", subjectId: "subj-1", amountUsd: 100, assetSymbol: "USDC" });

    // New tracker instance reading from the same storage
    const tracker2 = new VelocityTracker(storage);
    const stats = await tracker2.getVelocity("subj-1");
    expect(stats.count24h).toBe(1);
    expect(stats.valueUsd24h).toBe(100);
  });
});
