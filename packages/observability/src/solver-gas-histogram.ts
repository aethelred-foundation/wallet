/**
 * `SolverGasHistogram` — per-solver gas distribution aggregator.
 *
 * Consumes the per-intent gas signal that `transfer-solver` and
 * `swap-solver` lift into `Fill.metadata` (PR #80) and produces the
 * cross-intent statistical view an SRE actually reads:
 *
 *   `{ count, mean, p50, p95, p99, min, max, totalCostWei }` per
 *   solver id.
 *
 * Bounded memory: a per-solver ring buffer (default 1024 samples).
 * Older samples are dropped silently. For the small windows operators
 * actually look at (~100-1000 fills per minute per solver) this gives
 * exact quantiles via sort + nearest-rank, which is faster and simpler
 * than t-digest / HdrHistogram for that size.
 *
 * Zero deps. Structural input shape avoids pulling
 * `@aethelred/wallet-intent-router` into observability — the
 * `fillToGasSample` helper does the unwrap from a `Fill`-shaped
 * record at the call site.
 *
 * @example
 * ```ts
 * import {
 *   SolverGasHistogram,
 *   fillToGasSample,
 * } from "@aethelred/wallet-observability";
 *
 * const histogram = new SolverGasHistogram({ windowSize: 1000 });
 *
 * // Wire into the audit stream — every fulfilled intent feeds in.
 * router.on("settlement-succeeded", ({ fill }) => {
 *   const sample = fillToGasSample(fill);
 *   if (sample) histogram.record(sample);
 * });
 *
 * // Read at SLO-eval cadence (e.g. every 30s).
 * for (const [solverId, stats] of histogram.snapshots()) {
 *   console.log(`${solverId}: p95=${stats.p95}, mean=${stats.mean}`);
 * }
 * ```
 */

/**
 * Minimal input shape — anything with a `solverId` + `gasUsed`
 * (and optional `gasCostWei`) is a sample. Keeps observability
 * decoupled from intent-router's `Fill` type.
 */
export interface FillGasSample {
  readonly solverId: string;
  readonly gasUsed: bigint;
  readonly gasCostWei?: bigint;
}

export interface PerSolverGasStats {
  readonly solverId: string;
  /** Number of samples in the rolling window for this solver. */
  readonly count: number;
  /** Arithmetic mean of `gasUsed` (integer division — bigint). */
  readonly mean: bigint;
  readonly p50: bigint;
  readonly p95: bigint;
  readonly p99: bigint;
  readonly min: bigint;
  readonly max: bigint;
  /**
   * Sum of `gasCostWei` across samples that included it. May be
   * 0n when no sample carried cost data; `costSampleCount` says
   * how many contributed. This split lets dashboards show "cost
   * across N of M fills with cost data" honestly.
   */
  readonly totalCostWei: bigint;
  readonly costSampleCount: number;
}

export interface SolverGasHistogramConfig {
  /**
   * Maximum samples retained per solver. When exceeded, the oldest
   * sample is dropped. Default 1024 — exact quantiles over 1024
   * sorted bigints is microseconds even on a service-worker.
   */
  readonly windowSize?: number;
}

const DEFAULT_WINDOW_SIZE = 1024;

export class SolverGasHistogram {
  private readonly windowSize: number;
  /** Per-solver ring buffer of `gasUsed` samples (FIFO). */
  private readonly buffers = new Map<string, bigint[]>();
  /** Per-solver running sum of buffer contents — kept current as
   *  samples enter/leave the ring. Avoids re-summing on every
   *  snapshot(). */
  private readonly sums = new Map<string, bigint>();
  /** Per-solver running cost totals — only counts samples that
   *  carried a `gasCostWei`. */
  private readonly costs = new Map<
    string,
    { totalWei: bigint; count: number }
  >();

  constructor(config: SolverGasHistogramConfig = {}) {
    const windowSize = config.windowSize ?? DEFAULT_WINDOW_SIZE;
    if (!Number.isInteger(windowSize) || windowSize <= 0) {
      throw new Error(
        `SolverGasHistogram: windowSize must be a positive integer, got ${windowSize}`,
      );
    }
    this.windowSize = windowSize;
  }

  /**
   * Record a single fill's gas data. No-op if the sample's
   * `gasUsed` isn't a positive bigint (defensive: callers should
   * skip absent gas data via `fillToGasSample` returning null,
   * but we guard against malformed samples too).
   */
  record(sample: FillGasSample): void {
    if (typeof sample.gasUsed !== "bigint" || sample.gasUsed < 0n) return;
    const { solverId } = sample;

    let buf = this.buffers.get(solverId);
    if (!buf) {
      buf = [];
      this.buffers.set(solverId, buf);
    }

    // Evict oldest when at capacity.
    if (buf.length >= this.windowSize) {
      const dropped = buf.shift()!;
      const curSum = this.sums.get(solverId) ?? 0n;
      this.sums.set(solverId, curSum - dropped);
    }
    buf.push(sample.gasUsed);
    this.sums.set(
      solverId,
      (this.sums.get(solverId) ?? 0n) + sample.gasUsed,
    );

    // Cost is tracked separately because not every sample carries
    // it (e.g. when the receipt lacked effectiveGasPrice the solver
    // omits gasCostWei). Cost totals are NOT subject to ring-buffer
    // eviction — they remain a monotonic running sum so dashboards
    // can chart cumulative spend honestly.
    if (typeof sample.gasCostWei === "bigint" && sample.gasCostWei >= 0n) {
      const cur = this.costs.get(solverId) ?? { totalWei: 0n, count: 0 };
      this.costs.set(solverId, {
        totalWei: cur.totalWei + sample.gasCostWei,
        count: cur.count + 1,
      });
    }
  }

  /** Stats snapshot for a single solver, or `null` if no samples. */
  snapshot(solverId: string): PerSolverGasStats | null {
    const buf = this.buffers.get(solverId);
    if (!buf || buf.length === 0) return null;
    const sorted = [...buf].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const count = sorted.length;
    const sum = this.sums.get(solverId) ?? 0n;
    const cost = this.costs.get(solverId) ?? { totalWei: 0n, count: 0 };
    return {
      solverId,
      count,
      mean: sum / BigInt(count),
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
      min: sorted[0]!,
      max: sorted[count - 1]!,
      totalCostWei: cost.totalWei,
      costSampleCount: cost.count,
    };
  }

  /** Stats snapshots for every tracked solver, keyed by solver id. */
  snapshots(): ReadonlyMap<string, PerSolverGasStats> {
    const out = new Map<string, PerSolverGasStats>();
    for (const solverId of this.buffers.keys()) {
      const snap = this.snapshot(solverId);
      if (snap) out.set(solverId, snap);
    }
    return out;
  }

  /** Number of distinct solvers tracked. */
  size(): number {
    return this.buffers.size;
  }

  /** Total samples across all solvers (after any evictions). */
  totalSamples(): number {
    let n = 0;
    for (const buf of this.buffers.values()) n += buf.length;
    return n;
  }

  /** Drop all data — useful for tests or for resetting at SLO boundaries. */
  reset(): void {
    this.buffers.clear();
    this.sums.clear();
    this.costs.clear();
  }
}

/**
 * Project a `Fill`-shaped record to a `FillGasSample`. Returns
 * `null` if the fill's metadata doesn't carry `gasUsed` (e.g.
 * x402 payments where the facilitator pays gas, or transfer/swap
 * fills from providers that omit `gasUsed` on the receipt).
 *
 * Generic over the fill type so consumers don't need to import
 * `Fill` from intent-router — any `{ solverId, metadata }` shape
 * works.
 */
export function fillToGasSample<
  T extends {
    readonly solverId: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  },
>(fill: T): FillGasSample | null {
  const meta = fill.metadata;
  if (!meta) return null;
  const gasUsed = meta.gasUsed;
  if (typeof gasUsed !== "bigint") return null;
  const gasCostWei = meta.gasCostWei;
  return {
    solverId: fill.solverId,
    gasUsed,
    ...(typeof gasCostWei === "bigint" ? { gasCostWei } : {}),
  };
}

// ─── Percentile helper ─────────────────────────────────────────

/**
 * Nearest-rank percentile on a pre-sorted ascending array. No
 * interpolation — the returned value always exists in the sample
 * set. Standard for small windows; for the bigint domain it's
 * the obviously correct choice (no fractional gas).
 */
function percentile(sortedAsc: ReadonlyArray<bigint>, p: number): bigint {
  if (sortedAsc.length === 0) {
    throw new Error("percentile of empty array");
  }
  if (p < 0 || p > 1) {
    throw new Error(`percentile p must be in [0,1], got ${p}`);
  }
  // Math.ceil(p * N) - 1, clamped to [0, N-1]. This places p=0 at
  // index 0 (min), p=1 at index N-1 (max), and matches the
  // "exclusive" nearest-rank convention used by Prometheus and
  // most dashboards.
  const n = sortedAsc.length;
  const rawIdx = Math.ceil(p * n) - 1;
  const idx = Math.max(0, Math.min(n - 1, rawIdx));
  return sortedAsc[idx]!;
}
