/**
 * Tests for the behavioural anomaly engine — online baselining (Welford) plus
 * the AML heuristics (structuring, amount z-spike, new-counterparty, dormancy
 * reactivation, rapid-repeat), the score→decision mapping, the pure/record
 * split, and composition as an authorization-pipeline stage.
 */

import { describe, it, expect } from "vitest";
import {
  BehavioralAnomalyEngine,
  anomalyStage,
  TransactionAuthorizationPipeline,
  type AnomalyObservation,
  type AuthorizationContext,
} from "@aethelred/wallet-compliance";

const CP = "0xCP00000000000000000000000000000000000001";
const NEW = "0xNEW0000000000000000000000000000000000002";
const T0 = 1_750_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function obs(p: Partial<AnomalyObservation> & { amountUsd: number }): AnomalyObservation {
  return { subjectId: "alice", counterparty: CP, at: T0, ...p };
}

/** Seed a varied small-amount baseline (std > 0) to a known counterparty. */
function seeded(): BehavioralAnomalyEngine {
  const e = new BehavioralAnomalyEngine();
  for (const [i, amt] of [100, 150, 120, 200, 130].entries()) {
    e.record(obs({ amountUsd: amt, at: T0 + i * 1000 }));
  }
  return e;
}

describe("baselining", () => {
  it("learns an online mean/variance and counterparty set", () => {
    const b = seeded().baselineFor("alice")!;
    expect(b.count).toBe(5);
    expect(b.mean).toBeCloseTo(140, 0);
    expect(b.std).toBeGreaterThan(0);
    expect(b.counterparties).toBe(1);
  });
});

describe("individual signals", () => {
  it("flags a new counterparty", () => {
    const r = seeded().assess(obs({ amountUsd: 130, counterparty: NEW, at: T0 + 10_000 }));
    expect(r.flags).toContain("new-counterparty");
  });

  it("flags an amount spike (z > threshold)", () => {
    const r = seeded().assess(obs({ amountUsd: 5000, at: T0 + 10_000 }));
    expect(r.flags).toContain("amount-spike");
  });

  it("flags structuring just under the reporting threshold", () => {
    const r = new BehavioralAnomalyEngine().assess(obs({ amountUsd: 9500 }));
    expect(r.flags).toContain("structuring");
  });

  it("flags dormancy reactivation after a long idle", () => {
    const e = seeded();
    const r = e.assess(obs({ amountUsd: 130, at: T0 + 120 * DAY }));
    expect(r.flags).toContain("dormancy-reactivation");
  });

  it("flags a rapid repeat of a near-identical transfer", () => {
    const e = new BehavioralAnomalyEngine();
    e.record(obs({ amountUsd: 500, at: T0 }));
    const r = e.assess(obs({ amountUsd: 500, at: T0 + 60_000 }));
    expect(r.flags).toContain("rapid-repeat");
  });
});

describe("score → decision", () => {
  it("a single weak signal allows; combinations escalate", () => {
    // new-counterparty alone (20) → allow
    expect(seeded().assess(obs({ amountUsd: 130, counterparty: NEW, at: T0 + 10_000 })).decision).toBe("allow");
    // structuring alone (45) on a fresh subject (no spike/new-cp) → review
    expect(new BehavioralAnomalyEngine().assess(obs({ amountUsd: 9500 })).decision).toBe("review");
    // structuring (45) + amount-spike (40) to known cp = 85 → block
    expect(seeded().assess(obs({ amountUsd: 9500, at: T0 + 10_000 })).decision).toBe("block");
  });
});

describe("pure assess vs record", () => {
  it("assess does not mutate the baseline; record does", () => {
    const e = seeded();
    const before = e.baselineFor("alice")!.count;
    e.assess(obs({ amountUsd: 5000, at: T0 + 10_000 }));
    expect(e.baselineFor("alice")!.count).toBe(before);
    e.record(obs({ amountUsd: 5000, at: T0 + 10_000 }));
    expect(e.baselineFor("alice")!.count).toBe(before + 1);
  });

  it("assessAndRecord both scores and learns", () => {
    const e = seeded();
    const before = e.baselineFor("alice")!.count;
    const r = e.assessAndRecord(obs({ amountUsd: 9500, at: T0 + 10_000 }));
    expect(r.flags).toContain("structuring");
    expect(e.baselineFor("alice")!.count).toBe(before + 1);
  });

  it("rejects an inverted threshold config", () => {
    expect(() => new BehavioralAnomalyEngine({ reviewScore: 90, blockScore: 80 })).toThrow(/reviewScore/);
  });
});

describe("anomalyStage (pipeline integration)", () => {
  const ctx = (amountUsd: number, dest = CP): AuthorizationContext => ({
    transactionId: "tx", destinationAddress: dest as `0x${string}`, amountUsd, tier: "enterprise", subjectId: "alice",
  });

  it("blocks a structuring+spike transaction inside the pipeline", async () => {
    const engine = seeded();
    const pipeline = new TransactionAuthorizationPipeline([anomalyStage(engine)]);
    const r = await pipeline.authorize(ctx(9500));
    expect(r.decision).toBe("block");
    expect(r.stages[0].reason).toMatch(/structuring|amount-spike/);
  });

  it("record:false leaves the baseline unchanged", async () => {
    const engine = seeded();
    const before = engine.baselineFor("alice")!.count;
    const pipeline = new TransactionAuthorizationPipeline([anomalyStage(engine, { record: false })]);
    await pipeline.authorize(ctx(5000));
    expect(engine.baselineFor("alice")!.count).toBe(before);
  });
});
