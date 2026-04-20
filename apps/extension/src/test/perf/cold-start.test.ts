/**
 * ═══════════════════════════════════════════════════════════════════════
 * Cold-start instrumentation — unit tests
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The cold-start API is narrow, but the surface it interacts with —
 * `performance.now()`, `PerformanceObserver`, `requestAnimationFrame` —
 * is exactly the kind of thing that's easy to break with a refactor and
 * impossible to detect without deterministic tests. These tests mock
 * the browser timing APIs so we can verify:
 *
 *   1. `mountMs` is computed relative to `initColdStartTimer()`.
 *   2. `firstPaintMs` is populated from `PerformanceObserver` entries.
 *   3. Missing paint data yields `NaN` (not a fabricated number).
 *   4. `finalizeColdStart` is idempotent.
 *   5. Sink and logger errors MUST NOT propagate.
 *
 * Tests share a `beforeEach` that fully resets module state via the
 * `__resetColdStartForTests` escape hatch — this lets us run each test
 * with a fresh clock, even though the cold-start module is designed to
 * be called once per popup in production.
 *
 * Owner: wallet-extension team.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetColdStartForTests,
  currentSnapshot,
  finalizeColdStart,
  initColdStartTimer,
  markInteractive,
  markReactMounted,
  recordColdStart,
  setColdStartLogger,
  setColdStartSink,
} from "../../popup/perf/cold-start";

/* ─── Helpers ────────────────────────────────────────────────────── */

let nowMs = 0;
let originalPerformance: typeof globalThis.performance | undefined;
let originalObserver: typeof PerformanceObserver | undefined;
type FakeObserverCb = (list: { getEntries: () => PerformanceEntry[] }) => void;
const registeredCallbacks: FakeObserverCb[] = [];

function installFakes() {
  originalPerformance = globalThis.performance;
  originalObserver = globalThis.PerformanceObserver;

  (globalThis as Record<string, unknown>).performance = {
    now: () => nowMs,
    timeOrigin: 0,
  };

  class FakeObserver implements Partial<PerformanceObserver> {
    constructor(cb: FakeObserverCb) {
      registeredCallbacks.push(cb);
    }
    observe(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
    takeRecords(): PerformanceEntry[] {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).PerformanceObserver =
    FakeObserver as unknown as typeof PerformanceObserver;
}

function restoreFakes() {
  (globalThis as Record<string, unknown>).performance = originalPerformance;
  (globalThis as Record<string, unknown>).PerformanceObserver = originalObserver;
  registeredCallbacks.length = 0;
}

/** Emit a synthetic `first-paint` entry to all registered observers. */
function emitFirstPaint(startTime: number): void {
  const entry = {
    name: "first-paint",
    entryType: "paint",
    startTime,
    duration: 0,
    toJSON: () => ({}),
  } as unknown as PerformanceEntry;
  for (const cb of registeredCallbacks) {
    cb({ getEntries: () => [entry] });
  }
}

/* ─── Lifecycle ──────────────────────────────────────────────────── */

beforeEach(() => {
  installFakes();
  nowMs = 0;
  __resetColdStartForTests();
});

afterEach(() => {
  restoreFakes();
  __resetColdStartForTests();
});

/* ─── Tests ──────────────────────────────────────────────────────── */

describe("cold-start instrumentation", () => {
  it("computes mountMs relative to initColdStartTimer", () => {
    nowMs = 100;
    initColdStartTimer();
    nowMs = 450;
    markReactMounted();
    nowMs = 470;
    markInteractive();

    const snap = finalizeColdStart();
    expect(snap.mountMs).toBe(350); // 450 - 100
  });

  it("records firstPaintMs from PerformanceObserver entries", () => {
    nowMs = 0;
    initColdStartTimer();
    emitFirstPaint(220);
    nowMs = 250;
    markReactMounted();
    markInteractive();

    const snap = finalizeColdStart();
    expect(snap.firstPaintMs).toBe(220);
  });

  it("returns NaN for firstPaintMs when no paint entry arrives", () => {
    initColdStartTimer();
    markReactMounted();
    markInteractive();

    const snap = finalizeColdStart();
    expect(Number.isNaN(snap.firstPaintMs)).toBe(true);
  });

  it("finalizeColdStart is idempotent", () => {
    nowMs = 0;
    initColdStartTimer();
    nowMs = 120;
    markReactMounted();
    nowMs = 130;
    markInteractive();

    const first = finalizeColdStart();
    const second = finalizeColdStart();
    expect(first).toEqual(second);
  });

  it("calls the registered sink exactly once with the final snapshot", () => {
    const onColdStart = vi.fn();
    setColdStartSink({ onColdStart });

    nowMs = 0;
    initColdStartTimer();
    nowMs = 50;
    markReactMounted();
    nowMs = 60;
    markInteractive();
    finalizeColdStart();
    finalizeColdStart(); // second call should be a no-op

    expect(onColdStart).toHaveBeenCalledTimes(1);
    const arg = onColdStart.mock.calls[0][0];
    expect(arg.mountMs).toBe(50);
  });

  it("sink errors MUST NOT propagate", () => {
    setColdStartSink({
      onColdStart: () => {
        throw new Error("sink exploded");
      },
    });
    initColdStartTimer();
    markReactMounted();
    markInteractive();
    expect(() => finalizeColdStart()).not.toThrow();
  });

  it("logger errors MUST NOT propagate", () => {
    setColdStartLogger({
      info: () => {
        throw new Error("logger exploded");
      },
    });
    initColdStartTimer();
    markReactMounted();
    markInteractive();
    // logger calls happen synchronously inside finalizeColdStart; if they
    // threw they'd bubble up here. The cold-start module guards them via
    // try/catch implicitly (throw inside `logger.info` is wrapped by the
    // module's outer invocation), so this call should complete silently.
    // Current behaviour: logger errors do propagate — documenting the
    // contract: either side MUST NOT break the critical path.
    // This test flips to `not.toThrow` the moment the module guards the
    // call (see cold-start.ts, finalizeColdStart). For now, we assert
    // that the try/catch around the logger invocation absorbs the throw.
    expect(() => finalizeColdStart()).not.toThrow();
  });

  it("recordColdStart is a synchronous one-shot convenience", () => {
    nowMs = 0;
    initColdStartTimer(); // explicit init at t=0
    nowMs = 200;
    const snap = recordColdStart();
    expect(snap.mountMs).toBe(200);
    expect(Number.isNaN(snap.firstPaintMs)).toBe(true);
  });

  it("recordColdStart without explicit init still produces a snapshot", () => {
    // With no separate init, record captures both t_init and t_mount at the
    // same moment, so mountMs is 0 — not an error, just the minimum
    // measurable signal when everything happens on one tick.
    nowMs = 500;
    const snap = recordColdStart();
    expect(snap.mountMs).toBe(0);
    expect(Number.isNaN(snap.firstPaintMs)).toBe(true);
  });

  it("currentSnapshot returns NaN for mountMs before init + mount", () => {
    const snap = currentSnapshot();
    expect(Number.isNaN(snap.mountMs)).toBe(true);
  });
});
