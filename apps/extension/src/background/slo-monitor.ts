/**
 * Per-handler latency SLO monitor.
 *
 * The background service worker dispatches ~45 distinct bridge
 * message kinds. Each one is a user-facing operation (unlock the
 * wallet, list pending tx, sign a transfer, fetch balances) whose
 * perceived responsiveness is the sum of the service-worker
 * round-trip plus the native UI cost.
 *
 * Without measurement, a handler that drifts from 15ms → 300ms
 * over three months ships silently — desktop ↔ mobile hardware
 * variance masks the regression in manual QA, and the CI perf
 * benches only cover a handful of signing hot paths.
 *
 * This module declares an SLO per handler (p50, p99, hard max) and
 * a {@link SloMonitor} that records actual measurements into a
 * bounded rolling window, computes percentile snapshots on demand,
 * and reports the set of handlers currently breaching their p99
 * budget.
 *
 * Design choices:
 *   - Ring buffer (fixed capacity per handler) keeps memory flat
 *     across long service-worker uptimes; the oldest sample is
 *     evicted as new ones arrive.
 *   - Percentile computation is **nearest-rank** on a sorted copy
 *     of the live buffer — O(n log n) per snapshot call, but the
 *     buffer caps at a few hundred samples so the cost is
 *     negligible compared to any handler it measures.
 *   - The monitor is intentionally ignorant of success/failure for
 *     budget breaches: a slow error (e.g. a 3s unauthorized RPC
 *     call) is still a slow response the user felt, so
 *     `breaches` is driven purely by `durationMs > maxMs`.
 *   - Tracing + logging are optional. When provided, a breach
 *     emits a structured warn log and a short span event so the
 *     wider observability pipeline can correlate across a session.
 *   - No cross-handler state — every handler is its own independent
 *     bucket. This means a noisy `rpc-request` handler cannot
 *     crowd out measurements of `get-state`, which would otherwise
 *     make the monitor blind to fast handlers during incidents.
 */

import type { BridgeMessageKind } from "@aethelred/wallet-connect";
import type { Logger, Tracer } from "@aethelred/wallet-observability";

/** Category used to roll handler SLOs up into higher-level reports. */
export type HandlerSloCategory =
  | "rpc"
  | "state"
  | "approval"
  | "passkey"
  | "walletconnect"
  | "credentials"
  | "deployment"
  | "audit"
  | "misc";

/**
 * SLO definition for a single bridge message handler.
 *
 * All three thresholds are measured in **milliseconds** and must
 * satisfy `p50Ms <= p99Ms <= maxMs` — the registry validates this
 * at construction time so a typo cannot silently make the monitor
 * unfalsifiable.
 */
export interface HandlerSlo {
  /** Bridge message kind this SLO applies to. */
  kind: BridgeMessageKind;
  /** p50 latency budget (ms). */
  p50Ms: number;
  /** p99 latency budget (ms). */
  p99Ms: number;
  /**
   * Hard maximum latency (ms). Any sample greater than this is a
   * budget breach — logged, audited, and surfaced in Developer
   * Tools.
   */
  maxMs: number;
  /** Rollup category for reporting / Developer Tools filtering. */
  category: HandlerSloCategory;
}

/**
 * A single measurement the background records after a handler
 * completes (whether or not it succeeded).
 */
export interface SloMeasurement {
  /** Which handler this sample describes. */
  kind: BridgeMessageKind;
  /** Wall-clock duration in milliseconds. Must be finite and non-negative. */
  durationMs: number;
  /** `Date.now()` at sample time — used for the "recent first" ordering. */
  at: number;
  /** Whether the handler returned a result vs threw. */
  success: boolean;
  /** Optional correlation id plumbed through the bridge. */
  correlationId?: string;
}

/**
 * A point-in-time roll-up of the live rolling window for a handler.
 *
 * `count` is the number of samples actually in the window — after a
 * reset or SW restart, the monitor returns `null` from
 * {@link SloMonitor.snapshot} rather than a zero-filled snapshot,
 * because a pristine handler is not the same as one that has been
 * measured and is consistently fast.
 */
export interface SloSnapshot {
  kind: BridgeMessageKind;
  category: HandlerSloCategory;
  /** Number of samples in the rolling window. */
  count: number;
  /** p50 latency (ms). */
  p50: number;
  /** p95 latency (ms). */
  p95: number;
  /** p99 latency (ms). */
  p99: number;
  /** Maximum observed latency (ms) in the window. */
  max: number;
  /** Number of samples that exceeded `maxMs`. */
  breaches: number;
  /**
   * Fraction of samples that met the p99 budget, in `[0, 1]`. A
   * value of `1` means every sample fit inside `p99Ms`.
   */
  sloComplianceRatio: number;
  /** The raw SLO definition so callers can diff against `p50 / p99 / max`. */
  budget: {
    p50Ms: number;
    p99Ms: number;
    maxMs: number;
  };
}

/** Default rolling window capacity per handler. */
export const DEFAULT_WINDOW_SIZE = 200;

/** Minimum number of samples before {@link SloMonitor.breached} considers a handler. */
export const MIN_SAMPLES_FOR_BREACH = 10;

/* ─── Internal state ──────────────────────────────────────────────── */

/**
 * Per-handler rolling buffer. The buffer is pre-allocated so
 * steady-state recording is a pointer write + a few scalar updates;
 * we never allocate while on the hot path of the service worker.
 */
interface HandlerState {
  readonly slo: HandlerSlo;
  /** Durations in ms, in insertion order. May contain stale entries past `count`. */
  readonly ring: Float64Array;
  /** Next insertion index into the ring (wraps). */
  writeIndex: number;
  /** Number of samples actually populated — caps at `ring.length`. */
  count: number;
  /** Running count of durations that exceeded `slo.maxMs`. */
  breaches: number;
  /** Running count of durations that fit inside `slo.p99Ms`. */
  withinP99: number;
}

/* ─── SloMonitor ─────────────────────────────────────────────────── */

/**
 * Aggregates handler latency measurements against a pre-declared
 * SLO registry. Safe to call from anywhere the service worker is
 * live — the record path is synchronous and non-throwing.
 *
 * @example
 * ```ts
 * const monitor = new SloMonitor(DEFAULT_SLOS, 200, logger, tracer);
 * const start = performance.now();
 * try {
 *   await dispatch(msg);
 * } finally {
 *   monitor.record({
 *     kind: msg.kind,
 *     durationMs: performance.now() - start,
 *     at: Date.now(),
 *     success: true,
 *   });
 * }
 * ```
 */
export class SloMonitor {
  private readonly states: Map<BridgeMessageKind, HandlerState>;
  private readonly windowSize: number;
  private readonly logger?: Logger;
  private readonly tracer?: Tracer;
  /**
   * Kinds we have already warned about for "no SLO defined" so the
   * service-worker console does not fill up if a dapp fuzzes the
   * bridge with unknown kinds.
   */
  private readonly warnedUnknown: Set<string> = new Set();

  /**
   * @param slos - Registered SLO table. Duplicate kinds throw.
   * @param windowSize - Rolling window size (per handler). Clamped
   *   to `[10, 5000]` to keep memory bounded.
   * @param logger - Optional structured logger for breach events.
   * @param tracer - Optional tracer; when set, each breach records a
   *   span event on a short-lived span.
   */
  constructor(slos: readonly HandlerSlo[], windowSize?: number, logger?: Logger, tracer?: Tracer) {
    const size = windowSize ?? DEFAULT_WINDOW_SIZE;
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error(`SloMonitor: windowSize must be > 0, got ${size}`);
    }
    this.windowSize = Math.max(10, Math.min(5000, Math.floor(size)));
    this.logger = logger;
    this.tracer = tracer;
    this.states = new Map();
    for (const slo of slos) {
      if (this.states.has(slo.kind)) {
        throw new Error(`SloMonitor: duplicate SLO for handler kind "${slo.kind}"`);
      }
      assertSloShape(slo);
      this.states.set(slo.kind, {
        slo,
        ring: new Float64Array(this.windowSize),
        writeIndex: 0,
        count: 0,
        breaches: 0,
        withinP99: 0,
      });
    }
  }

  /**
   * Record a single handler measurement. Unknown handler kinds are
   * accepted — they simply produce a single warn log (once per
   * process) so fuzzing from dapps cannot flood the logs.
   *
   * Negative, NaN, or non-finite durations are clamped to `0` so a
   * monotonic clock skew bug cannot corrupt the ring.
   */
  record(measurement: SloMeasurement): void {
    const state = this.states.get(measurement.kind);
    if (!state) {
      if (!this.warnedUnknown.has(measurement.kind)) {
        this.warnedUnknown.add(measurement.kind);
        this.logger?.warn(
          "slo.unknown-handler",
          "SloMonitor received measurement for handler with no registered SLO.",
          { kind: measurement.kind },
        );
      }
      return;
    }

    const duration = normalizeDuration(measurement.durationMs);
    state.ring[state.writeIndex] = duration;
    state.writeIndex = (state.writeIndex + 1) % this.windowSize;
    if (state.count < this.windowSize) state.count++;

    if (duration > state.slo.maxMs) state.breaches++;
    if (duration <= state.slo.p99Ms) state.withinP99++;

    if (duration > state.slo.maxMs) {
      // A hard-max breach is always logged because it is the
      // strictest tier — downstream dashboards treat this as a
      // page-worthy symptom even if the rolling p99 is still within
      // budget.
      this.logger?.warn(
        "slo.breach",
        "Handler latency exceeded maxMs budget.",
        {
          kind: measurement.kind,
          durationMs: Math.round(duration),
          maxMs: state.slo.maxMs,
          success: measurement.success,
          correlationId: measurement.correlationId ?? "",
        },
      );
      if (this.tracer) {
        const span = this.tracer.startSpan("slo.breach", {
          attributes: {
            "slo.kind": measurement.kind,
            "slo.duration_ms": Math.round(duration),
            "slo.max_ms": state.slo.maxMs,
            "slo.category": state.slo.category,
          },
        });
        span.setStatus("error", "max-latency-exceeded");
        span.end();
      }
    }
  }

  /**
   * Return a percentile snapshot for the named handler, or `null`
   * when the handler either has no SLO registered or no samples
   * yet. Callers differentiate with `snapshot(kind) === null`.
   */
  snapshot(kind: BridgeMessageKind): SloSnapshot | null {
    const state = this.states.get(kind);
    if (!state || state.count === 0) return null;
    return buildSnapshot(state);
  }

  /**
   * Return snapshots for every handler with at least one sample.
   * Ordering matches the registration order of the SLOs.
   */
  snapshotAll(): SloSnapshot[] {
    const out: SloSnapshot[] = [];
    for (const state of this.states.values()) {
      if (state.count === 0) continue;
      out.push(buildSnapshot(state));
    }
    return out;
  }

  /**
   * Return only handlers whose current p99 exceeds their p99 budget.
   * Handlers with fewer than {@link MIN_SAMPLES_FOR_BREACH} samples
   * are excluded so a single slow cold-start call cannot trip the
   * alerting pipeline.
   */
  breached(): SloSnapshot[] {
    const out: SloSnapshot[] = [];
    for (const state of this.states.values()) {
      if (state.count < MIN_SAMPLES_FOR_BREACH) continue;
      const snap = buildSnapshot(state);
      if (snap.p99 > snap.budget.p99Ms) out.push(snap);
    }
    return out;
  }

  /**
   * List the SLO for every registered handler. Used by the Developer
   * Tools UI to render handlers that have zero samples (so the
   * operator can see "this handler was never called in this SW
   * session" rather than missing rows).
   */
  registered(): HandlerSlo[] {
    return [...this.states.values()].map((s) => s.slo);
  }

  /**
   * Wipe every rolling buffer. Called on SW restart and when the
   * operator explicitly clears the Developer Tools view.
   */
  reset(): void {
    for (const state of this.states.values()) {
      state.ring.fill(0);
      state.writeIndex = 0;
      state.count = 0;
      state.breaches = 0;
      state.withinP99 = 0;
    }
    this.warnedUnknown.clear();
  }
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function assertSloShape(slo: HandlerSlo): void {
  const { kind, p50Ms, p99Ms, maxMs } = slo;
  if (!Number.isFinite(p50Ms) || p50Ms < 0) {
    throw new Error(`SloMonitor: invalid p50Ms=${p50Ms} for ${kind}`);
  }
  if (!Number.isFinite(p99Ms) || p99Ms < 0) {
    throw new Error(`SloMonitor: invalid p99Ms=${p99Ms} for ${kind}`);
  }
  if (!Number.isFinite(maxMs) || maxMs < 0) {
    throw new Error(`SloMonitor: invalid maxMs=${maxMs} for ${kind}`);
  }
  if (p50Ms > p99Ms) {
    throw new Error(`SloMonitor: p50Ms (${p50Ms}) must be <= p99Ms (${p99Ms}) for ${kind}`);
  }
  if (p99Ms > maxMs) {
    throw new Error(`SloMonitor: p99Ms (${p99Ms}) must be <= maxMs (${maxMs}) for ${kind}`);
  }
}

function normalizeDuration(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value;
}

function buildSnapshot(state: HandlerState): SloSnapshot {
  const n = state.count;
  // Copy only the valid prefix of the ring so `sort` never sees
  // zero-filled stale slots from a not-yet-wrapped buffer.
  const sorted = new Float64Array(n);
  if (state.count < state.ring.length) {
    // Ring hasn't wrapped — samples live at indices [0, count).
    for (let i = 0; i < n; i++) sorted[i] = state.ring[i];
  } else {
    // Ring has wrapped — logical order starts at `writeIndex`.
    const cap = state.ring.length;
    let r = state.writeIndex;
    for (let i = 0; i < n; i++) {
      sorted[i] = state.ring[r];
      r = (r + 1) % cap;
    }
  }
  sorted.sort();
  const p50 = nearestRank(sorted, 0.5);
  const p95 = nearestRank(sorted, 0.95);
  const p99 = nearestRank(sorted, 0.99);
  const max = sorted[n - 1];
  const compliance = n === 0 ? 1 : state.withinP99 / n;
  return {
    kind: state.slo.kind,
    category: state.slo.category,
    count: n,
    p50,
    p95,
    p99,
    max,
    breaches: state.breaches,
    sloComplianceRatio: compliance,
    budget: {
      p50Ms: state.slo.p50Ms,
      p99Ms: state.slo.p99Ms,
      maxMs: state.slo.maxMs,
    },
  };
}

/**
 * Nearest-rank percentile (the same algorithm OpenTelemetry,
 * Prometheus's histogram_quantile fallback, and the NIST
 * statistical handbook all describe). `sorted` must be ascending.
 *
 * Returned value is always a real observed sample, which makes the
 * output easy to reason about during incident review: "the p99 was
 * 412 ms" always refers to a measurement that actually happened.
 */
function nearestRank(sorted: Float64Array, q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const rank = Math.max(1, Math.ceil(q * n));
  return sorted[Math.min(rank, n) - 1];
}
