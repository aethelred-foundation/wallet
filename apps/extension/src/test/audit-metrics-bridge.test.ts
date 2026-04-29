/**
 * Tests for the audit-metrics bridge (PR #110).
 *
 * Two layers:
 *
 *   1. **Bridge factory** — given a `Meter`, the factory builds an
 *      `AuditMetricsRecorder` that ticks the right counter on each
 *      method, with default labels merged into per-event labels.
 *
 *   2. **End-to-end emission** — wires `InMemoryMeter` + bridge +
 *      `AuditStore` + faulty storage adapter; verifies that a
 *      persist failure produces an actual counter increment that
 *      surfaces in `meter.toPrometheus()`.
 *
 * The bridge is the production wiring path (used by the extension's
 * background service worker — see `background.ts`). These tests
 * validate the end-to-end emission story is real, not just
 * aspirational.
 */

import { describe, expect, it } from "vitest";

import {
  AuditCapture,
  AuditStore,
  type AuditEvent,
} from "@aethelred/wallet-audit";
import { InMemoryMeter } from "@aethelred/wallet-observability";

import { OtlpMetricsExporter, PeriodicMetricsExporter } from "@aethelred/wallet-observability";

import {
  buildAuditMetricsRecorder,
  buildAuditMetricsSuspendHandler,
  getAuditMetricsSnapshot,
  AUDIT_CHAIN_INTEGRITY_BROKEN_METRIC,
  AUDIT_CHAIN_LINK_MISMATCH_METRIC,
  AUDIT_STORAGE_WRITE_FAILED_METRIC,
  AUDIT_STORAGE_READ_FAILED_METRIC,
  AUDIT_METRICS_SNAPSHOT_KIND,
} from "../lib/audit-metrics-bridge";

// ─── Layer 1: bridge factory ───────────────────────────────

describe("buildAuditMetricsRecorder — counter wiring (PR #110)", () => {
  it("recorder methods tick the four expected counters", () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({ meter });

    recorder.recordChainIntegrityBroken({
      failedEventId: "evt-1",
      sequenceNumber: 1,
      workspaceId: "ws-test",
      subjectId: "subj-test",
    });
    recorder.recordChainLinkMismatch({
      failedEventId: "evt-2",
      sequenceNumber: 2,
      workspaceId: "ws-test",
      subjectId: "subj-test",
    });
    recorder.recordStorageWriteFailed({
      operation: "persist",
      sequenceNumber: 42,
    });
    recorder.recordStorageReadFailed({ operation: "initialize" });

    const tamper = meter.getCounter(AUDIT_CHAIN_INTEGRITY_BROKEN_METRIC);
    const gaps = meter.getCounter(AUDIT_CHAIN_LINK_MISMATCH_METRIC);
    const writeFailed = meter.getCounter(AUDIT_STORAGE_WRITE_FAILED_METRIC);
    const readFailed = meter.getCounter(AUDIT_STORAGE_READ_FAILED_METRIC);

    expect(tamper).toBeDefined();
    expect(gaps).toBeDefined();
    expect(writeFailed).toBeDefined();
    expect(readFailed).toBeDefined();

    // Each counter ticked exactly once with the right labels.
    expect(
      tamper!.getValue({ subject_id: "subj-test", workspace_id: "ws-test" }),
    ).toBe(1);
    expect(
      gaps!.getValue({ subject_id: "subj-test", workspace_id: "ws-test" }),
    ).toBe(1);
    expect(writeFailed!.getValue({ operation: "persist" })).toBe(1);
    expect(readFailed!.getValue({ operation: "initialize" })).toBe(1);
  });

  it("default labels merge into every counter increment", () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({
      meter,
      defaultLabels: { service: "wallet-bg", region: "us-east-1" },
    });

    recorder.recordStorageWriteFailed({
      operation: "persist",
      sequenceNumber: 1,
    });

    const counter = meter.getCounter(AUDIT_STORAGE_WRITE_FAILED_METRIC);
    // Default labels + per-event labels merged.
    expect(
      counter!.getValue({
        service: "wallet-bg",
        region: "us-east-1",
        operation: "persist",
      }),
    ).toBe(1);
  });

  it("multiple increments with the same labels accumulate", () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({ meter });

    for (let i = 0; i < 5; i++) {
      recorder.recordStorageWriteFailed({
        operation: "persist",
        sequenceNumber: i,
      });
    }

    const counter = meter.getCounter(AUDIT_STORAGE_WRITE_FAILED_METRIC);
    expect(counter!.getValue({ operation: "persist" })).toBe(5);
  });

  it("different operations produce distinct labelled counters", () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({ meter });

    recorder.recordStorageWriteFailed({ operation: "persist" });
    recorder.recordStorageWriteFailed({ operation: "rotateKey" });
    recorder.recordStorageWriteFailed({ operation: "persist" });

    const counter = meter.getCounter(AUDIT_STORAGE_WRITE_FAILED_METRIC);
    expect(counter!.getValue({ operation: "persist" })).toBe(2);
    expect(counter!.getValue({ operation: "rotateKey" })).toBe(1);
  });

  it("counter names match OBSERVABILITY_SCOPE.md", () => {
    // Belt-and-suspenders against accidental rename.
    expect(AUDIT_CHAIN_INTEGRITY_BROKEN_METRIC).toBe(
      "audit_chain_integrity_broken_total",
    );
    expect(AUDIT_CHAIN_LINK_MISMATCH_METRIC).toBe(
      "audit_chain_link_mismatch_total",
    );
    expect(AUDIT_STORAGE_WRITE_FAILED_METRIC).toBe(
      "audit_storage_write_failed_total",
    );
    expect(AUDIT_STORAGE_READ_FAILED_METRIC).toBe(
      "audit_storage_read_failed_total",
    );
  });

  it("recorder is a complete AuditMetricsRecorder (all 4 methods present)", () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({ meter });
    expect(typeof recorder.recordChainIntegrityBroken).toBe("function");
    expect(typeof recorder.recordChainLinkMismatch).toBe("function");
    expect(typeof recorder.recordStorageWriteFailed).toBe("function");
    expect(typeof recorder.recordStorageReadFailed).toBe("function");
  });
});

// ─── Layer 2: end-to-end emission ──────────────────────────

describe("end-to-end: AuditStore + bridge + InMemoryMeter (PR #110)", () => {
  /** In-memory plain storage that fails on `set` to trigger persist failure. */
  function makeFailingStorage() {
    const map = new Map<string, string>();
    return {
      async get(key: string) {
        return map.get(key) ?? null;
      },
      async set(_key: string, _value: string) {
        throw new Error("simulated chrome.storage.local set failure");
      },
      async delete(key: string) {
        map.delete(key);
      },
    };
  }

  function makeAuditEvent(seq: number): AuditEvent {
    const cap = new AuditCapture();
    cap.restoreState(seq - 1, "0".repeat(64));
    return cap.record({
      kind: "request-received",
      subjectId: "subj-prod",
      workspaceId: "ws-prod",
      detail: { seq },
    });
  }

  it("AuditStore.append failure ticks audit_storage_write_failed_total in the meter", async () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({
      meter,
      defaultLabels: { service: "wallet-test" },
    });
    const store = new AuditStore(makeFailingStorage(), 100, null, recorder);
    await store.initialize();

    // Before failure: counter value undefined-or-zero.
    const counter = meter.getCounter(AUDIT_STORAGE_WRITE_FAILED_METRIC);
    expect(counter?.getValue({ service: "wallet-test", operation: "persist" }) ?? 0).toBe(0);

    // Trigger persist failure.
    await expect(store.append(makeAuditEvent(1))).rejects.toThrow(/persist/i);

    // Counter ticked exactly once with the merged labels.
    expect(
      counter!.getValue({ service: "wallet-test", operation: "persist" }),
    ).toBe(1);
  });

  it("toPrometheus() output includes the audit counters with correct labels", async () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({
      meter,
      defaultLabels: { service: "wallet-test" },
    });
    const store = new AuditStore(makeFailingStorage(), 100, null, recorder);
    await store.initialize();
    await expect(store.append(makeAuditEvent(1))).rejects.toThrow();

    const exposition = meter.toPrometheus();
    // Standard Prometheus exposition format includes:
    //   # HELP audit_storage_write_failed_total ...
    //   # TYPE audit_storage_write_failed_total counter
    //   audit_storage_write_failed_total{...labels...} 1
    expect(exposition).toContain(AUDIT_STORAGE_WRITE_FAILED_METRIC);
    expect(exposition).toContain('operation="persist"');
    expect(exposition).toContain('service="wallet-test"');
    expect(exposition).toMatch(/audit_storage_write_failed_total\{[^}]+\} 1/);
  });

  it("multiple distinct failures accumulate in the same counter", async () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({ meter });
    const store = new AuditStore(makeFailingStorage(), 100, null, recorder);
    await store.initialize();

    for (let i = 0; i < 3; i++) {
      await expect(store.append(makeAuditEvent(i + 1))).rejects.toThrow();
    }

    const counter = meter.getCounter(AUDIT_STORAGE_WRITE_FAILED_METRIC);
    expect(counter!.getValue({ operation: "persist" })).toBe(3);
  });

  it("successful append does NOT tick the counter (regression guard)", async () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({ meter });
    // Use a non-failing storage so the persist succeeds.
    const happyStorage = {
      async get(_key: string) {
        return null;
      },
      async set(_key: string, _value: string) {
        // success
      },
      async delete(_key: string) {
        // noop
      },
    };
    const store = new AuditStore(happyStorage, 100, null, recorder);
    await store.initialize();
    await store.append(makeAuditEvent(1));

    const counter = meter.getCounter(AUDIT_STORAGE_WRITE_FAILED_METRIC);
    // Counter exists (was constructed by the factory) but is untouched.
    expect(counter!.getValue({ operation: "persist" })).toBe(0);
  });
});

// ─── Layer 3: pre-eviction flush handler (PR #112) ─────────

describe("buildAuditMetricsSuspendHandler (PR #112)", () => {
  /** Build a periodic exporter wired to a fake fetch we can inspect. */
  function makePeriodicExporter() {
    const meter = new InMemoryMeter();
    let fetchCalls = 0;
    const fakeFetch = (async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> => {
      fetchCalls += 1;
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    // Save / restore globalThis.fetch around the test.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch;

    const exporter = new OtlpMetricsExporter({
      url: "https://example.test/v1/metrics",
    });
    const periodic = new PeriodicMetricsExporter({
      meter,
      exporter,
      intervalMs: 1_000_000, // never tick during the test
    });

    return {
      meter,
      periodic,
      getFetchCalls: () => fetchCalls,
      restore: () => {
        globalThis.fetch = originalFetch;
      },
    };
  }

  it("returns a no-op when exporter is null (OSS default — VITE env var unset)", () => {
    const handler = buildAuditMetricsSuspendHandler(null);
    expect(() => handler()).not.toThrow();
  });

  it("invokes flush() and stop() on the exporter", async () => {
    const { periodic, getFetchCalls, restore } = makePeriodicExporter();
    try {
      periodic.start();
      expect(periodic.isRunning()).toBe(true);
      expect(getFetchCalls()).toBe(0);

      const handler = buildAuditMetricsSuspendHandler(periodic);
      handler();

      // stop() ran synchronously — timer cleared.
      expect(periodic.isRunning()).toBe(false);

      // flush() was invoked but is async — give it a microtask to land.
      await new Promise((r) => setTimeout(r, 0));
      expect(getFetchCalls()).toBe(1);
    } finally {
      restore();
    }
  });

  it("stop() runs even when flush() rejects (decoupled error handling)", async () => {
    const meter = new InMemoryMeter();
    const errors: unknown[] = [];
    // Fake fetch that ALWAYS throws.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("simulated network error during pre-eviction flush");
    }) as typeof fetch;
    try {
      const exporter = new OtlpMetricsExporter({
        url: "https://example.test/v1/metrics",
      });
      const periodic = new PeriodicMetricsExporter({
        meter,
        exporter,
        intervalMs: 1_000_000,
      });
      periodic.start();
      expect(periodic.isRunning()).toBe(true);

      const handler = buildAuditMetricsSuspendHandler(periodic, (err) => {
        errors.push(err);
      });
      handler();

      // stop() ran synchronously despite the flush throwing.
      expect(periodic.isRunning()).toBe(false);

      // Microtask flush rejection routed through onError.
      await new Promise((r) => setTimeout(r, 0));
      expect(errors).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("idempotent — calling the handler twice doesn't break (timer already stopped)", async () => {
    const { periodic, restore } = makePeriodicExporter();
    try {
      periodic.start();
      const handler = buildAuditMetricsSuspendHandler(periodic);

      handler();
      expect(periodic.isRunning()).toBe(false);

      // Second invocation: stop() is already a no-op when the timer
      // is undefined; flush() runs again (sends the same cumulative
      // state). Should not throw.
      expect(() => handler()).not.toThrow();
      expect(periodic.isRunning()).toBe(false);
    } finally {
      restore();
    }
  });

  it("default onError silently swallows flush rejection (no throw out of handler)", async () => {
    const meter = new InMemoryMeter();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("flush rejection");
    }) as typeof fetch;
    try {
      const exporter = new OtlpMetricsExporter({
        url: "https://example.test/v1/metrics",
      });
      const periodic = new PeriodicMetricsExporter({
        meter,
        exporter,
        intervalMs: 1_000_000,
      });
      periodic.start();

      // No onError supplied — should default to no-op.
      const handler = buildAuditMetricsSuspendHandler(periodic);
      expect(() => handler()).not.toThrow();

      // Wait for microtask so unhandled-rejection (if any) would fire.
      await new Promise((r) => setTimeout(r, 0));

      expect(periodic.isRunning()).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Layer 4: snapshot helper (PR #115) ────────────────────

describe("getAuditMetricsSnapshot (PR #115)", () => {
  it("returns four counters in canonical order regardless of which have ticked", () => {
    const meter = new InMemoryMeter();
    // No counters ticked — but the recorder factory has registered them.
    buildAuditMetricsRecorder({ meter });

    const snapshot = getAuditMetricsSnapshot(meter, null, undefined);
    expect(snapshot.counters).toHaveLength(4);
    expect(snapshot.counters.map((c) => c.name)).toEqual([
      AUDIT_CHAIN_INTEGRITY_BROKEN_METRIC,
      AUDIT_CHAIN_LINK_MISMATCH_METRIC,
      AUDIT_STORAGE_WRITE_FAILED_METRIC,
      AUDIT_STORAGE_READ_FAILED_METRIC,
    ]);
    // Empty series — no events yet.
    snapshot.counters.forEach((c) => expect(c.series).toEqual([]));
  });

  it("populates series with labels + value when counters tick", () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({
      meter,
      defaultLabels: { service: "test" },
    });
    recorder.recordStorageWriteFailed({
      operation: "persist",
      sequenceNumber: 1,
    });
    recorder.recordStorageWriteFailed({
      operation: "persist",
      sequenceNumber: 2,
    });
    recorder.recordStorageWriteFailed({ operation: "rotateKey" });
    recorder.recordStorageReadFailed({ operation: "initialize" });

    const snapshot = getAuditMetricsSnapshot(meter, null, undefined);
    const writeCounter = snapshot.counters.find(
      (c) => c.name === AUDIT_STORAGE_WRITE_FAILED_METRIC,
    );
    expect(writeCounter).toBeDefined();
    // Two distinct label sets: persist (value=2) and rotateKey (value=1).
    expect(writeCounter!.series).toHaveLength(2);
    const persistSeries = writeCounter!.series.find(
      (s) => s.labels.operation === "persist",
    );
    expect(persistSeries?.value).toBe(2);
    expect(persistSeries?.labels.service).toBe("test");
    const rotateSeries = writeCounter!.series.find(
      (s) => s.labels.operation === "rotateKey",
    );
    expect(rotateSeries?.value).toBe(1);

    const readCounter = snapshot.counters.find(
      (c) => c.name === AUDIT_STORAGE_READ_FAILED_METRIC,
    );
    expect(readCounter!.series).toHaveLength(1);
    expect(readCounter!.series[0].value).toBe(1);
  });

  it("captures exporterRunning + otlpUrl correctly", () => {
    const meter = new InMemoryMeter();
    const exporter = new PeriodicMetricsExporter({
      meter,
      exporter: new OtlpMetricsExporter({ url: "https://example.test/v1/metrics" }),
      intervalMs: 1_000_000,
    });

    const idleSnapshot = getAuditMetricsSnapshot(meter, exporter, "https://example.test/v1/metrics");
    expect(idleSnapshot.exporterRunning).toBe(false);
    expect(idleSnapshot.otlpUrl).toBe("https://example.test/v1/metrics");

    exporter.start();
    const runningSnapshot = getAuditMetricsSnapshot(meter, exporter, "https://example.test/v1/metrics");
    expect(runningSnapshot.exporterRunning).toBe(true);

    exporter.stop();
    const stoppedSnapshot = getAuditMetricsSnapshot(meter, exporter, "https://example.test/v1/metrics");
    expect(stoppedSnapshot.exporterRunning).toBe(false);
  });

  it("returns exporterRunning=false + otlpUrl=undefined for null exporter (OSS default)", () => {
    const meter = new InMemoryMeter();
    const snapshot = getAuditMetricsSnapshot(meter, null, undefined);
    expect(snapshot.exporterRunning).toBe(false);
    expect(snapshot.otlpUrl).toBeUndefined();
  });

  it("capturedAt is a recent unix-ms timestamp", () => {
    const meter = new InMemoryMeter();
    const before = Date.now();
    const snapshot = getAuditMetricsSnapshot(meter, null, undefined);
    const after = Date.now();
    expect(snapshot.capturedAt).toBeGreaterThanOrEqual(before);
    expect(snapshot.capturedAt).toBeLessThanOrEqual(after);
  });

  it("handles meter with no audit counters registered (e.g., no recorder constructed)", () => {
    // Defensive: a fresh meter where buildAuditMetricsRecorder was
    // never called returns empty series for all four counter names.
    const meter = new InMemoryMeter();
    const snapshot = getAuditMetricsSnapshot(meter, null, undefined);
    expect(snapshot.counters).toHaveLength(4);
    snapshot.counters.forEach((c) => expect(c.series).toEqual([]));
  });

  it("AUDIT_METRICS_SNAPSHOT_KIND is the canonical bridge message kind", () => {
    expect(AUDIT_METRICS_SNAPSHOT_KIND).toBe("get-audit-metrics");
  });

  it("snapshot is JSON-serializable (crosses bridge cleanly)", () => {
    const meter = new InMemoryMeter();
    const recorder = buildAuditMetricsRecorder({ meter });
    recorder.recordStorageWriteFailed({
      operation: "persist",
      sequenceNumber: 42,
    });
    const snapshot = getAuditMetricsSnapshot(meter, null, undefined);

    // Roundtrip through JSON — bridge messages get serialized.
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json) as typeof snapshot;
    expect(parsed.counters[2].series[0].value).toBe(1);
    expect(parsed.counters[2].series[0].labels.operation).toBe("persist");
  });
});
