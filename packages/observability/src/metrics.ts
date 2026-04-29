/**
 * Lightweight OpenTelemetry-compatible metrics primitives.
 *
 * Three instrument types, each picked for a specific SRE question:
 *   - Counter: monotonic tallies (requests served, errors emitted).
 *   - Gauge: last-write-wins snapshots (queue depth, active sessions).
 *   - Histogram: distributions with bucketed counts + sum + count for
 *     computing percentiles.
 *
 * Labels are small stable dimensions (chainId, method, outcome) — never
 * high-cardinality values. `Meter.counter` etc. memoize by name so the
 * same instrument can be resolved from multiple call sites.
 *
 * @example
 * ```ts
 * const meter = new InMemoryMeter();
 * const errors = meter.counter("rpc.errors", "RPC calls that returned an error", "1");
 * errors.add(1, { chain_id: "0x1", method: "eth_call" });
 *
 * const latency = meter.histogram("rpc.latency", "RPC call latency", "ms", DEFAULT_LATENCY_BUCKETS);
 * latency.record(42, { chain_id: "0x1" });
 * ```
 */

/**
 * Default histogram buckets for latency in milliseconds — chosen to span
 * sub-millisecond audit hashing through ~30s RPC timeouts, with enough
 * resolution in the 1–500ms range that matters for UX SLOs.
 */
export const DEFAULT_LATENCY_BUCKETS = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000,
];

/**
 * A labelled monotonic counter.
 *
 * @example
 * ```ts
 * const sent = meter.counter("tx.sent");
 * sent.add(1, { chain_id: "0x1", outcome: "success" });
 * ```
 */
export interface Counter {
  add(value: number, labels?: Record<string, string>): void;
  getValue(labels?: Record<string, string>): number;
}

/**
 * A labelled gauge — last-write-wins.
 *
 * @example
 * ```ts
 * const queueDepth = meter.gauge("workflow.queue_depth");
 * queueDepth.set(17, { workspace_id: "ws-main" });
 * ```
 */
export interface Gauge {
  set(value: number, labels?: Record<string, string>): void;
  getValue(labels?: Record<string, string>): number | undefined;
}

/**
 * A labelled histogram producing bucketed counts plus count + sum.
 *
 * @example
 * ```ts
 * const rpcLatency = meter.histogram("rpc.latency", "RPC latency", "ms");
 * rpcLatency.record(120, { method: "eth_call" });
 * ```
 */
export interface Histogram {
  record(value: number, labels?: Record<string, string>): void;
  getSnapshot(labels?: Record<string, string>): HistogramSnapshot | undefined;
}

/** Immutable histogram snapshot. */
export interface HistogramSnapshot {
  count: number;
  sum: number;
  buckets: Array<{ le: number; count: number }>;
}

/**
 * Primary meter API. Instruments are memoized by name; calling counter()
 * twice with the same name returns the same instrument.
 */
export interface Meter {
  counter(name: string, description?: string, unit?: string): Counter;
  gauge(name: string, description?: string, unit?: string): Gauge;
  histogram(name: string, description?: string, unit?: string, buckets?: number[]): Histogram;
  /** Serialize all instruments to OTLP/JSON payload. */
  toOtlpPayload(resource?: Record<string, string>): unknown;
  /** Serialize all instruments to Prometheus text exposition format. */
  toPrometheus(): string;
}

// ─── Label key computation ────────────────────────────────────────

/**
 * Build a stable key from labels for series indexing. Labels are sorted so
 * `{a:1,b:2}` and `{b:2,a:1}` coalesce.
 */
function labelsKey(labels?: Record<string, string>): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const parts: string[] = [];
  for (const key of keys) parts.push(`${key}=${labels[key]}`);
  return parts.join(",");
}

// ─── Counter ──────────────────────────────────────────────────────

class CounterImpl implements Counter {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly values = new Map<string, { labels: Record<string, string>; value: number }>();

  constructor(name: string, description: string, unit: string) {
    this.name = name;
    this.description = description;
    this.unit = unit;
  }

  add(value: number, labels?: Record<string, string>): void {
    if (value < 0) throw new Error(`Counter "${this.name}" cannot decrement (got ${value})`);
    const key = labelsKey(labels);
    const entry = this.values.get(key);
    if (entry) entry.value += value;
    else this.values.set(key, { labels: { ...(labels ?? {}) }, value });
  }

  getValue(labels?: Record<string, string>): number {
    return this.values.get(labelsKey(labels))?.value ?? 0;
  }
}

// ─── Gauge ────────────────────────────────────────────────────────

class GaugeImpl implements Gauge {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly values = new Map<string, { labels: Record<string, string>; value: number }>();

  constructor(name: string, description: string, unit: string) {
    this.name = name;
    this.description = description;
    this.unit = unit;
  }

  set(value: number, labels?: Record<string, string>): void {
    const key = labelsKey(labels);
    this.values.set(key, { labels: { ...(labels ?? {}) }, value });
  }

  getValue(labels?: Record<string, string>): number | undefined {
    return this.values.get(labelsKey(labels))?.value;
  }
}

// ─── Histogram ────────────────────────────────────────────────────

interface HistogramSeries {
  labels: Record<string, string>;
  count: number;
  sum: number;
  bucketCounts: number[];
}

class HistogramImpl implements Histogram {
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly buckets: number[];
  readonly series = new Map<string, HistogramSeries>();

  constructor(name: string, description: string, unit: string, buckets: number[]) {
    this.name = name;
    this.description = description;
    this.unit = unit;
    // Buckets MUST be sorted; last virtual bucket is +Inf (unbounded).
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  record(value: number, labels?: Record<string, string>): void {
    const key = labelsKey(labels);
    let series = this.series.get(key);
    if (!series) {
      series = {
        labels: { ...(labels ?? {}) },
        count: 0,
        sum: 0,
        bucketCounts: new Array(this.buckets.length + 1).fill(0),
      };
      this.series.set(key, series);
    }
    series.count += 1;
    series.sum += value;
    let placed = false;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        series.bucketCounts[i] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) series.bucketCounts[this.buckets.length] += 1;
  }

  getSnapshot(labels?: Record<string, string>): HistogramSnapshot | undefined {
    const series = this.series.get(labelsKey(labels));
    if (!series) return undefined;
    const bucketsOut = this.buckets.map((le, i) => ({ le, count: series.bucketCounts[i] }));
    bucketsOut.push({ le: Infinity, count: series.bucketCounts[this.buckets.length] });
    return { count: series.count, sum: series.sum, buckets: bucketsOut };
  }
}

// ─── InMemoryMeter ────────────────────────────────────────────────

/**
 * Production-grade in-memory meter. Instruments accumulate until exported.
 *
 * Designed for the extension service worker: low allocation, predictable
 * memory (each series keeps a fixed-size bucket array), and both OTLP/JSON
 * and Prometheus text output for flexible downstream collection.
 */
export class InMemoryMeter implements Meter {
  private readonly counters = new Map<string, CounterImpl>();
  private readonly gauges = new Map<string, GaugeImpl>();
  private readonly histograms = new Map<string, HistogramImpl>();

  counter(name: string, description = "", unit = "1"): Counter {
    let existing = this.counters.get(name);
    if (!existing) {
      existing = new CounterImpl(name, description, unit);
      this.counters.set(name, existing);
    }
    return existing;
  }

  gauge(name: string, description = "", unit = "1"): Gauge {
    let existing = this.gauges.get(name);
    if (!existing) {
      existing = new GaugeImpl(name, description, unit);
      this.gauges.set(name, existing);
    }
    return existing;
  }

  histogram(
    name: string,
    description = "",
    unit = "1",
    buckets: number[] = DEFAULT_LATENCY_BUCKETS
  ): Histogram {
    let existing = this.histograms.get(name);
    if (!existing) {
      existing = new HistogramImpl(name, description, unit, buckets);
      this.histograms.set(name, existing);
    }
    return existing;
  }

  /** Visible for tests: walk registered counters. */
  getCounter(name: string): CounterImpl | undefined {
    return this.counters.get(name);
  }

  /** Visible for tests: walk registered gauges. */
  getGauge(name: string): GaugeImpl | undefined {
    return this.gauges.get(name);
  }

  /** Visible for tests: walk registered histograms. */
  getHistogram(name: string): HistogramImpl | undefined {
    return this.histograms.get(name);
  }

  toOtlpPayload(resource: Record<string, string> = {}): unknown {
    const attrList = (attrs: Record<string, string>) =>
      Object.keys(attrs).map((key) => ({ key, value: { stringValue: attrs[key] } }));

    const timeNano = String(BigInt(Date.now()) * BigInt(1_000_000));
    const metrics: unknown[] = [];

    for (const counter of this.counters.values()) {
      metrics.push({
        name: counter.name,
        description: counter.description,
        unit: counter.unit,
        sum: {
          aggregationTemporality: 2, // CUMULATIVE
          isMonotonic: true,
          dataPoints: Array.from(counter.values.values()).map((entry) => ({
            attributes: attrList(entry.labels),
            timeUnixNano: timeNano,
            asDouble: entry.value,
          })),
        },
      });
    }

    for (const gauge of this.gauges.values()) {
      metrics.push({
        name: gauge.name,
        description: gauge.description,
        unit: gauge.unit,
        gauge: {
          dataPoints: Array.from(gauge.values.values()).map((entry) => ({
            attributes: attrList(entry.labels),
            timeUnixNano: timeNano,
            asDouble: entry.value,
          })),
        },
      });
    }

    for (const histogram of this.histograms.values()) {
      metrics.push({
        name: histogram.name,
        description: histogram.description,
        unit: histogram.unit,
        histogram: {
          aggregationTemporality: 2,
          dataPoints: Array.from(histogram.series.values()).map((series) => ({
            attributes: attrList(series.labels),
            timeUnixNano: timeNano,
            count: String(series.count),
            sum: series.sum,
            bucketCounts: series.bucketCounts.map(String),
            explicitBounds: histogram.buckets,
          })),
        },
      });
    }

    return {
      resourceMetrics: [
        {
          resource: { attributes: attrList(resource) },
          scopeMetrics: [
            {
              scope: { name: "@aethelred/wallet-observability", version: "0.1.0" },
              metrics,
            },
          ],
        },
      ],
    };
  }

  toPrometheus(): string {
    const lines: string[] = [];
    const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const renderLabels = (labels: Record<string, string>) => {
      const keys = Object.keys(labels).sort();
      if (keys.length === 0) return "";
      return `{${keys.map((k) => `${k}="${escape(labels[k])}"`).join(",")}}`;
    };

    for (const counter of this.counters.values()) {
      if (counter.description) lines.push(`# HELP ${counter.name} ${counter.description}`);
      lines.push(`# TYPE ${counter.name} counter`);
      for (const entry of counter.values.values()) {
        lines.push(`${counter.name}${renderLabels(entry.labels)} ${entry.value}`);
      }
    }

    for (const gauge of this.gauges.values()) {
      if (gauge.description) lines.push(`# HELP ${gauge.name} ${gauge.description}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      for (const entry of gauge.values.values()) {
        lines.push(`${gauge.name}${renderLabels(entry.labels)} ${entry.value}`);
      }
    }

    for (const histogram of this.histograms.values()) {
      if (histogram.description) lines.push(`# HELP ${histogram.name} ${histogram.description}`);
      lines.push(`# TYPE ${histogram.name} histogram`);
      for (const series of histogram.series.values()) {
        let cumulative = 0;
        for (let i = 0; i < histogram.buckets.length; i++) {
          cumulative += series.bucketCounts[i];
          const bucketLabels = { ...series.labels, le: String(histogram.buckets[i]) };
          lines.push(
            `${histogram.name}_bucket${renderLabels(bucketLabels)} ${cumulative}`
          );
        }
        cumulative += series.bucketCounts[histogram.buckets.length];
        const infLabels = { ...series.labels, le: "+Inf" };
        lines.push(`${histogram.name}_bucket${renderLabels(infLabels)} ${cumulative}`);
        lines.push(`${histogram.name}_sum${renderLabels(series.labels)} ${series.sum}`);
        lines.push(`${histogram.name}_count${renderLabels(series.labels)} ${series.count}`);
      }
    }

    return lines.join("\n") + (lines.length > 0 ? "\n" : "");
  }
}

/**
 * HTTP exporter for metrics. Mirrors OtlpHttpSpanExporter — same shape,
 * different payload.
 *
 * @example
 * ```ts
 * const meter = new InMemoryMeter();
 * const exporter = new OtlpMetricsExporter({ url: "https://collector/v1/metrics" });
 * setInterval(() => exporter.export(meter).catch(() => {}), 10_000);
 * ```
 */
export class OtlpMetricsExporter {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly resource: Record<string, string>;

  constructor(config: {
    url: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    resource?: Record<string, string>;
  }) {
    this.url = config.url;
    this.headers = { "content-type": "application/json", ...(config.headers ?? {}) };
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.resource = { ...(config.resource ?? {}) };
  }

  async export(meter: Meter): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const payload = meter.toOtlpPayload(this.resource);
      const response = await fetch(this.url, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OTLP metrics export failed: HTTP ${response.status}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async shutdown(): Promise<void> {}
}

/**
 * Periodic wrapper around `OtlpMetricsExporter` that pushes the
 * meter's accumulated state on a configurable interval (PR #111).
 *
 * Why this exists: `OtlpMetricsExporter` is one-shot — the caller
 * owns scheduling. For long-running consumers (extension service
 * workers, Node.js daemons), the natural pattern is "every N
 * seconds, push current state." This class formalizes that
 * pattern with `start()` / `stop()` / `flush()` lifecycle methods
 * and best-effort error handling so a failed export doesn't
 * break subsequent ticks.
 *
 * Counter semantics: each export sends the FULL CURRENT STATE
 * of the meter (cumulative). OTLP receivers handle the
 * cumulative-vs-delta distinction on their side via the
 * `aggregationTemporality: 2` field already set by
 * `Meter.toOtlpPayload`.
 *
 * @example
 * ```ts
 * const meter = new InMemoryMeter();
 * const exporter = new OtlpMetricsExporter({ url: process.env.OTLP_URL! });
 * const periodic = new PeriodicMetricsExporter({
 *   meter,
 *   exporter,
 *   intervalMs: 60_000,
 *   onError: (err) => console.error("[metrics] export failed", err),
 * });
 *
 * periodic.start();
 * // ... metrics accumulate ...
 * await periodic.flush();   // force-push outside the interval
 * periodic.stop();          // clear the interval timer
 * ```
 *
 * **Lifecycle gotchas:**
 *   - `stop()` does NOT flush — call `flush()` first if you want
 *     accumulated counters pushed before unmount.
 *   - `start()` is idempotent (calling twice is a no-op; the
 *     existing timer continues).
 *   - Errors during `export()` are caught and routed through
 *     `onError` (default: silently swallowed); they NEVER throw
 *     out of the periodic tick (which would unhandled-reject the
 *     interval callback).
 *   - Service-worker eviction: the interval timer is cleared by
 *     the runtime when the SW unloads, but in-flight exports
 *     may be aborted mid-fetch. Operators wanting pre-eviction
 *     flush wire `chrome.runtime.onSuspend` → `flush()`.
 */
export class PeriodicMetricsExporter {
  private readonly meter: Meter;
  private readonly exporter: OtlpMetricsExporter;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(config: {
    /** Meter whose state gets pushed on each tick. */
    readonly meter: Meter;
    /** Underlying one-shot exporter. */
    readonly exporter: OtlpMetricsExporter;
    /** Tick interval in milliseconds. Must be > 0. */
    readonly intervalMs: number;
    /**
     * Callback invoked when an export throws. Default: noop.
     * Operators wanting to surface export failures (alerting,
     * console logging) wire this — failed exports are silent
     * by default to avoid noise on transient network blips.
     */
    readonly onError?: (error: unknown) => void;
  }) {
    if (!Number.isFinite(config.intervalMs) || config.intervalMs <= 0) {
      throw new Error(
        `PeriodicMetricsExporter: intervalMs must be a positive finite number, got ${String(config.intervalMs)}`,
      );
    }
    this.meter = config.meter;
    this.exporter = config.exporter;
    this.intervalMs = config.intervalMs;
    this.onError = config.onError ?? (() => {});
  }

  /**
   * Start the periodic export loop. Idempotent — calling twice
   * does NOT schedule two timers.
   */
  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      this.exporter.export(this.meter).catch(this.onError);
    }, this.intervalMs);
  }

  /**
   * Stop the periodic export loop. Does NOT flush — call
   * `flush()` first if you want accumulated counters pushed
   * before stopping.
   */
  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Force-push the meter's current state outside the periodic
   * tick. Resolves on success, throws on failure. Operators
   * use this for pre-eviction / pre-shutdown flushes.
   */
  async flush(): Promise<void> {
    await this.exporter.export(this.meter);
  }

  /**
   * Test-only: report whether the periodic timer is active.
   * Production callers should not rely on this.
   */
  isRunning(): boolean {
    return this.timer !== undefined;
  }
}
