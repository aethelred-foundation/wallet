/**
 * Unit tests for the handler latency SLO monitor.
 *
 * The monitor's contract:
 *   - records O(1) in steady state
 *   - evicts the oldest sample when the ring wraps
 *   - computes p50/p99/max via nearest-rank on a sorted copy
 *   - `breached()` surfaces only handlers whose p99 currently
 *     exceeds the budget AND have at least MIN_SAMPLES_FOR_BREACH
 *     samples, so a single slow cold-start call never pages oncall
 *   - is resilient to NaN / negative / non-finite durations
 *   - never throws on the record path, even for unknown kinds
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "@aethelred/wallet-observability";
import type { BridgeMessageKind } from "@aethelred/wallet-connect";
import {
  SloMonitor,
  type HandlerSlo,
  type SloMeasurement,
  DEFAULT_WINDOW_SIZE,
  MIN_SAMPLES_FOR_BREACH,
} from "../background/slo-monitor";
// Use DEFAULT_SLOS_LIST (widened HandlerSlo[]) — DEFAULT_SLOS is declared
// `as const` in slo-defaults.ts so its literal-typed entries aren't
// assignable to SloMonitor's `readonly HandlerSlo[]` constructor param.
import { DEFAULT_SLOS_LIST as DEFAULT_SLOS } from "../background/slo-defaults";

/* ─── Helpers ─────────────────────────────────────────────────────── */

const TEST_KIND: BridgeMessageKind = "get-state";
const SECOND_KIND: BridgeMessageKind = "get-balances";

const TEST_SLOS: HandlerSlo[] = [
  { kind: TEST_KIND, p50Ms: 10, p99Ms: 50, maxMs: 150, category: "state" },
  { kind: SECOND_KIND, p50Ms: 100, p99Ms: 500, maxMs: 2000, category: "rpc" },
];

function sample(
  kind: BridgeMessageKind,
  durationMs: number,
  success = true,
): SloMeasurement {
  return { kind, durationMs, at: Date.now(), success };
}

function recordN(monitor: SloMonitor, kind: BridgeMessageKind, values: number[]): void {
  for (const ms of values) monitor.record(sample(kind, ms));
}

function makeSilentLogger(): Logger {
  // Sink that swallows everything — we just don't want noisy test
  // output when the monitor warns about unknown kinds.
  return new Logger({
    component: "slo-test",
    sinks: [{ write: () => {} }],
    minLevel: "trace",
  });
}

/* ─── Tests ───────────────────────────────────────────────────────── */

describe("SloMonitor", () => {
  let monitor: SloMonitor;

  beforeEach(() => {
    monitor = new SloMonitor(TEST_SLOS, 100, makeSilentLogger());
  });

  it("records a single sample and snapshot reflects count=1 with exact percentiles", () => {
    monitor.record(sample(TEST_KIND, 25));
    const snap = monitor.snapshot(TEST_KIND);
    expect(snap).not.toBeNull();
    expect(snap?.count).toBe(1);
    expect(snap?.p50).toBe(25);
    expect(snap?.p99).toBe(25);
    expect(snap?.max).toBe(25);
    expect(snap?.breaches).toBe(0);
    expect(snap?.budget).toEqual({ p50Ms: 10, p99Ms: 50, maxMs: 150 });
  });

  it("computes p50/p95/p99 within 1ms of nearest-rank ideal for 100 uniform samples", () => {
    // Durations 1, 2, ... 100
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    recordN(monitor, TEST_KIND, values);
    const snap = monitor.snapshot(TEST_KIND)!;
    expect(snap.count).toBe(100);
    // Nearest-rank on sorted [1..100]: p50 = ceil(0.5*100)=50 → values[49] = 50
    expect(snap.p50).toBe(50);
    expect(snap.p95).toBe(95);
    expect(snap.p99).toBe(99);
    expect(snap.max).toBe(100);
  });

  it("ring buffer wraps and evicts the oldest sample when capacity is exceeded", () => {
    // Record 250 samples into a window of 100 — only the last 100
    // survive. The stored set is therefore {151..250}.
    const total = 250;
    for (let i = 1; i <= total; i++) {
      monitor.record(sample(TEST_KIND, i));
    }
    const snap = monitor.snapshot(TEST_KIND)!;
    expect(snap.count).toBe(100);
    // Oldest retained sample is 151, so min observed is 151.
    // p50 on [151..250] at rank 50 = 200.
    expect(snap.p50).toBe(200);
    // p99 at rank 99 = 249. p100 (max) = 250.
    expect(snap.p99).toBe(249);
    expect(snap.max).toBe(250);
  });

  it("breach count counts every sample > maxMs regardless of success flag", () => {
    monitor.record(sample(TEST_KIND, 200, true));  // > 150 ms max → breach
    monitor.record(sample(TEST_KIND, 250, false)); // failure + > max → breach
    monitor.record(sample(TEST_KIND, 60, true));   // within max, outside p99
    monitor.record(sample(TEST_KIND, 5, true));    // within all budgets
    const snap = monitor.snapshot(TEST_KIND)!;
    expect(snap.breaches).toBe(2);
  });

  it("snapshot returns null for handlers with zero samples (distinct from a zero-filled roll-up)", () => {
    // No samples at all — distinguish "pristine" from "fast".
    expect(monitor.snapshot(TEST_KIND)).toBeNull();
    expect(monitor.snapshotAll()).toEqual([]);
  });

  it("breached() returns only handlers whose p99 currently exceeds budget and have >= MIN_SAMPLES_FOR_BREACH", () => {
    // Under threshold — should never be returned even with bad p99.
    for (let i = 0; i < MIN_SAMPLES_FOR_BREACH - 1; i++) {
      monitor.record(sample(TEST_KIND, 500)); // way over budget
    }
    expect(monitor.breached()).toEqual([]);

    // Keep TEST_KIND just-under-budget in aggregate by recording
    // many within-budget samples; its p99 should stay within 50ms.
    for (let i = 0; i < 100; i++) monitor.record(sample(TEST_KIND, 10));

    // SECOND_KIND: enough samples, p99 clearly over 500ms.
    for (let i = 0; i < 20; i++) monitor.record(sample(SECOND_KIND, 1000));
    const breached = monitor.breached();
    expect(breached.map((s) => s.kind)).toEqual([SECOND_KIND]);
  });

  it("reset() clears every rolling buffer and the unknown-kind warn set", () => {
    recordN(monitor, TEST_KIND, [10, 20, 30]);
    recordN(monitor, SECOND_KIND, [100, 200, 300]);
    expect(monitor.snapshotAll()).toHaveLength(2);
    monitor.reset();
    expect(monitor.snapshotAll()).toEqual([]);
    expect(monitor.snapshot(TEST_KIND)).toBeNull();
  });

  it("concurrent records do not corrupt the ring buffer (sequential dispatch)", async () => {
    // Even though JS is single-threaded, we exercise the "100 concurrent
    // async callers" pattern the service worker hits during an approval
    // storm. The monitor's record path is sync so the count must match.
    vi.useFakeTimers();
    const promises: Array<Promise<void>> = [];
    for (let i = 0; i < 100; i++) {
      promises.push(Promise.resolve().then(() => monitor.record(sample(TEST_KIND, i + 1))));
    }
    await Promise.all(promises);
    const snap = monitor.snapshot(TEST_KIND)!;
    expect(snap.count).toBe(100);
    vi.useRealTimers();
  });

  it("record() on a handler with no SLO is ignored and does not throw", () => {
    const warnSpy = vi.fn();
    const loggerWithSpy = new Logger({
      component: "slo-test",
      sinks: [{ write: (rec) => { if (rec.level === "warn") warnSpy(rec); } }],
      minLevel: "warn",
    });
    const m = new SloMonitor(TEST_SLOS, 100, loggerWithSpy);
    expect(() => m.record(sample("approval-request", 10))).not.toThrow();
    expect(m.snapshot("approval-request")).toBeNull();
    // First unknown-kind record logs one warn; subsequent ones don't
    // (to avoid flooding the console).
    expect(warnSpy).toHaveBeenCalledTimes(1);
    m.record(sample("approval-request", 20));
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("normalizes NaN / negative / non-finite durations to 0", () => {
    monitor.record(sample(TEST_KIND, Number.NaN));
    monitor.record(sample(TEST_KIND, -5));
    monitor.record(sample(TEST_KIND, Number.POSITIVE_INFINITY));
    monitor.record(sample(TEST_KIND, Number.NEGATIVE_INFINITY));
    const snap = monitor.snapshot(TEST_KIND)!;
    expect(snap.count).toBe(4);
    expect(snap.p50).toBe(0);
    expect(snap.p99).toBe(0);
    expect(snap.max).toBe(0);
    expect(snap.breaches).toBe(0);
  });

  it("emits a warn log on every sample that exceeds maxMs", () => {
    const warnSpy = vi.fn();
    const loggerWithSpy = new Logger({
      component: "slo-test",
      sinks: [{ write: (rec) => { if (rec.level === "warn") warnSpy(rec); } }],
      minLevel: "warn",
    });
    const m = new SloMonitor(TEST_SLOS, 100, loggerWithSpy);
    m.record(sample(TEST_KIND, 10));   // ok
    m.record(sample(TEST_KIND, 200));  // breach
    m.record(sample(TEST_KIND, 300));  // breach
    expect(warnSpy).toHaveBeenCalledTimes(2);
    const record = warnSpy.mock.calls[0][0];
    expect(record.code).toBe("slo.breach");
    expect(record.attributes?.kind).toBe(TEST_KIND);
  });

  it("rejects duplicate SLOs at construction time", () => {
    const dup: HandlerSlo[] = [
      { kind: TEST_KIND, p50Ms: 10, p99Ms: 50, maxMs: 150, category: "state" },
      { kind: TEST_KIND, p50Ms: 10, p99Ms: 50, maxMs: 150, category: "state" },
    ];
    expect(() => new SloMonitor(dup)).toThrow(/duplicate SLO/);
  });

  it("rejects invalid SLO thresholds (p50 > p99 or p99 > max)", () => {
    expect(() => new SloMonitor([
      { kind: TEST_KIND, p50Ms: 100, p99Ms: 50, maxMs: 200, category: "state" },
    ])).toThrow(/p50Ms .* must be <= p99Ms/);
    expect(() => new SloMonitor([
      { kind: TEST_KIND, p50Ms: 10, p99Ms: 500, maxMs: 100, category: "state" },
    ])).toThrow(/p99Ms .* must be <= maxMs/);
    expect(() => new SloMonitor([
      { kind: TEST_KIND, p50Ms: -1, p99Ms: 50, maxMs: 200, category: "state" },
    ])).toThrow(/invalid p50Ms/);
  });

  it("clamps the window size to at least 10", () => {
    const m = new SloMonitor(TEST_SLOS, 1);
    for (let i = 1; i <= 100; i++) m.record(sample(TEST_KIND, i));
    const snap = m.snapshot(TEST_KIND)!;
    // Window clamped to 10 — retains last 10 samples (91..100).
    expect(snap.count).toBe(10);
    expect(snap.max).toBe(100);
    expect(snap.p50).toBe(95);
  });

  it("sloComplianceRatio reflects the fraction of samples within the p99 budget", () => {
    // 9 samples within the 50ms p99 budget, 1 outside.
    for (let i = 0; i < 9; i++) monitor.record(sample(TEST_KIND, 25));
    monitor.record(sample(TEST_KIND, 75)); // outside p99=50
    const snap = monitor.snapshot(TEST_KIND)!;
    expect(snap.sloComplianceRatio).toBeCloseTo(0.9, 5);
  });

  it("snapshotAll() returns entries in the order of SLO registration", () => {
    monitor.record(sample(SECOND_KIND, 150));
    monitor.record(sample(TEST_KIND, 10));
    const all = monitor.snapshotAll();
    expect(all.map((s) => s.kind)).toEqual([TEST_KIND, SECOND_KIND]);
  });

  it("registered() lists every SLO including those with no samples", () => {
    const listed = monitor.registered();
    expect(listed.map((s) => s.kind).sort()).toEqual([TEST_KIND, SECOND_KIND].sort());
  });

  it("DEFAULT_SLOS registry covers every known handler category", () => {
    const categories = new Set(DEFAULT_SLOS.map((s) => s.category));
    expect(categories.has("rpc")).toBe(true);
    expect(categories.has("state")).toBe(true);
    expect(categories.has("approval")).toBe(true);
    expect(categories.has("passkey")).toBe(true);
    expect(categories.has("walletconnect")).toBe(true);
    expect(categories.has("credentials")).toBe(true);
    expect(categories.has("deployment")).toBe(true);
    expect(categories.has("audit")).toBe(true);
  });

  it("DEFAULT_SLOS has no duplicate handler kinds", () => {
    const seen = new Map<string, number>();
    for (const slo of DEFAULT_SLOS) {
      seen.set(slo.kind, (seen.get(slo.kind) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, count]) => count > 1);
    expect(dupes).toEqual([]);
  });

  it("DEFAULT_SLOS produces a SloMonitor without errors", () => {
    expect(() => new SloMonitor(DEFAULT_SLOS, DEFAULT_WINDOW_SIZE)).not.toThrow();
  });
});
