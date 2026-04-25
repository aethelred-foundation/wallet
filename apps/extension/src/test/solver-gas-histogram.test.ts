/**
 * SolverGasHistogram tests.
 *
 * Coverage:
 *   1. Construction guards — windowSize must be a positive integer.
 *   2. record() — happy path; ignores samples without bigint gasUsed.
 *   3. snapshot() — returns null for unknown solverId; computes
 *      mean / p50 / p95 / p99 / min / max correctly on a known
 *      sample set; tracks cost separately when gasCostWei present.
 *   4. Bounded window — when N samples exceed windowSize, oldest
 *      are evicted; running sum stays correct (mean reflects the
 *      window only); cost totals are NOT subject to ring eviction
 *      (cumulative).
 *   5. Multi-solver isolation — fills for solver A don't pollute
 *      solver B's stats.
 *   6. fillToGasSample helper — extracts from Fill-shaped records;
 *      returns null when metadata missing or gasUsed not bigint.
 *   7. Reset — clears all state.
 */

import { describe, expect, it } from "vitest";

import {
  SolverGasHistogram,
  fillToGasSample,
  type FillGasSample,
  type PerSolverGasStats,
} from "@aethelred/wallet-observability";

// ─── Construction ──────────────────────────────────────

describe("SolverGasHistogram construction", () => {
  it("accepts default config", () => {
    const h = new SolverGasHistogram();
    expect(h.size()).toBe(0);
    expect(h.totalSamples()).toBe(0);
  });

  it("accepts a positive integer windowSize", () => {
    const h = new SolverGasHistogram({ windowSize: 100 });
    expect(h.size()).toBe(0);
  });

  it("rejects zero / negative / non-integer windowSize", () => {
    expect(() => new SolverGasHistogram({ windowSize: 0 })).toThrow();
    expect(() => new SolverGasHistogram({ windowSize: -1 })).toThrow();
    expect(() => new SolverGasHistogram({ windowSize: 3.5 })).toThrow();
  });
});

// ─── record() ──────────────────────────────────────────

describe("SolverGasHistogram.record", () => {
  it("records a single sample", () => {
    const h = new SolverGasHistogram();
    h.record({ solverId: "transfer:base", gasUsed: 60_000n });
    expect(h.size()).toBe(1);
    expect(h.totalSamples()).toBe(1);
  });

  it("ignores samples with negative gasUsed", () => {
    const h = new SolverGasHistogram();
    h.record({ solverId: "t", gasUsed: -1n });
    expect(h.totalSamples()).toBe(0);
  });

  // TypeScript would normally reject this, but malformed runtime
  // input is a real concern (e.g. metadata casts, wire-format
  // unwrap). Defensive guard.
  it("ignores samples where gasUsed is not a bigint at runtime", () => {
    const h = new SolverGasHistogram();
    h.record({ solverId: "t", gasUsed: 60_000 as unknown as bigint });
    expect(h.totalSamples()).toBe(0);
  });
});

// ─── snapshot() ────────────────────────────────────────

describe("SolverGasHistogram.snapshot", () => {
  it("returns null when solverId has no samples", () => {
    const h = new SolverGasHistogram();
    expect(h.snapshot("none")).toBeNull();
  });

  it("computes mean / p50 / p95 / p99 / min / max correctly", () => {
    const h = new SolverGasHistogram();
    // 10 samples: 100k, 110k, 120k, ..., 190k
    for (let i = 0; i < 10; i++) {
      h.record({
        solverId: "transfer:base",
        gasUsed: BigInt(100_000 + i * 10_000),
      });
    }
    const snap = h.snapshot("transfer:base")!;
    expect(snap.count).toBe(10);
    expect(snap.min).toBe(100_000n);
    expect(snap.max).toBe(190_000n);
    // Mean: (100+110+...+190)*1000 / 10 = 145_000.
    expect(snap.mean).toBe(145_000n);
    // Nearest-rank with 10 samples:
    //   p50 → ceil(0.50*10)-1 = 4 → 140k
    //   p95 → ceil(0.95*10)-1 = 9 → 190k
    //   p99 → ceil(0.99*10)-1 = 9 → 190k
    expect(snap.p50).toBe(140_000n);
    expect(snap.p95).toBe(190_000n);
    expect(snap.p99).toBe(190_000n);
  });

  it("tracks cost totals only when gasCostWei present", () => {
    const h = new SolverGasHistogram();
    h.record({ solverId: "s", gasUsed: 60_000n, gasCostWei: 30_000n });
    h.record({ solverId: "s", gasUsed: 70_000n }); // no cost
    h.record({ solverId: "s", gasUsed: 80_000n, gasCostWei: 40_000n });
    const snap = h.snapshot("s")!;
    expect(snap.count).toBe(3);
    // Both gas samples with cost contributed → 30k + 40k.
    expect(snap.totalCostWei).toBe(70_000n);
    // Only 2 of 3 carried cost data — the dashboard should be
    // honest about that rather than implying coverage of all 3.
    expect(snap.costSampleCount).toBe(2);
  });

  it("snapshots() returns one entry per tracked solver", () => {
    const h = new SolverGasHistogram();
    h.record({ solverId: "transfer", gasUsed: 60_000n });
    h.record({ solverId: "swap", gasUsed: 180_000n });
    const all = h.snapshots();
    expect(all.size).toBe(2);
    expect(all.get("transfer")?.count).toBe(1);
    expect(all.get("swap")?.count).toBe(1);
  });
});

// ─── Bounded window ────────────────────────────────────

describe("SolverGasHistogram bounded window", () => {
  it("evicts oldest samples when at capacity", () => {
    const h = new SolverGasHistogram({ windowSize: 3 });
    h.record({ solverId: "s", gasUsed: 100n });
    h.record({ solverId: "s", gasUsed: 200n });
    h.record({ solverId: "s", gasUsed: 300n });
    h.record({ solverId: "s", gasUsed: 400n }); // evicts 100n
    h.record({ solverId: "s", gasUsed: 500n }); // evicts 200n
    const snap = h.snapshot("s")!;
    expect(snap.count).toBe(3);
    expect(snap.min).toBe(300n); // 100 + 200 evicted
    expect(snap.max).toBe(500n);
    // Mean of the WINDOW (300+400+500)/3 = 400, NOT the lifetime mean.
    expect(snap.mean).toBe(400n);
  });

  it("running sum stays consistent across many evictions", () => {
    const h = new SolverGasHistogram({ windowSize: 5 });
    // Push 100 samples of identical value through the window.
    for (let i = 0; i < 100; i++) {
      h.record({ solverId: "s", gasUsed: 50_000n });
    }
    const snap = h.snapshot("s")!;
    expect(snap.count).toBe(5);
    expect(snap.mean).toBe(50_000n); // would be wrong if sum drifted
    expect(snap.min).toBe(50_000n);
    expect(snap.max).toBe(50_000n);
  });

  it("cost totals are CUMULATIVE (not bound by the ring window)", () => {
    const h = new SolverGasHistogram({ windowSize: 2 });
    // 5 samples but window only holds 2. Cost totals should reflect
    // ALL 5 contributions — operators want lifetime spend, not
    // just the last N fills' worth.
    for (let i = 0; i < 5; i++) {
      h.record({ solverId: "s", gasUsed: 100n, gasCostWei: 50n });
    }
    const snap = h.snapshot("s")!;
    expect(snap.count).toBe(2); // window-bound
    expect(snap.costSampleCount).toBe(5); // cumulative
    expect(snap.totalCostWei).toBe(250n); // 5 * 50
  });
});

// ─── Multi-solver isolation ────────────────────────────

describe("SolverGasHistogram multi-solver isolation", () => {
  it("samples for solver A don't pollute solver B's stats", () => {
    const h = new SolverGasHistogram();
    for (let i = 0; i < 5; i++) {
      h.record({ solverId: "transfer", gasUsed: 60_000n });
    }
    for (let i = 0; i < 3; i++) {
      h.record({ solverId: "swap", gasUsed: 180_000n });
    }
    const t = h.snapshot("transfer")!;
    const s = h.snapshot("swap")!;
    expect(t.count).toBe(5);
    expect(t.mean).toBe(60_000n);
    expect(s.count).toBe(3);
    expect(s.mean).toBe(180_000n);
    expect(h.totalSamples()).toBe(8);
  });

  it("eviction in one solver's buffer doesn't affect another", () => {
    const h = new SolverGasHistogram({ windowSize: 2 });
    h.record({ solverId: "a", gasUsed: 100n });
    h.record({ solverId: "a", gasUsed: 200n });
    h.record({ solverId: "a", gasUsed: 300n }); // evicts a's 100
    h.record({ solverId: "b", gasUsed: 1000n });
    expect(h.snapshot("a")?.min).toBe(200n);
    expect(h.snapshot("b")?.count).toBe(1);
    expect(h.snapshot("b")?.min).toBe(1000n);
  });
});

// ─── fillToGasSample ───────────────────────────────────

describe("fillToGasSample", () => {
  it("extracts solverId + gasUsed + gasCostWei from a Fill-shaped record", () => {
    const fill = {
      solverId: "transfer:base",
      metadata: { gasUsed: 60_000n, gasCostWei: 30_000n, other: "ignored" },
    };
    const sample = fillToGasSample(fill);
    expect(sample).toEqual({
      solverId: "transfer:base",
      gasUsed: 60_000n,
      gasCostWei: 30_000n,
    });
  });

  it("omits gasCostWei when only gasUsed is present", () => {
    const fill = { solverId: "s", metadata: { gasUsed: 60_000n } };
    const sample = fillToGasSample(fill)!;
    expect(sample.gasUsed).toBe(60_000n);
    expect(sample.gasCostWei).toBeUndefined();
  });

  it("returns null when metadata is missing", () => {
    expect(fillToGasSample({ solverId: "s" })).toBeNull();
  });

  it("returns null when gasUsed isn't a bigint (e.g. x402 fills)", () => {
    expect(
      fillToGasSample({
        solverId: "x402",
        metadata: { paymentReceipt: { txHash: "0x..." } },
      }),
    ).toBeNull();
  });
});

// ─── reset() ───────────────────────────────────────────

describe("SolverGasHistogram.reset", () => {
  it("clears all state", () => {
    const h = new SolverGasHistogram();
    h.record({ solverId: "a", gasUsed: 100n });
    h.record({ solverId: "b", gasUsed: 200n, gasCostWei: 50n });
    expect(h.totalSamples()).toBe(2);
    h.reset();
    expect(h.size()).toBe(0);
    expect(h.totalSamples()).toBe(0);
    expect(h.snapshot("a")).toBeNull();
    expect(h.snapshot("b")).toBeNull();
  });
});

// ─── End-to-end shape check ────────────────────────────

describe("end-to-end: feed Fill-shaped records through fillToGasSample → record → snapshot", () => {
  it("real workflow", () => {
    const h = new SolverGasHistogram();
    const fakeFills = [
      {
        solverId: "transfer:base",
        metadata: { gasUsed: 60_000n, gasCostWei: 30_000_000_000_000n },
      },
      {
        solverId: "transfer:base",
        metadata: { gasUsed: 65_000n, gasCostWei: 32_500_000_000_000n },
      },
      {
        solverId: "swap:base",
        metadata: {
          gasUsed: 180_000n,
          gasCostWei: 90_000_000_000_000n,
          perTxGasUsed: [60_000n, 120_000n],
        },
      },
      // x402 fill — no gas data; should be skipped at sample level.
      { solverId: "x402:base", metadata: { paymentReceipt: { txHash: "0x" } } },
    ];

    for (const fill of fakeFills) {
      const sample = fillToGasSample(fill);
      if (sample) h.record(sample);
    }

    expect(h.size()).toBe(2); // x402 not tracked
    const stats: PerSolverGasStats[] = [...h.snapshots().values()];
    expect(stats.find((s) => s.solverId === "transfer:base")?.count).toBe(2);
    expect(stats.find((s) => s.solverId === "swap:base")?.count).toBe(1);
    expect(h.snapshot("x402:base")).toBeNull();
  });

  // Tests the FillGasSample type is structurally usable.
  it("FillGasSample type is exported and structurally satisfied by record() input", () => {
    const sample: FillGasSample = {
      solverId: "t",
      gasUsed: 60_000n,
      gasCostWei: 30_000n,
    };
    const h = new SolverGasHistogram();
    h.record(sample);
    expect(h.totalSamples()).toBe(1);
  });
});
