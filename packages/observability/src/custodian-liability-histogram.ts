/**
 * `CustodianLiabilityHistogram` — per-custodian reliability + coverage
 * aggregator.
 *
 * Consumes the `LiabilitySnapshotEvent` stream emitted by
 * `captureLiabilitySnapshot` (`@aethelred/wallet-custody-adapters`)
 * and produces the cross-event statistical view an SRE actually reads:
 *
 *   - **`unknownRate`** — fraction of recent attestation attempts
 *     that failed (oracle outage / signature rejection / timeout).
 *     This is the SLI on custodian-oracle reliability — operators
 *     alert when it crosses ~5%.
 *   - **SLA-status distribution** — counts of `operational` /
 *     `degraded` / `unavailable` across the recent window. Skew
 *     toward `degraded` is an early-warning of upstream incidents.
 *   - **Latest coverage** — point-in-time insurance pool size for
 *     the custodian. NOT aggregated (mean/min/max don't make sense
 *     here — a coverage drop from \$500M → \$50M is significant and
 *     averaging hides it). Operators chart this as a sparkline.
 *
 * Pairs with `SolverGasHistogram` — same shape, same trade-offs,
 * different signal. The audit-chain wiring in
 * `recordLiabilitySnapshot` feeds events into the chain; this class
 * is the OBSERVABILITY companion that turns the same events into a
 * dashboard surface.
 *
 * Zero deps on `@aethelred/wallet-custody-adapters` — the consumed
 * shape is a structural duck type (`LiabilitySnapshotLike`) so this
 * package stays decoupled from custody internals. Callers map their
 * `LiabilitySnapshotEvent` to the duck type with
 * `liabilitySnapshotToSample` at the call site.
 *
 * @example
 * ```ts
 * import {
 *   CustodianLiabilityHistogram,
 *   liabilitySnapshotToSample,
 * } from "@aethelred/wallet-observability";
 *
 * const histogram = new CustodianLiabilityHistogram({ windowSize: 1024 });
 *
 * // Wire into the audit stream — every captured snapshot feeds in.
 * audit.on("custodian-liability-snapshot", (event) => {
 *   const sample = liabilitySnapshotToSample(event);
 *   if (sample) histogram.record(sample);
 * });
 *
 * // Read at SLO-eval cadence (e.g. every 30s).
 * for (const [custodianId, stats] of histogram.snapshots()) {
 *   if (stats.unknownRate > 0.05) {
 *     alert(`${custodianId} oracle reliability degraded: ${stats.unknownRate}`);
 *   }
 * }
 * ```
 */

import type { Meter } from "./metrics";

/**
 * SLA-status as reported by the custodian's oracle. Mirrors
 * `CustodianSlaStatus` in `@aethelred/wallet-custody-adapters` but
 * declared here so observability doesn't depend on custody-adapters.
 */
export type LiabilitySlaStatus = "operational" | "degraded" | "unavailable";

const ALL_STATUSES: ReadonlyArray<LiabilitySlaStatus> = [
  "operational",
  "degraded",
  "unavailable",
];

/**
 * Structural input shape — anything with a `custodianId` +
 * `liabilityUnknown` flag is a sample. When the attestation was
 * successful, the additional fields are populated; when it failed,
 * only the basics are present and downstream rate stats reflect that.
 *
 * Decouples observability from `wallet-custody-adapters` —
 * `liabilitySnapshotToSample()` below projects a real
 * `LiabilitySnapshotEvent` into this duck type at the call site.
 */
export interface LiabilitySnapshotSample {
  readonly custodianId: string;
  readonly liabilityUnknown: boolean;
  /** Populated when `liabilityUnknown === false`. */
  readonly slaStatus?: LiabilitySlaStatus;
  /** Populated when `liabilityUnknown === false`. */
  readonly insuranceCoverage?: bigint;
  /** Populated when `liabilityUnknown === false`. ISO 4217 code. */
  readonly insuranceCurrency?: string;
  /**
   * Optional millisecond timestamp. When provided, `snapshot()`
   * exposes it as `latestAt` so dashboards can show "last attestation
   * X seconds ago" — a freshness indicator distinct from rate stats.
   */
  readonly capturedAt?: number;
}

export interface PerCustodianLiabilityStats {
  readonly custodianId: string;
  /** Total samples in the rolling window for this custodian. */
  readonly total: number;
  /** Samples where the oracle attested successfully. */
  readonly knownCount: number;
  /** Samples where the oracle failed (`liabilityUnknown=true`). */
  readonly unknownCount: number;
  /**
   * `unknownCount / total`. The SLI operators alert on. Values close
   * to 0 mean the oracle is healthy; values approaching 1 mean the
   * pipeline can't see liability state anymore.
   */
  readonly unknownRate: number;
  /**
   * Per-status counts across the window. Only counts samples where
   * `liabilityUnknown === false` (unknown samples have no
   * slaStatus). Always includes all three keys; values are 0 when
   * the status hasn't appeared.
   */
  readonly slaStatusCounts: Readonly<Record<LiabilitySlaStatus, number>>;
  /**
   * Most recent insurance coverage value for the custodian. NOT
   * aggregated — a coverage drop is operationally significant and
   * averaging would hide it. Unset until the first known sample
   * lands; once set, updated by every subsequent known sample.
   */
  readonly latestCoverage?: bigint;
  /** Currency of `latestCoverage` (ISO 4217). */
  readonly latestCoverageCurrency?: string;
  /** SLA status from the same sample as `latestCoverage`. */
  readonly latestSlaStatus?: LiabilitySlaStatus;
  /**
   * `capturedAt` from the most recent sample (known OR unknown).
   * Lets dashboards show "last attestation attempt X seconds ago"
   * as a freshness indicator.
   */
  readonly latestAt?: number;
}

export interface CustodianLiabilityHistogramConfig {
  /**
   * Maximum samples retained per custodian in the rolling window.
   * When exceeded, the oldest sample is dropped. Default 1024 —
   * same as SolverGasHistogram for consistency. A larger window
   * smooths short-lived oracle blips; a smaller window reacts
   * faster.
   */
  readonly windowSize?: number;
}

/**
 * Options for {@link CustodianLiabilityHistogram.exportToMeter}.
 * Defaults follow Prometheus naming: `custodian_liability_*` prefix,
 * `custodian_id` label key.
 */
export interface CustodianLiabilityExportOptions {
  /**
   * Metric name prefix. The windowed gauges become
   * `<prefix>_window_total`, `<prefix>_window_unknown_count`,
   * `<prefix>_window_known_count`, `<prefix>_unknown_rate`,
   * `<prefix>_window_status_count{status="..."}`,
   * `<prefix>_latest_coverage`, `<prefix>_latest_attestation_age_ms`.
   * The lifetime counters become `<prefix>_attestations_total{outcome="..."}`
   * and `<prefix>_status_total{status="..."}`. Default
   * `custodian_liability`.
   */
  readonly prefix?: string;
  /**
   * Label key under which the custodian id is exported. Default
   * `custodian_id` — Prometheus convention. OTel-strict deployments
   * may want `custodian`.
   */
  readonly labelKey?: string;
  /**
   * Additional static labels to attach to every series — e.g.
   * `{ env: "prod", region: "us-east-1" }`.
   */
  readonly extraLabels?: Readonly<Record<string, string>>;
  /**
   * Clock used to compute `latest_attestation_age_ms`. Defaults to
   * `Date.now`. Tests inject a fixed clock so the gauge value is
   * deterministic.
   */
  readonly now?: () => number;
}

const DEFAULT_WINDOW_SIZE = 1024;
const DEFAULT_PREFIX = "custodian_liability";
const DEFAULT_LABEL_KEY = "custodian_id";

interface RingEntry {
  /** True when this sample carried no attestation (oracle failure). */
  readonly unknown: boolean;
  readonly slaStatus?: LiabilitySlaStatus;
}

/**
 * Bounded per-custodian rolling-window aggregator.
 */
export class CustodianLiabilityHistogram {
  private readonly windowSize: number;
  /** Per-custodian ring buffer (FIFO). */
  private readonly buffers = new Map<string, RingEntry[]>();
  /** Per-custodian running counts — kept current on insert/evict. */
  private readonly tallies = new Map<
    string,
    {
      total: number;
      unknown: number;
      operational: number;
      degraded: number;
      unavailable: number;
    }
  >();
  /**
   * Latest known coverage per custodian — point-in-time, NOT
   * aggregated. Updated by every known sample; unset until the
   * first known sample lands. Survives ring-buffer eviction
   * because it's a "current state" indicator, not a windowed rate.
   */
  private readonly latestKnown = new Map<
    string,
    {
      coverage: bigint;
      currency: string;
      slaStatus: LiabilitySlaStatus;
    }
  >();
  /** Latest `capturedAt` per custodian (known OR unknown). */
  private readonly latestAt = new Map<string, number>();
  /**
   * Lifetime tallies — monotonic counters for every sample ever
   * recorded. NOT subject to ring-buffer eviction so dashboards
   * can chart cumulative attestation activity honestly (mirrors
   * the `costs` map in SolverGasHistogram).
   */
  private readonly lifetimeTallies = new Map<
    string,
    {
      knownTotal: number;
      unknownTotal: number;
      operational: number;
      degraded: number;
      unavailable: number;
    }
  >();
  /**
   * "Last exported" snapshots for Counter delta computation —
   * mirrors the same trick in SolverGasHistogram. `Counter.add()`
   * takes deltas, so we emit `current - last` on each export call.
   * Calling `exportToMeter()` twice without new samples emits
   * zero deltas (reentrant).
   */
  private readonly lastExportedKnown = new Map<string, number>();
  private readonly lastExportedUnknown = new Map<string, number>();
  private readonly lastExportedStatus = new Map<
    string,
    Record<LiabilitySlaStatus, number>
  >();

  constructor(config: CustodianLiabilityHistogramConfig = {}) {
    const windowSize = config.windowSize ?? DEFAULT_WINDOW_SIZE;
    if (!Number.isInteger(windowSize) || windowSize <= 0) {
      throw new Error(
        `CustodianLiabilityHistogram: windowSize must be a positive integer, got ${windowSize}`,
      );
    }
    this.windowSize = windowSize;
  }

  /**
   * Record a single liability-snapshot sample. No-op when the sample
   * lacks a `custodianId` (defensive — callers should skip absent
   * samples via `liabilitySnapshotToSample` returning null).
   */
  record(sample: LiabilitySnapshotSample): void {
    if (!sample.custodianId) return;
    const cid = sample.custodianId;

    let buf = this.buffers.get(cid);
    if (!buf) {
      buf = [];
      this.buffers.set(cid, buf);
    }
    let tally = this.tallies.get(cid);
    if (!tally) {
      tally = { total: 0, unknown: 0, operational: 0, degraded: 0, unavailable: 0 };
      this.tallies.set(cid, tally);
    }

    // Evict oldest when at capacity. The tally is decremented before
    // we increment for the new sample so the totals stay consistent.
    if (buf.length >= this.windowSize) {
      const dropped = buf.shift()!;
      tally.total -= 1;
      if (dropped.unknown) {
        tally.unknown -= 1;
      } else if (dropped.slaStatus) {
        tally[dropped.slaStatus] -= 1;
      }
    }

    const entry: RingEntry = sample.liabilityUnknown
      ? { unknown: true }
      : sample.slaStatus
      ? { unknown: false, slaStatus: sample.slaStatus }
      : { unknown: false };
    buf.push(entry);
    tally.total += 1;
    if (entry.unknown) {
      tally.unknown += 1;
    } else if (entry.slaStatus) {
      tally[entry.slaStatus] += 1;
    }

    // Latest known coverage is point-in-time, not windowed. Update
    // it whenever the sample carries fresh coverage data.
    if (
      !sample.liabilityUnknown &&
      typeof sample.insuranceCoverage === "bigint" &&
      sample.insuranceCurrency &&
      sample.slaStatus
    ) {
      this.latestKnown.set(cid, {
        coverage: sample.insuranceCoverage,
        currency: sample.insuranceCurrency,
        slaStatus: sample.slaStatus,
      });
    }
    if (typeof sample.capturedAt === "number") {
      this.latestAt.set(cid, sample.capturedAt);
    }

    // Lifetime monotonic tallies — NOT subject to ring-buffer
    // eviction. These feed the Counter instruments in
    // `exportToMeter` so dashboards see "total attestations ever"
    // as a steady upward line per custodian.
    let lifetime = this.lifetimeTallies.get(cid);
    if (!lifetime) {
      lifetime = {
        knownTotal: 0,
        unknownTotal: 0,
        operational: 0,
        degraded: 0,
        unavailable: 0,
      };
      this.lifetimeTallies.set(cid, lifetime);
    }
    if (entry.unknown) {
      lifetime.unknownTotal += 1;
    } else {
      lifetime.knownTotal += 1;
      if (entry.slaStatus) {
        lifetime[entry.slaStatus] += 1;
      }
    }
  }

  /** Stats snapshot for a single custodian, or `null` if no samples. */
  snapshot(custodianId: string): PerCustodianLiabilityStats | null {
    const tally = this.tallies.get(custodianId);
    if (!tally || tally.total === 0) return null;
    const latest = this.latestKnown.get(custodianId);
    const latestTs = this.latestAt.get(custodianId);
    return {
      custodianId,
      total: tally.total,
      knownCount: tally.total - tally.unknown,
      unknownCount: tally.unknown,
      unknownRate: tally.unknown / tally.total,
      slaStatusCounts: {
        operational: tally.operational,
        degraded: tally.degraded,
        unavailable: tally.unavailable,
      },
      ...(latest
        ? {
            latestCoverage: latest.coverage,
            latestCoverageCurrency: latest.currency,
            latestSlaStatus: latest.slaStatus,
          }
        : {}),
      ...(typeof latestTs === "number" ? { latestAt: latestTs } : {}),
    };
  }

  /** Stats snapshots for every tracked custodian, keyed by id. */
  snapshots(): ReadonlyMap<string, PerCustodianLiabilityStats> {
    const out = new Map<string, PerCustodianLiabilityStats>();
    for (const cid of this.buffers.keys()) {
      const s = this.snapshot(cid);
      if (s) out.set(cid, s);
    }
    return out;
  }

  /** Number of distinct custodians tracked. */
  size(): number {
    return this.buffers.size;
  }

  /** Total samples across all custodians (after any evictions). */
  totalSamples(): number {
    let n = 0;
    for (const buf of this.buffers.values()) n += buf.length;
    return n;
  }

  /**
   * Drop all data. Useful for tests and for resetting at SLO
   * window boundaries.
   */
  reset(): void {
    this.buffers.clear();
    this.tallies.clear();
    this.latestKnown.clear();
    this.latestAt.clear();
    this.lifetimeTallies.clear();
    this.lastExportedKnown.clear();
    this.lastExportedUnknown.clear();
    this.lastExportedStatus.clear();
  }

  /**
   * Export the histogram's state into a `Meter` instance, surfacing
   * the SLI in Prometheus / OTLP scrape endpoints.
   *
   * **Windowed gauges** (point-in-time snapshots that change with
   * each export):
   *
   * | Metric | Unit | Meaning |
   * |---|---|---|
   * | `<prefix>_window_total` | 1 | Samples in the rolling window |
   * | `<prefix>_window_known_count` | 1 | Successful attestations in window |
   * | `<prefix>_window_unknown_count` | 1 | Failed attestations in window |
   * | `<prefix>_unknown_rate` | 1 (ratio) | unknownCount / total — the SLI |
   * | `<prefix>_window_status_count{status}` | 1 | Per-status count in window |
   * | `<prefix>_latest_coverage` | smallest currency unit | Point-in-time pool size |
   * | `<prefix>_latest_attestation_age_ms` | ms | now − latestAt |
   *
   * **Lifetime counters** (monotonic — `Counter.add()` takes deltas
   * so we emit `current − last_exported` on each call; reentrant):
   *
   * | Metric | Unit | Meaning |
   * |---|---|---|
   * | `<prefix>_attestations_total{outcome}` | 1 | Lifetime samples by outcome |
   * | `<prefix>_status_total{status}` | 1 | Lifetime samples by status |
   *
   * Coverage emitted as a Gauge (not a Counter) because it's a
   * point-in-time value, not a cumulative count — a drop must be
   * visible in the gauge value, not hidden in a delta.
   *
   * **Numeric range note:** bigint `latestCoverage` is converted via
   * `Number(x)`. \$500M in cents = 5e10, well below
   * `Number.MAX_SAFE_INTEGER` (≈9e15). Production deployments
   * tracking coverage in wei should rescale to cents/gwei or use a
   * string-based metric to avoid precision loss above 9e15.
   *
   * @example
   * ```ts
   * setInterval(() => histogram.exportToMeter(meter), 30_000);
   * // ...
   * res.end(meter.toPrometheus());
   * ```
   */
  exportToMeter(meter: Meter, options: CustodianLiabilityExportOptions = {}): void {
    const prefix = options.prefix ?? DEFAULT_PREFIX;
    const labelKey = options.labelKey ?? DEFAULT_LABEL_KEY;
    const extraLabels = options.extraLabels;
    const now = options.now ?? Date.now;

    // Memoize instrument lookups inside one call (the Meter caches
    // internally too; this saves a Map lookup per custodian per metric).
    const g = (name: string, desc: string, unit: string) =>
      meter.gauge(`${prefix}_${name}`, desc, unit);
    const c = (name: string, desc: string, unit: string) =>
      meter.counter(`${prefix}_${name}`, desc, unit);

    const totalG = g("window_total", "Samples in the current rolling window per custodian", "1");
    const knownG = g("window_known_count", "Successful attestations in the window per custodian", "1");
    const unknownG = g("window_unknown_count", "Failed attestations in the window per custodian", "1");
    const unknownRateG = g("unknown_rate", "Fraction of recent attestations that failed (the SLI)", "1");
    const statusCountG = g("window_status_count", "Per-status count in the window per custodian", "1");
    const coverageG = g("latest_coverage", "Most recent insurance pool size per custodian (point-in-time)", "1");
    const ageG = g("latest_attestation_age_ms", "Milliseconds since the most recent attestation attempt", "ms");

    const attestationsC = c(
      "attestations_total",
      "Lifetime count of attestation attempts per custodian, by outcome (known|unknown)",
      "1",
    );
    const statusC = c(
      "status_total",
      "Lifetime count of attestations per custodian, by SLA status",
      "1",
    );

    // Emit one snapshot per tracked custodian. Use `snapshots()`
    // rather than iterating buffers directly so all consumers see
    // the same canonical shape.
    for (const [custodianId, stats] of this.snapshots()) {
      const baseLabels = {
        ...(extraLabels ?? {}),
        [labelKey]: custodianId,
      };
      totalG.set(stats.total, baseLabels);
      knownG.set(stats.knownCount, baseLabels);
      unknownG.set(stats.unknownCount, baseLabels);
      unknownRateG.set(stats.unknownRate, baseLabels);

      for (const status of ALL_STATUSES) {
        statusCountG.set(stats.slaStatusCounts[status], {
          ...baseLabels,
          status,
        });
      }

      if (typeof stats.latestCoverage === "bigint") {
        coverageG.set(Number(stats.latestCoverage), {
          ...baseLabels,
          ...(stats.latestCoverageCurrency
            ? { currency: stats.latestCoverageCurrency }
            : {}),
        });
      }

      if (typeof stats.latestAt === "number") {
        const ageMs = Math.max(0, now() - stats.latestAt);
        ageG.set(ageMs, baseLabels);
      }

      // Counter deltas — emit only the increase since the last
      // export call. Mirrors SolverGasHistogram's cost-counter trick.
      const lifetime = this.lifetimeTallies.get(custodianId);
      if (!lifetime) continue;

      const lastKnown = this.lastExportedKnown.get(custodianId) ?? 0;
      const knownDelta = lifetime.knownTotal - lastKnown;
      if (knownDelta > 0) {
        attestationsC.add(knownDelta, { ...baseLabels, outcome: "known" });
        this.lastExportedKnown.set(custodianId, lifetime.knownTotal);
      }

      const lastUnknown = this.lastExportedUnknown.get(custodianId) ?? 0;
      const unknownDelta = lifetime.unknownTotal - lastUnknown;
      if (unknownDelta > 0) {
        attestationsC.add(unknownDelta, { ...baseLabels, outcome: "unknown" });
        this.lastExportedUnknown.set(custodianId, lifetime.unknownTotal);
      }

      const lastStatus =
        this.lastExportedStatus.get(custodianId) ??
        ({ operational: 0, degraded: 0, unavailable: 0 } as Record<
          LiabilitySlaStatus,
          number
        >);
      const newStatus: Record<LiabilitySlaStatus, number> = {
        operational: lastStatus.operational,
        degraded: lastStatus.degraded,
        unavailable: lastStatus.unavailable,
      };
      for (const status of ALL_STATUSES) {
        const delta = lifetime[status] - lastStatus[status];
        if (delta > 0) {
          statusC.add(delta, { ...baseLabels, status });
          newStatus[status] = lifetime[status];
        }
      }
      this.lastExportedStatus.set(custodianId, newStatus);
    }
  }
}

// ─── Projection helper ────────────────────────────────────────────

/**
 * Project a `LiabilitySnapshotEvent`-shaped record (from
 * `@aethelred/wallet-custody-adapters`) to a
 * {@link LiabilitySnapshotSample}.
 *
 * Generic over the event shape so consumers don't need to import
 * the concrete type — any `{ custodianId, liabilityUnknown, ... }`
 * shape works. Returns `null` when `custodianId` is missing or
 * malformed (defensive — callers can skip null at the record site).
 *
 * The function intentionally tolerates the audit-event variant
 * where the snapshot is nested under `detail` (the shape
 * `recordLiabilitySnapshot` emits) — checks both top-level and
 * `event.detail.attestation` forms.
 */
export function liabilitySnapshotToSample<
  T extends {
    readonly custodianId?: unknown;
    readonly liabilityUnknown?: unknown;
    readonly attestation?: unknown;
    readonly capturedAt?: unknown;
    readonly detail?: unknown;
  },
>(event: T): LiabilitySnapshotSample | null {
  // Audit-event variant — fields live under `event.detail`.
  const inner =
    event.detail && typeof event.detail === "object"
      ? (event.detail as Record<string, unknown>)
      : (event as Record<string, unknown>);

  const custodianId = inner.custodianId;
  if (typeof custodianId !== "string" || custodianId.length === 0) return null;

  const liabilityUnknown = inner.liabilityUnknown === true;
  const capturedAt =
    typeof inner.capturedAt === "number" ? inner.capturedAt : undefined;

  if (liabilityUnknown) {
    return {
      custodianId,
      liabilityUnknown: true,
      ...(capturedAt !== undefined ? { capturedAt } : {}),
    };
  }

  // Known path — look for attestation fields, either top-level or
  // nested under `attestation`.
  const att =
    inner.attestation && typeof inner.attestation === "object"
      ? (inner.attestation as Record<string, unknown>)
      : inner;
  const slaStatus = isSlaStatus(att.slaStatus) ? att.slaStatus : undefined;
  const insuranceCoverage =
    typeof att.insuranceCoverage === "bigint" ? att.insuranceCoverage : undefined;
  const insuranceCurrency =
    typeof att.insuranceCurrency === "string" ? att.insuranceCurrency : undefined;

  return {
    custodianId,
    liabilityUnknown: false,
    ...(slaStatus !== undefined ? { slaStatus } : {}),
    ...(insuranceCoverage !== undefined ? { insuranceCoverage } : {}),
    ...(insuranceCurrency !== undefined ? { insuranceCurrency } : {}),
    ...(capturedAt !== undefined ? { capturedAt } : {}),
  };
}

function isSlaStatus(value: unknown): value is LiabilitySlaStatus {
  return value === "operational" || value === "degraded" || value === "unavailable";
}
