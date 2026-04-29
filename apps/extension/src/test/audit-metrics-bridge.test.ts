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

import {
  buildAuditMetricsRecorder,
  AUDIT_CHAIN_INTEGRITY_BROKEN_METRIC,
  AUDIT_CHAIN_LINK_MISMATCH_METRIC,
  AUDIT_STORAGE_WRITE_FAILED_METRIC,
  AUDIT_STORAGE_READ_FAILED_METRIC,
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
