/**
 * Tests for the TransactionAuthorizationPipeline — the enforced pre-signing
 * decision that composes the compliance gates. Covers severity aggregation,
 * fail-fast vs collect-all, fail-closed stage errors, sovereign-tier
 * escalation, the throw-on-block enforcement entry point, and the three
 * pre-built stage adapters wired to the real gates.
 */

import { describe, it, expect, vi } from "vitest";
import {
  TransactionAuthorizationPipeline,
  AuthorizationBlockedError,
  screeningStage,
  travelRuleStage,
  policyStage,
  LiveScreeningGate,
  TravelRuleInteropEngine,
  type AuthorizationStage,
  type AuthorizationContext,
  type AuthorizationDecision,
  type ScreeningProvider,
} from "@aethelred/wallet-compliance";

const CTX: AuthorizationContext = {
  transactionId: "tx-1",
  destinationAddress: ("0x" + "11".repeat(20)) as `0x${string}`,
  amountUsd: 5000,
  tier: "enterprise",
};

function stage(name: string, decision: AuthorizationDecision): AuthorizationStage {
  return { name, evaluate: () => ({ stage: name, decision, reason: `${name}:${decision}` }) };
}
function throwingStage(name: string): AuthorizationStage {
  return { name, evaluate: () => { throw new Error("boom"); } };
}
function screeningProvider(score: number): ScreeningProvider {
  return { name: "fake", async screenAddress(address) { return { address, riskScore: score, severity: "low", categories: [], provider: "fake", screenedAt: 0 }; } };
}
function trRecord(overrides: Record<string, unknown> = {}): any {
  return {
    id: "tr", transactionId: "tx-1",
    originator: { name: "Alice", accountNumber: "0x" + "11".repeat(20), geographicAddress: "AE" },
    beneficiary: { name: "Bob", accountNumber: "0x" + "22".repeat(20) },
    amount: "5000", currency: "USDC", assetType: "stablecoin", transferDate: 0,
    originatingVasp: { name: "Aethelred", jurisdiction: "AE" }, beneficiaryVasp: { name: "NoblePay", jurisdiction: "AE" },
    screeningResult: { sanctionsMatch: false, pepMatch: false, adverseMediaMatch: false, riskScore: 1, screenedAt: 0, provider: "x" },
    threshold: "below", status: "pending", ...overrides,
  };
}

describe("aggregation + ordering", () => {
  it("aggregate is the most severe stage outcome", async () => {
    const p = new TransactionAuthorizationPipeline([stage("a", "allow"), stage("b", "review"), stage("c", "block")]);
    const r = await p.authorize(CTX);
    expect(r.decision).toBe("block");
    expect(r.blocked).toBe(true);
    expect(r.stages.map((s) => s.stage)).toEqual(["a", "b", "c"]);
  });

  it("review wins over allow; all-allow is allow", async () => {
    expect((await new TransactionAuthorizationPipeline([stage("a", "allow"), stage("b", "review")]).authorize(CTX)).decision).toBe("review");
    expect((await new TransactionAuthorizationPipeline([stage("a", "allow"), stage("b", "allow")]).authorize(CTX)).decision).toBe("allow");
  });
});

describe("execution modes", () => {
  it("collect-all (default) runs every stage", async () => {
    const last = vi.fn(() => ({ stage: "last", decision: "allow" as const, reason: "x" }));
    const p = new TransactionAuthorizationPipeline([stage("a", "block"), { name: "last", evaluate: last }]);
    await p.authorize(CTX);
    expect(last).toHaveBeenCalledOnce();
  });

  it("fail-fast stops at the first block", async () => {
    const last = vi.fn(() => ({ stage: "last", decision: "allow" as const, reason: "x" }));
    const p = new TransactionAuthorizationPipeline([stage("a", "block"), { name: "last", evaluate: last }], { mode: "fail-fast" });
    const r = await p.authorize(CTX);
    expect(last).not.toHaveBeenCalled();
    expect(r.stages).toHaveLength(1);
  });
});

describe("fail-closed + tier strictness", () => {
  it("a thrown stage maps to block by default", async () => {
    const r = await new TransactionAuthorizationPipeline([throwingStage("x")]).authorize(CTX);
    expect(r.decision).toBe("block");
    expect(r.stages[0].reason).toMatch(/fail-closed/);
  });

  it("can map a thrown stage to review", async () => {
    const r = await new TransactionAuthorizationPipeline([throwingStage("x")], { onStageError: "review" }).authorize(CTX);
    expect(r.decision).toBe("review");
  });

  it("escalateReviewToBlock turns review into block (sovereign strictness)", async () => {
    const r = await new TransactionAuthorizationPipeline([stage("a", "review")], { escalateReviewToBlock: true }).authorize(CTX);
    expect(r.decision).toBe("block");
  });
});

describe("authorizeOrThrow + hooks + validation", () => {
  it("throws AuthorizationBlockedError on block, returns otherwise", async () => {
    const blocked = new TransactionAuthorizationPipeline([stage("a", "block")]);
    await expect(blocked.authorizeOrThrow(CTX)).rejects.toBeInstanceOf(AuthorizationBlockedError);
    const review = new TransactionAuthorizationPipeline([stage("a", "review")]);
    await expect(review.authorizeOrThrow(CTX)).resolves.toMatchObject({ decision: "review" });
  });

  it("AuthorizationBlockedError carries the result and blocking reasons", async () => {
    const p = new TransactionAuthorizationPipeline([stage("screening", "block")]);
    try { await p.authorizeOrThrow(CTX); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(AuthorizationBlockedError); expect((e as AuthorizationBlockedError).result.blocked).toBe(true); expect((e as Error).message).toMatch(/screening/); }
  });

  it("calls the onDecision audit hook", async () => {
    const onDecision = vi.fn();
    await new TransactionAuthorizationPipeline([stage("a", "allow")], { onDecision }).authorize(CTX);
    expect(onDecision).toHaveBeenCalledWith(CTX, expect.objectContaining({ decision: "allow" }));
  });

  it("rejects empty or duplicate-name stage sets", () => {
    expect(() => new TransactionAuthorizationPipeline([])).toThrow(/at least one/);
    expect(() => new TransactionAuthorizationPipeline([stage("a", "allow"), stage("a", "allow")])).toThrow(/unique/);
  });
});

describe("stage adapters", () => {
  it("screeningStage maps risk score to a decision", async () => {
    const block = new TransactionAuthorizationPipeline([screeningStage(new LiveScreeningGate(screeningProvider(90)))]);
    expect((await block.authorize(CTX)).decision).toBe("block");
    const review = new TransactionAuthorizationPipeline([screeningStage(new LiveScreeningGate(screeningProvider(50)))]);
    expect((await review.authorize(CTX)).decision).toBe("review");
    const allow = new TransactionAuthorizationPipeline([screeningStage(new LiveScreeningGate(screeningProvider(5)))]);
    expect((await allow.authorize(CTX)).decision).toBe("allow");
  });

  it("travelRuleStage: no record allows; complete allows; incomplete-above-threshold reviews", async () => {
    const engine = new TravelRuleInteropEngine();
    const p = new TransactionAuthorizationPipeline([travelRuleStage(engine, "trisa")]);
    expect((await p.authorize(CTX)).decision).toBe("allow"); // no record

    const complete = { ...CTX, travelRuleRecord: trRecord({ threshold: "above" }) };
    expect((await p.authorize(complete)).decision).toBe("allow");

    const incomplete = { ...CTX, travelRuleRecord: trRecord({ threshold: "above", originator: { name: "A", accountNumber: "0x" + "11".repeat(20) } }) };
    const r = await p.authorize(incomplete);
    expect(r.decision).toBe("review");
    expect(r.stages[0].reason).toMatch(/IVMS101 incomplete/);
  });

  it("policyStage maps policy outcomes", async () => {
    const make = (outcome: "allow" | "warn" | "approval-required" | "deny") =>
      new TransactionAuthorizationPipeline([policyStage(() => ({ outcome }))]);
    expect((await make("deny").authorize(CTX)).decision).toBe("block");
    expect((await make("approval-required").authorize(CTX)).decision).toBe("review");
    expect((await make("warn").authorize(CTX)).decision).toBe("allow");
    expect((await make("allow").authorize(CTX)).decision).toBe("allow");
  });

  it("composes screening + travel-rule + policy end-to-end", async () => {
    const pipeline = new TransactionAuthorizationPipeline(
      [
        screeningStage(new LiveScreeningGate(screeningProvider(50))), // review
        travelRuleStage(new TravelRuleInteropEngine(), "trisa"), // allow (no record)
        policyStage(() => ({ outcome: "allow" })), // allow
      ],
      { onDecision: vi.fn() },
    );
    const r = await pipeline.authorize(CTX);
    expect(r.decision).toBe("review"); // screening review dominates
    expect(r.stages).toHaveLength(3);
  });
});
