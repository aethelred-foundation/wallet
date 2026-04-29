/**
 * `audit-metrics-bridge` — wire the audit package's
 * `AuditMetricsRecorder` interface (PRs #107, #108) to a meter
 * implementation from `@aethelred/wallet-observability` (PR #110).
 *
 * Why this lives in the extension and not in the audit package:
 * the audit package keeps a narrow dependency surface (no hard
 * dep on `@aethelred/wallet-observability`). The bridge depends
 * on BOTH packages, so it lives downstream of both. Other
 * consumers wanting the same wiring (web app, headless scripts,
 * future packages) either import this module directly OR
 * duplicate the ~30 lines.
 *
 * The factory builds four counters following the names in
 * `docs/compliance/OBSERVABILITY_SCOPE.md` §3.12:
 *
 *   - `audit_chain_integrity_broken_total` (P1 — tamper signal)
 *   - `audit_chain_link_mismatch_total` (P2/P1 — gap signal)
 *   - `audit_storage_write_failed_total` (Hypothesis A leading
 *     indicator from `docs/runbooks/audit-trail-gap.md`)
 *   - `audit_storage_read_failed_total`
 *
 * The recorder methods translate the audit package's
 * `AuditChainBreakDetails` / `AuditStorageFailureDetails`
 * payloads to counter labels (`subject_id`, `workspace_id`,
 * `operation`). Operators wanting additional labels (host,
 * region, deploy-version, etc.) pass them via `defaultLabels`;
 * those labels merge with per-event labels at counter-add time.
 */

import {
  type AuditChainBreakDetails,
  type AuditMetricsRecorder,
  type AuditStorageFailureDetails,
} from "@aethelred/wallet-audit";
import {
  type Meter,
  type PeriodicMetricsExporter,
} from "@aethelred/wallet-observability";

// ─── Counter naming constants ──────────────────────────────

/** P1 — stored hash mismatch (tamper signal). */
export const AUDIT_CHAIN_INTEGRITY_BROKEN_METRIC =
  "audit_chain_integrity_broken_total";

/** P2 default — previousHash chain mismatch (gap signal). */
export const AUDIT_CHAIN_LINK_MISMATCH_METRIC =
  "audit_chain_link_mismatch_total";

/** Hypothesis-A leading indicator — `AuditStore.persist`/`rotateKey` failure. */
export const AUDIT_STORAGE_WRITE_FAILED_METRIC =
  "audit_storage_write_failed_total";

/** `AuditStore.initialize` couldn't read from any configured storage path. */
export const AUDIT_STORAGE_READ_FAILED_METRIC =
  "audit_storage_read_failed_total";

// ─── Factory ───────────────────────────────────────────────

export interface BuildAuditMetricsRecorderOptions {
  /** Meter to register counters against. */
  readonly meter: Meter;
  /**
   * Labels that get merged into every counter increment. Useful for
   * service-level labels (`service: "wallet-extension-background"`,
   * `region: "us-east-1"`, etc.) that don't vary per-event.
   *
   * Per-event labels (`subject_id`, `workspace_id`, `operation`)
   * extend / overlap these defaults at increment time.
   */
  readonly defaultLabels?: Readonly<Record<string, string>>;
}

/**
 * Build an `AuditMetricsRecorder` that emits to four
 * counters on the supplied meter. The recorder is the standard
 * way to wire the audit package's observability into the
 * extension's observability stack.
 *
 * @example
 * ```ts
 * const meter = new InMemoryMeter();
 * const recorder = buildAuditMetricsRecorder({
 *   meter,
 *   defaultLabels: { service: "wallet-extension-background" },
 * });
 * const store = new AuditStore(storage, undefined, null, recorder);
 * ```
 */
export function buildAuditMetricsRecorder(
  options: BuildAuditMetricsRecorderOptions,
): AuditMetricsRecorder {
  const { meter, defaultLabels = {} } = options;

  const tamper = meter.counter(
    AUDIT_CHAIN_INTEGRITY_BROKEN_METRIC,
    "Audit events whose stored hash didn't match recompute (tamper signal)",
  );
  const gaps = meter.counter(
    AUDIT_CHAIN_LINK_MISMATCH_METRIC,
    "Audit events whose previousHash didn't match neighbor's eventHash (gap signal)",
  );
  const writeFailed = meter.counter(
    AUDIT_STORAGE_WRITE_FAILED_METRIC,
    "AuditStore.persist or rotateKey couldn't complete a storage set()",
  );
  const readFailed = meter.counter(
    AUDIT_STORAGE_READ_FAILED_METRIC,
    "AuditStore.initialize couldn't read from any configured storage path",
  );

  const chainLabels = (
    details: AuditChainBreakDetails,
  ): Record<string, string> => ({
    ...defaultLabels,
    subject_id: details.subjectId,
    workspace_id: details.workspaceId,
  });

  const storageLabels = (
    details: AuditStorageFailureDetails,
  ): Record<string, string> => ({
    ...defaultLabels,
    operation: details.operation,
  });

  return {
    recordChainIntegrityBroken(details) {
      tamper.add(1, chainLabels(details));
    },
    recordChainLinkMismatch(details) {
      gaps.add(1, chainLabels(details));
    },
    recordStorageWriteFailed(details) {
      writeFailed.add(1, storageLabels(details));
    },
    recordStorageReadFailed(details) {
      readFailed.add(1, storageLabels(details));
    },
  };
}

// ─── Pre-eviction flush handler (PR #112) ──────────────────

/**
 * Build a service-worker suspend handler that flushes the
 * periodic exporter (best-effort) and stops the timer before
 * Chrome terminates the SW (PR #112).
 *
 * **Why this matters.** PR #111's `PeriodicMetricsExporter`
 * pushes counters every 60 seconds. Without a pre-eviction
 * flush, in-flight increments since the last successful tick
 * (up to ~60 seconds of data) are lost on SW eviction. This
 * handler narrows that window to the time between
 * `chrome.runtime.onSuspend` firing and Chrome actually
 * terminating the worker.
 *
 * **Best-effort, not guaranteed.** `chrome.runtime.onSuspend`
 * fires before SW termination, but Chrome does NOT await async
 * work the listener kicks off. Our `flush()` returns a Promise;
 * if Chrome terminates the SW before the fetch completes, we
 * still lose those increments. The "best-effort" framing is
 * intentional — this PR meaningfully shrinks the loss window
 * but doesn't eliminate it.
 *
 * **Sequence: flush first, then stop.** `stop()` MUST run
 * synchronously after kicking off `flush()`, because:
 *   - flush returns a Promise that we don't await (Chrome
 *     wouldn't wait anyway)
 *   - if flush rejects, we still need to clear the timer to
 *     prevent it racing against SW unload
 *   - `stop()` itself is synchronous (`clearInterval`)
 *
 * Returns a no-op handler when `exporter` is null (the
 * default OSS posture from PR #111 when
 * `VITE_AUDIT_METRICS_OTLP_URL` is unset).
 *
 * @example
 * ```ts
 * const handler = buildAuditMetricsSuspendHandler(auditMetricsExporter);
 * if (typeof chrome !== "undefined" && chrome.runtime?.onSuspend) {
 *   chrome.runtime.onSuspend.addListener(handler);
 * }
 * ```
 */
export function buildAuditMetricsSuspendHandler(
  exporter: PeriodicMetricsExporter | null,
  onError: (error: unknown) => void = () => {},
): () => void {
  return () => {
    if (exporter === null) return;
    // Kick off the flush — don't await. Chrome doesn't wait for
    // listener async work, so awaiting here would only delay
    // `stop()` without changing flush success probability.
    exporter.flush().catch(onError);
    // Stop the timer synchronously, regardless of whether flush
    // resolved or rejected. Prevents a final tick racing against
    // SW unload.
    exporter.stop();
  };
}

// ─── Snapshot bridge (PR #115) ─────────────────────────────

/**
 * Structured snapshot of the audit meter's current state plus
 * exporter status — used by the popup-side debug surface to
 * visualize counters without requiring a deployed OTLP collector.
 *
 * The snapshot is a simple JSON-serializable shape so it
 * crosses the bridge cleanly. Counter values are point-in-time;
 * the popup polls or refreshes manually.
 */
export interface AuditMetricsSnapshot {
  /**
   * One entry per registered counter. Each entry includes the
   * counter's metric name and an array of `{labels, value}` pairs
   * (one per distinct label set encountered).
   *
   * Empty array for counters that have never been incremented
   * (no operational events have fired since SW instantiation).
   */
  readonly counters: Array<{
    readonly name: string;
    readonly description: string;
    readonly series: Array<{
      readonly labels: Record<string, string>;
      readonly value: number;
    }>;
  }>;

  /**
   * Whether the periodic OTLP exporter is currently running
   * (`isRunning()` true). Operators reading this snapshot from
   * the popup can confirm the export pipeline is healthy.
   *
   * `false` either means:
   *   - `VITE_AUDIT_METRICS_OTLP_URL` is unset (default OSS posture)
   *   - The exporter was constructed but `stop()` has been called
   *     (typically by the pre-eviction handler from PR #112)
   */
  readonly exporterRunning: boolean;

  /**
   * Configured OTLP URL, if any. Useful for the popup to display
   * "Pushing to: https://collector.example.com" or "Local-only
   * mode" status.
   */
  readonly otlpUrl: string | undefined;

  /** Unix-ms timestamp when this snapshot was captured. */
  readonly capturedAt: number;
}

/**
 * Bridge message kind for popup → background snapshot requests.
 * The popup sends a message with this `kind`; background responds
 * with an `AuditMetricsSnapshot` payload.
 */
export const AUDIT_METRICS_SNAPSHOT_KIND = "get-audit-metrics" as const;

/**
 * Capture a point-in-time snapshot of the audit meter.
 *
 * Reads the four canonical audit counters by their metric names
 * (defined as constants above); for each counter, walks its
 * series and produces a flat `{labels, value}` array.
 *
 * The function is generic over `Meter` (not `InMemoryMeter`-
 * specific) but uses the `getCounter` escape hatch which is
 * specific to InMemoryMeter. Production callers with a different
 * meter implementation provide their own snapshot helper.
 */
export function getAuditMetricsSnapshot(
  meter: import("@aethelred/wallet-observability").InMemoryMeter,
  exporter: PeriodicMetricsExporter | null,
  otlpUrl: string | undefined,
): AuditMetricsSnapshot {
  const counterNames: Array<{ name: string; description: string }> = [
    {
      name: AUDIT_CHAIN_INTEGRITY_BROKEN_METRIC,
      description: "Tamper signal — stored hash didn't match recompute",
    },
    {
      name: AUDIT_CHAIN_LINK_MISMATCH_METRIC,
      description: "Gap signal — previousHash didn't match neighbor's eventHash",
    },
    {
      name: AUDIT_STORAGE_WRITE_FAILED_METRIC,
      description: "AuditStore.persist or rotateKey couldn't complete",
    },
    {
      name: AUDIT_STORAGE_READ_FAILED_METRIC,
      description: "AuditStore.initialize couldn't read from any storage path",
    },
  ];

  const counters = counterNames.map(({ name, description }) => {
    const counter = meter.getCounter(name);
    if (!counter) {
      return { name, description, series: [] };
    }
    const series: Array<{
      labels: Record<string, string>;
      value: number;
    }> = [];
    for (const entry of counter.values.values()) {
      series.push({ labels: { ...entry.labels }, value: entry.value });
    }
    return { name, description, series };
  });

  return {
    counters,
    exporterRunning: exporter?.isRunning() ?? false,
    otlpUrl,
    capturedAt: Date.now(),
  };
}
