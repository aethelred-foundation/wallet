/**
 * Tests for the live on-chain screening circuit breaker. A fake provider
 * returns configurable risk scores (or throws) so we exercise the decision
 * thresholds, the fail-closed/fail-open posture, caching, and the
 * block-on-sign guard — without a real Chainalysis/TRM/Elliptic backend.
 */

import { describe, it, expect, vi } from "vitest";
import {
  LiveScreeningGate,
  NoopScreeningProvider,
  ScreeningBlockedError,
  type ScreeningProvider,
  type AddressRiskScore,
} from "@aethelred/wallet-compliance";

const ADDR = "0xAbC0000000000000000000000000000000001234";

function providerReturning(score: number, categories: string[] = []): { provider: ScreeningProvider; calls: () => number } {
  const fn = vi.fn(async (address: `0x${string}`): Promise<AddressRiskScore> => ({
    address,
    riskScore: score,
    severity: score >= 75 ? "severe" : score >= 40 ? "high" : "low",
    categories,
    provider: "fake",
    screenedAt: Date.now(),
  }));
  return { provider: { name: "fake", screenAddress: fn }, calls: () => fn.mock.calls.length };
}

function providerThrowing(): ScreeningProvider {
  return { name: "broken", screenAddress: async () => { throw new Error("upstream 503"); } };
}

describe("decision thresholds", () => {
  it("allows below the review threshold", async () => {
    const gate = new LiveScreeningGate(providerReturning(10).provider);
    expect((await gate.evaluate(ADDR)).decision).toBe("allow");
  });

  it("flags for review in the mid band", async () => {
    const gate = new LiveScreeningGate(providerReturning(50).provider);
    const out = await gate.evaluate(ADDR);
    expect(out.decision).toBe("review");
    expect(out.score?.riskScore).toBe(50);
  });

  it("blocks at or above the block threshold", async () => {
    const gate = new LiveScreeningGate(providerReturning(90, ["sanctions"]).provider);
    const out = await gate.evaluate(ADDR);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/sanctions/);
  });
});

describe("assertAllowed (signing circuit breaker)", () => {
  it("throws ScreeningBlockedError when blocked", async () => {
    const gate = new LiveScreeningGate(providerReturning(99).provider);
    await expect(gate.assertAllowed(ADDR)).rejects.toBeInstanceOf(ScreeningBlockedError);
  });

  it("returns the outcome when allowed or review", async () => {
    const gate = new LiveScreeningGate(providerReturning(50).provider);
    const out = await gate.assertAllowed(ADDR);
    expect(out.decision).toBe("review");
  });
});

describe("provider-error posture", () => {
  it("fails closed (block) by default", async () => {
    const gate = new LiveScreeningGate(providerThrowing());
    const out = await gate.evaluate(ADDR);
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/provider error/);
    await expect(gate.assertAllowed(ADDR)).rejects.toBeInstanceOf(ScreeningBlockedError);
  });

  it("can fail open (review) when configured", async () => {
    const gate = new LiveScreeningGate(providerThrowing(), { onError: "review" });
    expect((await gate.evaluate(ADDR)).decision).toBe("review");
  });
});

describe("caching", () => {
  it("caches a successful score and re-screens after clearCache", async () => {
    const { provider, calls } = providerReturning(10);
    const gate = new LiveScreeningGate(provider);
    await gate.evaluate(ADDR);
    await gate.evaluate(ADDR);
    expect(calls()).toBe(1); // second call served from cache
    gate.clearCache();
    await gate.evaluate(ADDR);
    expect(calls()).toBe(2);
  });

  it("does not cache when ttl is 0", async () => {
    const { provider, calls } = providerReturning(10);
    const gate = new LiveScreeningGate(provider, { cacheTtlMs: 0 });
    await gate.evaluate(ADDR);
    await gate.evaluate(ADDR);
    expect(calls()).toBe(2);
  });
});

describe("validation + defaults", () => {
  it("rejects an inverted threshold config", () => {
    expect(() => new LiveScreeningGate(providerReturning(0).provider, { reviewThreshold: 80, blockThreshold: 75 })).toThrow(/reviewThreshold/);
  });

  it("rejects malformed addresses", async () => {
    const gate = new LiveScreeningGate(providerReturning(0).provider);
    await expect(gate.evaluate("0xdead")).rejects.toThrow(/invalid address/);
  });

  it("NoopScreeningProvider returns a benign allow", async () => {
    const gate = new LiveScreeningGate(new NoopScreeningProvider());
    const out = await gate.evaluate(ADDR);
    expect(out.decision).toBe("allow");
    expect(out.score?.provider).toBe("noop");
  });
});
