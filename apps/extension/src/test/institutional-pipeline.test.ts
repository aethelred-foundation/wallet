/**
 * Tests for the institutional pipeline factory — stage assembly from optional
 * deps, fail-closed default, and per-tier strictness (Sovereign escalates
 * review→block). Exercised end-to-end through real gates.
 */

import { describe, it, expect } from "vitest";
import {
  buildInstitutionalAuthorizationPipeline,
  LiveScreeningGate,
  BehavioralAnomalyEngine,
  TravelRuleInteropEngine,
  type ScreeningProvider,
  type AuthorizationContext,
} from "@aethelred/wallet-compliance";

const CTX: AuthorizationContext = {
  transactionId: "tx-1",
  destinationAddress: ("0x" + "11".repeat(20)) as `0x${string}`,
  amountUsd: 1000,
  tier: "sovereign",
  subjectId: "alice",
};

function provider(score: number): ScreeningProvider {
  return { name: "p", async screenAddress(address) { return { address, riskScore: score, severity: "low", categories: [], provider: "p", screenedAt: 0 }; } };
}
function throwingProvider(): ScreeningProvider {
  return { name: "p", async screenAddress() { throw new Error("vendor down"); } };
}

describe("stage assembly", () => {
  it("includes only the stages whose deps are provided", async () => {
    const pipeline = buildInstitutionalAuthorizationPipeline("enterprise", {
      screening: new LiveScreeningGate(provider(5)),
      policy: () => ({ outcome: "allow" }),
    });
    const r = await pipeline.authorize(CTX);
    expect(r.stages.map((s) => s.stage)).toEqual(["screening", "policy"]);
  });

  it("assembles the full chain in the recommended order", async () => {
    const pipeline = buildInstitutionalAuthorizationPipeline("enterprise", {
      screening: new LiveScreeningGate(provider(5)),
      anomaly: new BehavioralAnomalyEngine(),
      travelRule: { engine: new TravelRuleInteropEngine(), protocol: "trisa" },
      policy: () => ({ outcome: "allow" }),
    });
    const r = await pipeline.authorize(CTX);
    expect(r.stages.map((s) => s.stage)).toEqual(["screening", "behavioral-anomaly", "travel-rule", "policy"]);
  });

  it("throws when no dependency is provided", () => {
    expect(() => buildInstitutionalAuthorizationPipeline("personal", {})).toThrow(/at least one/);
  });
});

describe("institutional defaults", () => {
  it("is always fail-closed (a vendor outage blocks)", async () => {
    const pipeline = buildInstitutionalAuthorizationPipeline("enterprise", { screening: new LiveScreeningGate(throwingProvider()) });
    expect((await pipeline.authorize(CTX)).decision).toBe("block");
  });

  it("Sovereign escalates a review to a hard block", async () => {
    const sovereign = buildInstitutionalAuthorizationPipeline("sovereign", { screening: new LiveScreeningGate(provider(50)) });
    expect((await sovereign.authorize({ ...CTX, tier: "sovereign" })).decision).toBe("block");

    const enterprise = buildInstitutionalAuthorizationPipeline("enterprise", { screening: new LiveScreeningGate(provider(50)) });
    expect((await enterprise.authorize({ ...CTX, tier: "enterprise" })).decision).toBe("review");
  });

  it("forwards the audit hook", async () => {
    const seen: string[] = [];
    const pipeline = buildInstitutionalAuthorizationPipeline("enterprise", {
      policy: () => ({ outcome: "allow" }),
      onDecision: (_ctx, r) => seen.push(r.decision),
    });
    await pipeline.authorize(CTX);
    expect(seen).toEqual(["allow"]);
  });
});
