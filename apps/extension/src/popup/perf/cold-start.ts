/**
 * ═══════════════════════════════════════════════════════════════════════
 * Popup cold-start performance instrumentation
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Captures three timing milestones for every popup open:
 *
 *   • `mountMs`        — time from module load to React root mount
 *   • `firstPaintMs`   — time from navigation start to first paint
 *   • `interactiveMs`  — time from navigation start to first interactive
 *                        render (app ready for user input)
 *
 * All three use the W3C Performance API:
 *   - `performance.timeOrigin` gives the Unix epoch of navigation start
 *   - `performance.now()` gives a high-res elapsed-ms value
 *   - `PerformanceObserver` surfaces `paint` entries ("first-paint" and
 *     "first-contentful-paint") as the browser reports them
 *
 * The measurement is passive — we record timestamps as they happen and
 * return them synchronously on request. There's no sampling and no
 * long-running observer; once we've resolved all three values we
 * disconnect the observer to avoid leaking it.
 *
 * Results are logged via `@aethelred/wallet-observability`'s `Logger` if
 * a logger is wired in. The observability package is an OPTIONAL peer at
 * runtime — if it can't be imported we silently fall back to no-op so
 * perf never breaks the popup. This matches the design of every other
 * observability signal in the wallet: instrumentation MUST NOT fail
 * closed on the critical path.
 *
 * Usage (popup/main.tsx):
 *   import { initColdStartTimer, finalizeColdStart } from "./perf/cold-start";
 *   initColdStartTimer();
 *   // ...React.createRoot(...).render(...)
 *   requestAnimationFrame(() => finalizeColdStart());
 *
 * Ownership: wallet-extension team. SLO target: p95 < 800 ms (see
 * docs/perf/SLO.md).
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * Normalized cold-start timing record returned to callers.
 *
 * All fields are elapsed milliseconds measured against the document's
 * navigation start (i.e. `performance.timeOrigin`). A `NaN` value means
 * the underlying paint entry never fired — typical in headless test
 * runners that don't render to a compositor. Callers should treat NaN
 * as "not measured", not as a regression.
 */
export interface ColdStartTimings {
  /** ms from module load to React root mount. */
  mountMs: number;
  /** ms from navigation start to first paint (browser-reported). */
  firstPaintMs: number;
  /** ms from navigation start to first interactive render. */
  interactiveMs: number;
}

/** Optional sink for timing records. Must not throw. */
export interface ColdStartSink {
  onColdStart(timings: ColdStartTimings): void;
}

/**
 * Minimal subset of the observability Logger we actually call. Duck-typed
 * so the perf module has ZERO compile-time dependency on the logger
 * package — the popup bundle stays bytewise identical whether or not
 * observability is wired in.
 */
interface MinimalLogger {
  info(code: string, message: string, attributes?: Record<string, string | number | boolean | null>): void;
}

/* ─── Module-private state ────────────────────────────────────────── */

let initAtMs: number | null = null;
let mountAtMs: number | null = null;
let firstPaintAtMs: number | null = null;
let interactiveAtMs: number | null = null;
let paintObserver: PerformanceObserver | null = null;
let sink: ColdStartSink | null = null;
let logger: MinimalLogger | null = null;
let finalized = false;

/**
 * Start the cold-start timer. Call as early as possible in the popup
 * entry module — ideally the FIRST statement after the React imports
 * resolve. Idempotent; subsequent calls are no-ops so hot-reload doesn't
 * skew numbers.
 */
export function initColdStartTimer(): void {
  if (initAtMs !== null) return;
  initAtMs = performanceNow();
  attachPaintObserver();
}

/**
 * Attach an observer for browser-reported paint entries. The observer
 * auto-disconnects once `first-paint` has been seen — we don't need
 * LCP or other metrics from this path (Lighthouse CI covers those).
 */
function attachPaintObserver(): void {
  if (typeof PerformanceObserver === "undefined") return;

  try {
    paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-paint" && firstPaintAtMs === null) {
          firstPaintAtMs = entry.startTime;
        }
      }
      if (firstPaintAtMs !== null && paintObserver) {
        paintObserver.disconnect();
        paintObserver = null;
      }
    });
    paintObserver.observe({ type: "paint", buffered: true });
  } catch {
    // Some older webviews throw if `type:` isn't supported. Fall back
    // silently — Lighthouse will still surface FCP authoritatively.
    paintObserver = null;
  }
}

/**
 * Mark the moment React's root has mounted. Typically called from the
 * render callback of `createRoot().render(...)`. If the timer wasn't
 * initialized we resolve `mountMs` against `performance.timeOrigin` so
 * callers still get a sensible absolute value.
 */
export function markReactMounted(): void {
  if (mountAtMs === null) {
    mountAtMs = performanceNow();
  }
}

/**
 * Mark the moment the app is interactive (first user-actionable paint).
 * Typically called inside a `requestAnimationFrame` after the initial
 * render — that guarantees the browser has at least queued the paint
 * and any synchronous blocking work (auth check, hydration, etc.) is
 * complete.
 */
export function markInteractive(): void {
  if (interactiveAtMs === null) {
    interactiveAtMs = performanceNow();
  }
}

/**
 * Finalize the cold-start measurement and emit the record. Call once
 * per popup session — redundant calls are ignored. Returns the snapshot
 * for test / debugging purposes.
 */
export function finalizeColdStart(): ColdStartTimings {
  if (finalized) return currentSnapshot();

  if (mountAtMs === null) markReactMounted();
  if (interactiveAtMs === null) markInteractive();

  finalized = true;
  const snap = currentSnapshot();

  try {
    sink?.onColdStart(snap);
  } catch {
    // Sink failures must never derail instrumentation.
  }

  if (logger) {
    try {
      logger.info("popup.cold_start", "Popup cold-start timing recorded.", {
        mountMs: isFiniteNumber(snap.mountMs) ? snap.mountMs : null,
        firstPaintMs: isFiniteNumber(snap.firstPaintMs) ? snap.firstPaintMs : null,
        interactiveMs: isFiniteNumber(snap.interactiveMs) ? snap.interactiveMs : null,
      });
    } catch {
      // Logger failures must never derail instrumentation.
    }
  }

  if (paintObserver) {
    paintObserver.disconnect();
    paintObserver = null;
  }

  return snap;
}

/**
 * Return the currently-resolved timings without finalizing. Useful for
 * mid-flight diagnostics; prefer `finalizeColdStart` in production code
 * because it guarantees the sink/logger fire exactly once.
 */
export function currentSnapshot(): ColdStartTimings {
  return {
    mountMs: mountAtMs !== null && initAtMs !== null ? mountAtMs - initAtMs : Number.NaN,
    firstPaintMs: firstPaintAtMs !== null ? firstPaintAtMs : Number.NaN,
    interactiveMs: interactiveAtMs !== null ? interactiveAtMs : Number.NaN,
  };
}

/**
 * Synchronous one-shot convenience that satisfies the canonical
 * `recordColdStart(): { mountMs; firstPaintMs; interactiveMs }` contract.
 * Equivalent to calling `markReactMounted()`, `markInteractive()`, then
 * `finalizeColdStart()` in sequence — returns the final snapshot.
 */
export function recordColdStart(): ColdStartTimings {
  if (initAtMs === null) initColdStartTimer();
  markReactMounted();
  markInteractive();
  return finalizeColdStart();
}

/**
 * Register (or clear) a sink that receives the final timing record.
 * Exactly one sink is supported — later registrations replace earlier
 * ones. Pass `null` to detach.
 */
export function setColdStartSink(next: ColdStartSink | null): void {
  sink = next;
}

/**
 * Register (or clear) an observability Logger. When set, the finalizer
 * emits a single `popup.cold_start` info event.
 */
export function setColdStartLogger(next: MinimalLogger | null): void {
  logger = next;
}

/**
 * Test helper — reset all module state. NEVER call from production code;
 * this exists so the cold-start unit tests can run multiple simulated
 * popups in sequence inside one vitest worker.
 */
export function __resetColdStartForTests(): void {
  initAtMs = null;
  mountAtMs = null;
  firstPaintAtMs = null;
  interactiveAtMs = null;
  paintObserver?.disconnect();
  paintObserver = null;
  sink = null;
  logger = null;
  finalized = false;
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function performanceNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  // Final fallback — Date.now is 1 ms resolution, good enough for smoke.
  return Date.now();
}

function isFiniteNumber(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}
