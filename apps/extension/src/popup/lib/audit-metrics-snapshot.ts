/**
 * `popup/lib/audit-metrics-snapshot` — popup-side helper for the
 * `get-audit-metrics` bridge message (PR #115).
 *
 * Wraps the bridge call into a typed promise + a React hook so
 * popup-side diagnostics surfaces (developer-tools view, dedicated
 * audit-metrics panel, etc.) consume the snapshot with consistent
 * error handling.
 *
 * Out of scope here: UI rendering of the snapshot. This module
 * provides the data plumbing; consumers handle layout. See
 * `useAuditMetrics()` below for the React-friendly entry point.
 */

import { useCallback, useEffect, useState } from "react";

import {
  AUDIT_METRICS_SNAPSHOT_KIND,
  type AuditMetricsSnapshot,
} from "../../lib/audit-metrics-bridge";

/**
 * Bridge response envelope around a snapshot. Background's
 * `respond()` helper wraps the result; we type-narrow here.
 */
interface SnapshotBridgeResponse {
  readonly result?: AuditMetricsSnapshot;
  readonly error?: { readonly message: string };
}

/**
 * Send the bridge message and return the snapshot. Throws on
 * bridge error or missing result. Callers wrap with try/catch
 * (or use `useAuditMetrics` for React-friendly state).
 */
export async function fetchAuditMetricsSnapshot(): Promise<AuditMetricsSnapshot> {
  // We avoid taking a hard dep on `useBackground`'s impl details so
  // this helper is testable in isolation. Direct `chrome.runtime`
  // call mirrors the use-background hook's pattern.
  if (
    typeof chrome === "undefined" ||
    typeof chrome.runtime === "undefined" ||
    !chrome.runtime.id
  ) {
    throw new Error(
      "fetchAuditMetricsSnapshot: chrome.runtime not available (dev / test context)",
    );
  }

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        kind: AUDIT_METRICS_SNAPSHOT_KIND,
        correlationId: `${AUDIT_METRICS_SNAPSHOT_KIND}-${Date.now()}`,
        payload: undefined,
        timestamp: Date.now(),
      },
      (response: { payload?: SnapshotBridgeResponse }) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const envelope = response?.payload;
        if (envelope?.error) {
          reject(new Error(envelope.error.message));
          return;
        }
        if (!envelope?.result) {
          reject(new Error("audit-metrics snapshot response missing result"));
          return;
        }
        resolve(envelope.result);
      },
    );
  });
}

/**
 * Auto-refreshing hook for popup-side diagnostics surfaces.
 *
 * Polls the snapshot at the configured interval (default 5s);
 * stops polling on unmount. Returns `{ snapshot, error,
 * refresh, isLoading }` so consumers can render a refresh
 * button + spinner without local state.
 *
 * @param pollIntervalMs Auto-refresh interval. Set to 0 to
 *   disable polling (manual refresh only via the returned
 *   `refresh()` callback).
 */
export interface UseAuditMetricsResult {
  readonly snapshot: AuditMetricsSnapshot | null;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly refresh: () => Promise<void>;
}

export function useAuditMetrics(
  pollIntervalMs: number = 5_000,
): UseAuditMetricsResult {
  const [snapshot, setSnapshot] = useState<AuditMetricsSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await fetchAuditMetricsSnapshot();
      setSnapshot(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (pollIntervalMs <= 0) return;
    const handle = setInterval(() => void refresh(), pollIntervalMs);
    return () => clearInterval(handle);
  }, [refresh, pollIntervalMs]);

  return { snapshot, error, isLoading, refresh };
}

/**
 * Aggregate utility: total event count across all audit
 * counters in the snapshot. Useful for quick-glance "is anything
 * happening?" indicators in diagnostics UIs.
 */
export function snapshotTotalEvents(snapshot: AuditMetricsSnapshot): number {
  let total = 0;
  for (const counter of snapshot.counters) {
    for (const series of counter.series) {
      total += series.value;
    }
  }
  return total;
}
