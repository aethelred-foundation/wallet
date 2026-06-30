/**
 * Tuning + validation harness for the behavioural anomaly engine against the
 * canonical FATF/VARA red-flag typologies the consultant called out:
 *
 *   1. Structuring (smurfing) — repeated transfers just under the VARA
 *      AED 3,500 Travel Rule threshold.
 *   2. Amount z-spike — a $500-baseline account suddenly moving $50,000.
 *   3. Dormancy break — a long-idle account reactivating to a new high-risk
 *      counterparty.
 *
 * Each typology must TRIP the breaker (review or block, never allow), and a
 * benign control stream must stay `allow` — guarding against the
 * false-positive fatigue that makes officers ignore alerts. This runs in CI,
 * so a future weight change that breaks detection (or over-flags) fails here.
 */

import { describe, it, expect } from "vitest";
import { BehavioralAnomalyEngine, type AnomalyObservation } from "@aethelred/wallet-compliance";

const SUBJECT = "enterprise-treasury";
const KNOWN_CP = "0xKNOWN00000000000000000000000000000000001";
const T0 = 1_750_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function obs(p: Partial<AnomalyObservation> & { amountUsd: number; at: number }): AnomalyObservation {
  return { subjectId: SUBJECT, counterparty: KNOWN_CP, ...p };
}

/** Seed a normal small-amount baseline so z-scores have a reference. */
function seedBaseline(engine: BehavioralAnomalyEngine, mean = 500): void {
  for (const [i, amt] of [mean - 100, mean + 50, mean - 50, mean + 100, mean].entries()) {
    engine.record(obs({ amountUsd: amt, at: T0 + i * 1000 }));
  }
}

describe("AML typology detection (synthetic tuning harness)", () => {
  it("catches structuring under the VARA AED 3,500 threshold (escalates on repeat)", () => {
    // VARA jurisdiction: report-threshold AED 3,500.
    const engine = new BehavioralAnomalyEngine({ reportingThresholdUsd: 3500 });
    const decisions: string[] = [];
    // 6 smurfing transfers of ~3,400 (just under threshold) to fresh counterparties.
    for (let i = 0; i < 6; i++) {
      const a = engine.assessAndRecord({
        subjectId: SUBJECT,
        amountUsd: 3400,
        counterparty: `0xSMURF${i.toString().padStart(35, "0")}`,
        at: T0 + i * 5 * 60 * 1000, // every 5 min
      });
      decisions.push(a.decision);
    }
    // Every smurf trips; repeats escalate to a hard block.
    expect(decisions.every((d) => d !== "allow")).toBe(true);
    expect(decisions.slice(1).some((d) => d === "block")).toBe(true);
  });

  it("catches a $500→$50,000 amount z-spike", () => {
    const engine = new BehavioralAnomalyEngine();
    seedBaseline(engine, 500);
    const a = engine.assess(obs({ amountUsd: 50_000, at: T0 + 10 * DAY }));
    expect(a.flags).toContain("amount-spike");
    expect(a.decision).not.toBe("allow");
  });

  it("catches a dormancy break to a new high-risk counterparty", () => {
    const engine = new BehavioralAnomalyEngine();
    seedBaseline(engine, 500);
    const a = engine.assess({
      subjectId: SUBJECT,
      amountUsd: 480, // amount itself is normal — the *pattern* is the flag
      counterparty: "0xDEFIROUTER000000000000000000000000000001",
      at: T0 + 200 * DAY,
    });
    expect(a.flags).toContain("dormancy-reactivation");
    expect(a.flags).toContain("new-counterparty");
    expect(a.decision).not.toBe("allow");
  });

  it("does NOT over-flag benign in-pattern activity (false-positive guard)", () => {
    const engine = new BehavioralAnomalyEngine();
    seedBaseline(engine, 500);
    // Normal transfers, in-range amounts, to the established counterparty.
    const benign = [520, 480, 510, 495, 505].map((amt, i) =>
      engine.assess(obs({ amountUsd: amt, at: T0 + (6 + i) * 1000 })),
    );
    expect(benign.every((a) => a.decision === "allow")).toBe(true);
  });

  it("reports a detection summary (tuning visibility)", () => {
    const engine = new BehavioralAnomalyEngine({ reportingThresholdUsd: 3500 });
    seedBaseline(engine, 500);
    const structuring = engine.assess({ subjectId: SUBJECT, amountUsd: 3400, counterparty: KNOWN_CP, at: T0 + DAY });
    const spike = engine.assess(obs({ amountUsd: 50_000, at: T0 + DAY }));
    // Surface scores so a tuning run can eyeball signal separation.
    const report = { structuring: structuring.score, spike: spike.score };
    expect(report.structuring).toBeGreaterThanOrEqual(40);
    expect(report.spike).toBeGreaterThanOrEqual(40);
  });
});
