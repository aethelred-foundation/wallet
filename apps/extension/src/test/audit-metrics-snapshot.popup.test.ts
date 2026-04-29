/**
 * Tests for the popup-side audit metrics snapshot helper (PR #116).
 *
 * Two layers:
 *
 *   1. **`fetchAuditMetricsSnapshot`** — the bridge-call wrapper.
 *      Verifies it constructs the right `BridgeMessage`, parses
 *      the response envelope, and surfaces errors (chrome.runtime
 *      lastError, missing result, error in envelope).
 *
 *   2. **`snapshotTotalEvents`** — aggregate utility. Verifies
 *      it sums correctly across all four counters' series.
 *
 * The React hook `useAuditMetrics` is integration-tested via
 * the underlying `fetchAuditMetricsSnapshot` — running React in
 * vitest needs a separate harness that's overkill for this PR.
 * Hook surface is verified by type-check; the polling logic is
 * straightforward `setInterval`-driven and would need React
 * Testing Library coverage in a follow-up.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import {
  fetchAuditMetricsSnapshot,
  snapshotTotalEvents,
} from "../popup/lib/audit-metrics-snapshot";
import type { AuditMetricsSnapshot } from "../lib/audit-metrics-bridge";

// ─── Layer 1: fetchAuditMetricsSnapshot ────────────────────

describe("fetchAuditMetricsSnapshot (PR #116)", () => {
  let originalChrome: unknown;

  beforeEach(() => {
    originalChrome = (globalThis as { chrome?: unknown }).chrome;
  });

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
    vi.restoreAllMocks();
  });

  function setupChromeStub(
    handler: (msg: unknown, cb: (response: unknown) => void) => void,
  ): void {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        id: "test-extension",
        sendMessage: handler,
        lastError: undefined as { message: string } | undefined,
      },
    };
  }

  function makeFakeSnapshot(): AuditMetricsSnapshot {
    return {
      counters: [
        {
          name: "audit_chain_integrity_broken_total",
          description: "Tamper signal",
          series: [],
        },
        {
          name: "audit_chain_link_mismatch_total",
          description: "Gap signal",
          series: [],
        },
        {
          name: "audit_storage_write_failed_total",
          description: "Storage write",
          series: [
            { labels: { service: "test", operation: "persist" }, value: 3 },
          ],
        },
        {
          name: "audit_storage_read_failed_total",
          description: "Storage read",
          series: [],
        },
      ],
      exporterRunning: false,
      otlpUrl: undefined,
      capturedAt: 1_700_000_000_000,
    };
  }

  it("sends the right bridge message + parses snapshot from response", async () => {
    let observedKind = "";
    const expected = makeFakeSnapshot();
    setupChromeStub((msg, cb) => {
      observedKind = (msg as { kind: string }).kind;
      cb({ payload: { result: expected } });
    });

    const snapshot = await fetchAuditMetricsSnapshot();
    expect(observedKind).toBe("get-audit-metrics");
    expect(snapshot.counters[2].series[0].value).toBe(3);
    expect(snapshot.exporterRunning).toBe(false);
  });

  it("rejects when chrome.runtime is not available (dev/test context)", async () => {
    (globalThis as { chrome?: unknown }).chrome = undefined;
    await expect(fetchAuditMetricsSnapshot()).rejects.toThrow(
      /chrome\.runtime not available/i,
    );
  });

  it("rejects when chrome.runtime.id is unset (uninitialized context)", async () => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { id: undefined, sendMessage: () => {}, lastError: undefined },
    };
    await expect(fetchAuditMetricsSnapshot()).rejects.toThrow(
      /chrome\.runtime not available/i,
    );
  });

  it("rejects when chrome.runtime.lastError is set after sendMessage", async () => {
    setupChromeStub((_msg, cb) => {
      (
        (globalThis as { chrome?: { runtime?: { lastError?: { message: string } } } }).chrome!
          .runtime!
      ).lastError = { message: "extension context invalidated" };
      cb({});
    });
    await expect(fetchAuditMetricsSnapshot()).rejects.toThrow(
      /extension context invalidated/i,
    );
  });

  it("rejects when response payload contains error", async () => {
    setupChromeStub((_msg, cb) => {
      cb({ payload: { error: { message: "background handler failed" } } });
    });
    await expect(fetchAuditMetricsSnapshot()).rejects.toThrow(
      /background handler failed/i,
    );
  });

  it("rejects when response payload is missing result", async () => {
    setupChromeStub((_msg, cb) => {
      cb({ payload: {} });
    });
    await expect(fetchAuditMetricsSnapshot()).rejects.toThrow(
      /missing result/i,
    );
  });

  it("constructs a unique correlationId per call", async () => {
    const observedIds: string[] = [];
    setupChromeStub((msg, cb) => {
      observedIds.push((msg as { correlationId: string }).correlationId);
      cb({ payload: { result: makeFakeSnapshot() } });
    });

    await fetchAuditMetricsSnapshot();
    // Tiny delay to ensure Date.now() differs.
    await new Promise((r) => setTimeout(r, 2));
    await fetchAuditMetricsSnapshot();
    expect(observedIds[0]).not.toBe(observedIds[1]);
    expect(observedIds[0]).toMatch(/^get-audit-metrics-/);
  });
});

// ─── Layer 2: snapshotTotalEvents ──────────────────────────

describe("snapshotTotalEvents (PR #116)", () => {
  it("sums values across all counters' series", () => {
    const snapshot: AuditMetricsSnapshot = {
      counters: [
        {
          name: "a",
          description: "",
          series: [
            { labels: {}, value: 1 },
            { labels: {}, value: 2 },
          ],
        },
        {
          name: "b",
          description: "",
          series: [{ labels: {}, value: 5 }],
        },
        {
          name: "c",
          description: "",
          series: [],
        },
        {
          name: "d",
          description: "",
          series: [{ labels: {}, value: 10 }],
        },
      ],
      exporterRunning: false,
      otlpUrl: undefined,
      capturedAt: 0,
    };
    expect(snapshotTotalEvents(snapshot)).toBe(18);
  });

  it("returns 0 for fresh snapshot (all empty series)", () => {
    const snapshot: AuditMetricsSnapshot = {
      counters: [
        { name: "a", description: "", series: [] },
        { name: "b", description: "", series: [] },
      ],
      exporterRunning: false,
      otlpUrl: undefined,
      capturedAt: 0,
    };
    expect(snapshotTotalEvents(snapshot)).toBe(0);
  });
});
