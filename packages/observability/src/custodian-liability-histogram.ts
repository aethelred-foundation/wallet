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

/**
 * SLA-status as reported by the custodian's oracle. Mirrors
 * `CustodianSlaStatus` in `@aethelred/wallet-custody-adapters` but
 * declared here so observability doesn't depend on custody-adapters.
 */
export type LiabilitySlaStatus = "operational" | "degraded" | "unavailable";

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

const DEFAULT_WINDOW_SIZE = 1024;

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
