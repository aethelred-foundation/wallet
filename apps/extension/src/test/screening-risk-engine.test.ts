/**
 * Tests for the institutional multi-source screening risk engine:
 * weighted/max combination, quorum + fail-closed, category overrides
 * (sanctions → categorical block), per-source fault tolerance, and the fact
 * that it composes as a ScreeningProvider inside LiveScreeningGate.
 */

import { describe, it, expect } from "vitest";
import {
  AggregatingScreeningProvider,
  LiveScreeningGate,
  type ScreeningProvider,
} from "@aethelred/wallet-compliance";

const ADDR = "0xAbC0000000000000000000000000000000001234" as `0x${string}`;

function source(score: number, categories: string[] = [], opts: { throws?: boolean } = {}): ScreeningProvider {
  return {
    name: "src",
    async screenAddress(address) {
      if (opts.throws) throw new Error("source down");
      return { address, riskScore: score, severity: "low", categories, provider: "src", screenedAt: 0 };
    },
  };
}

describe("score combination", () => {
  it("max (default) takes the most conservative score", async () => {
    const agg = new AggregatingScreeningProvider([{ provider: source(30) }, { provider: source(80) }]);
    expect((await agg.screenAddress(ADDR)).riskScore).toBe(80);
  });

  it("weighted-mean blends by weight", async () => {
    const agg = new AggregatingScreeningProvider(
      [{ provider: source(40), weight: 1 }, { provider: source(80), weight: 3 }],
      { combine: "weighted-mean" },
    );
    // (40*1 + 80*3) / 4 = 70
    expect((await agg.screenAddress(ADDR)).riskScore).toBe(70);
  });

  it("unions categories and derives severity", async () => {
    const agg = new AggregatingScreeningProvider([{ provider: source(50, ["mixer"]) }, { provider: source(20, ["gambling"]) }]);
    const r = await agg.screenAddress(ADDR);
    expect([...r.categories].sort()).toEqual(["gambling", "mixer"]);
    expect(r.severity).toBe("high"); // 50 → high
  });
});

describe("category overrides", () => {
  it("forces a sanctions hit to 100 even with a low numeric score", async () => {
    const agg = new AggregatingScreeningProvider([{ provider: source(5, ["sanctions-ofac"]) }]);
    const r = await agg.screenAddress(ADDR);
    expect(r.riskScore).toBe(100);
    expect(r.severity).toBe("severe");
  });

  it("honors a custom category policy", async () => {
    const agg = new AggregatingScreeningProvider(
      [{ provider: source(10, ["darknet-market"]) }],
      { categoryPolicies: [{ category: "darknet", forceMinScore: 90 }] },
    );
    expect((await agg.screenAddress(ADDR)).riskScore).toBe(90);
  });
});

describe("quorum + fault tolerance", () => {
  it("fails closed (score 100) when fewer than quorum sources respond", async () => {
    const agg = new AggregatingScreeningProvider(
      [{ provider: source(10) }, { provider: source(10, [], { throws: true }) }],
      { quorum: 2 },
    );
    const r = await agg.screenAddress(ADDR);
    expect(r.riskScore).toBe(100);
    expect(r.categories).toContain("screening-unavailable");
    expect(r.provider).toMatch(/fail-closed/);
  });

  it("tolerates a failing source when quorum is still met", async () => {
    const agg = new AggregatingScreeningProvider(
      [{ provider: source(60) }, { provider: source(0, [], { throws: true }) }],
      { quorum: 1 },
    );
    const r = await agg.screenAddress(ADDR);
    expect(r.riskScore).toBe(60);
    expect(r.provider).toMatch(/\[1\/2\]/);
  });
});

describe("validation + composition", () => {
  it("validates construction", () => {
    expect(() => new AggregatingScreeningProvider([])).toThrow(/at least one/);
    expect(() => new AggregatingScreeningProvider([{ provider: source(0) }], { quorum: 0 })).toThrow(/quorum/);
  });

  it("drops into LiveScreeningGate and blocks a sanctioned address", async () => {
    const agg = new AggregatingScreeningProvider([
      { provider: source(15, ["sanctions"]) },
      { provider: source(20) },
    ]);
    const gate = new LiveScreeningGate(agg);
    const outcome = await gate.evaluate(ADDR);
    expect(outcome.decision).toBe("block"); // sanctions floor → 100 → above block threshold
  });
});
