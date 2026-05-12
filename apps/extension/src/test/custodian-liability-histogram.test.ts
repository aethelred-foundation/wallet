/**
 * Tests for `CustodianLiabilityHistogram` — the observability
 * companion to the custodian liability attestation pipeline.
 *
 * Coverage targets:
 *
 *   1. Construction: invalid `windowSize` rejected.
 *   2. Record a single known sample → snapshot reports counts +
 *      latest coverage.
 *   3. Record a single unknown sample → unknownRate=1, no latest
 *      coverage exposed.
 *   4. Per-custodian isolation: two custodians' samples don't bleed.
 *   5. unknownRate calculation: mixed known + unknown samples.
 *   6. SLA-status distribution: counts per status, always reports
 *      all three keys.
 *   7. Latest coverage is point-in-time: drops from $500M → $50M
 *      surface immediately, NOT averaged with prior values.
 *   8. Ring-buffer eviction: oldest samples drop past windowSize;
 *      tally stays consistent post-eviction.
 *   9. End-to-end with `captureLiabilitySnapshot`: the real
 *      `LiabilitySnapshotEvent` flows through `liabilitySnapshot-
 *      ToSample` and lands in the histogram.
 *  10. The projector also accepts audit-event variants (fields
 *      nested under `detail`).
 */

import { describe, expect, it } from "vitest";

import {
  CustodianLiabilityHistogram,
  liabilitySnapshotToSample,
  type LiabilitySnapshotSample,
} from "@aethelred/wallet-observability";

import {
  CUSTODIAN_IDS,
  NoopLiabilityAttestor,
  captureLiabilitySnapshot,
  type CustodianLiabilityAttestation,
  type LiabilityAttestor,
} from "@aethelred/wallet-custody-adapters";

// ─── Helpers ──────────────────────────────────────────────────────

function known(
  custodianId: string,
  overrides: Partial<LiabilitySnapshotSample> = {},
): LiabilitySnapshotSample {
  return {
    custodianId,
    liabilityUnknown: false,
    slaStatus: "operational",
    insuranceCoverage: 50_000_000_000n, // $500M in cents
    insuranceCurrency: "USD",
    capturedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function unknownSample(
  custodianId: string,
  capturedAt = 1_700_000_000_000,
): LiabilitySnapshotSample {
  return { custodianId, liabilityUnknown: true, capturedAt };
}

// ─── Construction ─────────────────────────────────────────────────

describe("CustodianLiabilityHistogram: construction", () => {
  it("default windowSize works", () => {
    const h = new CustodianLiabilityHistogram();
    expect(h.size()).toBe(0);
    expect(h.totalSamples()).toBe(0);
  });

  it("custom windowSize works", () => {
    const h = new CustodianLiabilityHistogram({ windowSize: 16 });
    expect(h.size()).toBe(0);
  });

  it("rejects non-positive windowSize", () => {
    expect(() => new CustodianLiabilityHistogram({ windowSize: 0 })).toThrow(
      /positive integer/,
    );
    expect(() => new CustodianLiabilityHistogram({ windowSize: -1 })).toThrow(
      /positive integer/,
    );
  });

  it("rejects non-integer windowSize", () => {
    expect(
      () => new CustodianLiabilityHistogram({ windowSize: 3.14 }),
    ).toThrow(/positive integer/);
  });
});

// ─── Single-sample cases ─────────────────────────────────────────

describe("CustodianLiabilityHistogram: single-sample cases", () => {
  it("known sample → snapshot reports counts + latest coverage", () => {
    const h = new CustodianLiabilityHistogram();
    h.record(known(CUSTODIAN_IDS.komainu));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.total).toBe(1);
    expect(s.knownCount).toBe(1);
    expect(s.unknownCount).toBe(0);
    expect(s.unknownRate).toBe(0);
    expect(s.slaStatusCounts).toEqual({
      operational: 1,
      degraded: 0,
      unavailable: 0,
    });
    expect(s.latestCoverage).toBe(50_000_000_000n);
    expect(s.latestCoverageCurrency).toBe("USD");
    expect(s.latestSlaStatus).toBe("operational");
    expect(s.latestAt).toBe(1_700_000_000_000);
  });

  it("unknown sample → unknownRate=1, no latest coverage exposed", () => {
    const h = new CustodianLiabilityHistogram();
    h.record(unknownSample(CUSTODIAN_IDS.komainu));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.total).toBe(1);
    expect(s.knownCount).toBe(0);
    expect(s.unknownCount).toBe(1);
    expect(s.unknownRate).toBe(1);
    expect(s.latestCoverage).toBeUndefined();
    expect(s.latestSlaStatus).toBeUndefined();
    // capturedAt still surfaces via latestAt — auditors still know
    // WHEN the attempt happened, just not the coverage state.
    expect(s.latestAt).toBe(1_700_000_000_000);
  });

  it("snapshot of a custodian with no samples → null", () => {
    const h = new CustodianLiabilityHistogram();
    expect(h.snapshot(CUSTODIAN_IDS.komainu)).toBeNull();
  });

  it("malformed sample with empty custodianId is silently dropped", () => {
    const h = new CustodianLiabilityHistogram();
    h.record({ custodianId: "", liabilityUnknown: false });
    expect(h.size()).toBe(0);
    expect(h.totalSamples()).toBe(0);
  });
});

// ─── Per-custodian isolation ─────────────────────────────────────

describe("CustodianLiabilityHistogram: per-custodian isolation", () => {
  it("two custodians' samples don't bleed", () => {
    const h = new CustodianLiabilityHistogram();
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "operational" }));
    h.record(known(CUSTODIAN_IDS.fireblocks, { slaStatus: "degraded" }));
    h.record(unknownSample(CUSTODIAN_IDS.komainu));

    const k = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(k.total).toBe(2);
    expect(k.unknownCount).toBe(1);
    expect(k.slaStatusCounts.operational).toBe(1);
    expect(k.slaStatusCounts.degraded).toBe(0);

    const f = h.snapshot(CUSTODIAN_IDS.fireblocks)!;
    expect(f.total).toBe(1);
    expect(f.unknownCount).toBe(0);
    expect(f.slaStatusCounts.degraded).toBe(1);
    expect(f.slaStatusCounts.operational).toBe(0);

    expect(h.size()).toBe(2);
    expect(h.totalSamples()).toBe(3);
  });
});

// ─── unknownRate calculation ─────────────────────────────────────

describe("CustodianLiabilityHistogram: unknownRate", () => {
  it("computes correct fraction over mixed samples", () => {
    const h = new CustodianLiabilityHistogram();
    // 3 known + 2 unknown → 2/5 = 0.4
    h.record(known(CUSTODIAN_IDS.komainu));
    h.record(known(CUSTODIAN_IDS.komainu));
    h.record(known(CUSTODIAN_IDS.komainu));
    h.record(unknownSample(CUSTODIAN_IDS.komainu));
    h.record(unknownSample(CUSTODIAN_IDS.komainu));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.unknownRate).toBeCloseTo(0.4, 5);
  });

  it("alert-threshold smoke: 5% unknown → SRE alert fires", () => {
    // Operational scenario: 19 known + 1 unknown → 5% — the typical
    // alert threshold. The histogram supports this kind of query
    // directly, no aggregation outside the class.
    const h = new CustodianLiabilityHistogram();
    for (let i = 0; i < 19; i++) h.record(known(CUSTODIAN_IDS.komainu));
    h.record(unknownSample(CUSTODIAN_IDS.komainu));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.unknownRate).toBe(0.05);
  });
});

// ─── SLA-status distribution ─────────────────────────────────────

describe("CustodianLiabilityHistogram: SLA-status distribution", () => {
  it("counts each status separately, reports all three keys", () => {
    const h = new CustodianLiabilityHistogram();
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "operational" }));
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "operational" }));
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "degraded" }));
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "unavailable" }));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.slaStatusCounts).toEqual({
      operational: 2,
      degraded: 1,
      unavailable: 1,
    });
  });

  it("status NOT yet seen still reports 0 (no missing keys)", () => {
    const h = new CustodianLiabilityHistogram();
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "operational" }));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.slaStatusCounts.operational).toBe(1);
    expect(s.slaStatusCounts.degraded).toBe(0);
    expect(s.slaStatusCounts.unavailable).toBe(0);
  });
});

// ─── Latest coverage point-in-time semantics ─────────────────────

describe("CustodianLiabilityHistogram: latestCoverage is point-in-time", () => {
  it("$500M → $50M coverage drop surfaces immediately (NOT averaged)", () => {
    // This is the property that motivated the design — a sudden
    // coverage cut is operationally significant and averaging would
    // hide it. The latest snapshot must show the new low value.
    const h = new CustodianLiabilityHistogram();
    h.record(
      known(CUSTODIAN_IDS.komainu, { insuranceCoverage: 50_000_000_000n }), // $500M
    );
    h.record(
      known(CUSTODIAN_IDS.komainu, { insuranceCoverage: 50_000_000_000n }),
    );
    h.record(
      known(CUSTODIAN_IDS.komainu, { insuranceCoverage: 50_000_000_000n }),
    );
    h.record(
      known(CUSTODIAN_IDS.komainu, { insuranceCoverage: 5_000_000_000n }), // $50M
    );
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.latestCoverage).toBe(5_000_000_000n);
    // NOT (50e9 + 50e9 + 50e9 + 5e9) / 4 = 38.75e9 — operators
    // need to SEE the drop, not its rolling average.
  });

  it("unknown sample does NOT clobber latestCoverage from earlier known sample", () => {
    // Realistic operational scenario: oracle was healthy at T-1
    // (we have a known coverage value), oracle outage at T-now
    // (current sample is unknown). The dashboard should still show
    // "last known coverage: $500M" — auditors need that anchor.
    const h = new CustodianLiabilityHistogram();
    h.record(
      known(CUSTODIAN_IDS.komainu, { insuranceCoverage: 50_000_000_000n }),
    );
    h.record(unknownSample(CUSTODIAN_IDS.komainu));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.latestCoverage).toBe(50_000_000_000n);
    expect(s.unknownRate).toBe(0.5);
  });

  it("latestCoverage survives ring-buffer eviction (point-in-time, not windowed)", () => {
    // A known sample older than the window still anchors
    // latestCoverage. Even when the buffer rolls past it, the
    // "current state" lookup returns the most recent KNOWN value.
    const h = new CustodianLiabilityHistogram({ windowSize: 3 });
    h.record(
      known(CUSTODIAN_IDS.komainu, { insuranceCoverage: 50_000_000_000n }),
    );
    // Push 4 unknown samples — buffer fills + evicts the original.
    for (let i = 0; i < 4; i++) h.record(unknownSample(CUSTODIAN_IDS.komainu));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.total).toBe(3); // ring buffer capped
    expect(s.unknownCount).toBe(3); // 4 unknowns - 1 evicted = 3
    expect(s.latestCoverage).toBe(50_000_000_000n); // anchor preserved
  });
});

// ─── Ring-buffer eviction ────────────────────────────────────────

describe("CustodianLiabilityHistogram: ring-buffer eviction", () => {
  it("oldest samples drop past windowSize; tally stays consistent", () => {
    const h = new CustodianLiabilityHistogram({ windowSize: 5 });
    // Insert 10 samples: 5 unknown then 5 known. The first 5
    // (unknown) get evicted, leaving 5 known.
    for (let i = 0; i < 5; i++) h.record(unknownSample(CUSTODIAN_IDS.komainu));
    for (let i = 0; i < 5; i++) h.record(known(CUSTODIAN_IDS.komainu));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.total).toBe(5);
    expect(s.knownCount).toBe(5);
    expect(s.unknownCount).toBe(0); // all evicted
    expect(s.unknownRate).toBe(0);
    expect(s.slaStatusCounts.operational).toBe(5);
  });

  it("eviction of known sample decrements the right status bucket", () => {
    const h = new CustodianLiabilityHistogram({ windowSize: 3 });
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "degraded" })); // evicted
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "operational" }));
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "operational" }));
    h.record(known(CUSTODIAN_IDS.komainu, { slaStatus: "operational" }));
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.slaStatusCounts.degraded).toBe(0); // evicted
    expect(s.slaStatusCounts.operational).toBe(3);
  });
});

// ─── Iteration + reset ───────────────────────────────────────────

describe("CustodianLiabilityHistogram: iteration + reset", () => {
  it("snapshots() yields one entry per tracked custodian", () => {
    const h = new CustodianLiabilityHistogram();
    h.record(known(CUSTODIAN_IDS.komainu));
    h.record(known(CUSTODIAN_IDS.fireblocks));
    h.record(known(CUSTODIAN_IDS.hextrust));
    const snaps = h.snapshots();
    expect(snaps.size).toBe(3);
    expect(snaps.has(CUSTODIAN_IDS.komainu)).toBe(true);
    expect(snaps.has(CUSTODIAN_IDS.fireblocks)).toBe(true);
    expect(snaps.has(CUSTODIAN_IDS.hextrust)).toBe(true);
  });

  it("reset() clears all data including latestCoverage", () => {
    const h = new CustodianLiabilityHistogram();
    h.record(known(CUSTODIAN_IDS.komainu));
    h.record(known(CUSTODIAN_IDS.fireblocks));
    expect(h.size()).toBe(2);
    h.reset();
    expect(h.size()).toBe(0);
    expect(h.totalSamples()).toBe(0);
    expect(h.snapshot(CUSTODIAN_IDS.komainu)).toBeNull();
  });
});

// ─── End-to-end with captureLiabilitySnapshot ────────────────────

describe("CustodianLiabilityHistogram: end-to-end with captureLiabilitySnapshot", () => {
  it("real attestation event flows through liabilitySnapshotToSample into the histogram", async () => {
    // Build a real attestation, capture it via the real
    // captureLiabilitySnapshot, project to a sample, record. This
    // is the production wiring path operators would use.
    const attestation: CustodianLiabilityAttestation = {
      custodianId: CUSTODIAN_IDS.komainu,
      slaStatus: "operational",
      insuranceCoverage: 50_000_000_000n,
      insuranceCurrency: "USD",
      attestedAt: 1_700_000_000_000,
      oracleId: "chainlink:custody:komainu",
    };
    const attestor: LiabilityAttestor = {
      custodianId: CUSTODIAN_IDS.komainu,
      async fetchAttestation() {
        return attestation;
      },
    };
    const event = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor,
      now: () => 1_700_000_000_500,
    });

    const sample = liabilitySnapshotToSample(event);
    expect(sample).not.toBeNull();

    const h = new CustodianLiabilityHistogram();
    h.record(sample!);
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.knownCount).toBe(1);
    expect(s.unknownCount).toBe(0);
    expect(s.latestCoverage).toBe(50_000_000_000n);
    expect(s.latestSlaStatus).toBe("operational");
  });

  it("NoopLiabilityAttestor → liabilityUnknown event → histogram records as unknown", async () => {
    // The fail-graceful path: attestor returns null, event has
    // liabilityUnknown=true, histogram tracks the unknown-rate
    // increment. This is the SLI signal an SRE alerts on.
    const event = await captureLiabilitySnapshot({
      transactionId: "0xtx-002",
      attestor: new NoopLiabilityAttestor(CUSTODIAN_IDS.komainu),
      now: () => 1_700_000_000_500,
    });
    const sample = liabilitySnapshotToSample(event);
    expect(sample).not.toBeNull();
    expect(sample!.liabilityUnknown).toBe(true);

    const h = new CustodianLiabilityHistogram();
    h.record(sample!);
    const s = h.snapshot(CUSTODIAN_IDS.komainu)!;
    expect(s.unknownRate).toBe(1);
  });
});

// ─── Projector edge cases ────────────────────────────────────────

describe("liabilitySnapshotToSample: projector edge cases", () => {
  it("returns null on missing custodianId", () => {
    expect(liabilitySnapshotToSample({})).toBeNull();
    expect(liabilitySnapshotToSample({ custodianId: 123 })).toBeNull();
    expect(liabilitySnapshotToSample({ custodianId: "" })).toBeNull();
  });

  it("accepts audit-event variant (fields under `detail`)", () => {
    // recordLiabilitySnapshot wraps the snapshot in an audit event
    // with the actual snapshot fields nested under `detail`. The
    // projector unwraps either form.
    const sample = liabilitySnapshotToSample({
      kind: "custodian-liability-snapshot",
      intentId: "0xtx-003",
      detail: {
        custodianId: CUSTODIAN_IDS.komainu,
        liabilityUnknown: false,
        capturedAt: 1_700_000_000_500,
        attestation: {
          slaStatus: "operational",
          insuranceCoverage: 50_000_000_000n,
          insuranceCurrency: "USD",
        },
      },
    });
    expect(sample).not.toBeNull();
    expect(sample!.custodianId).toBe(CUSTODIAN_IDS.komainu);
    expect(sample!.slaStatus).toBe("operational");
    expect(sample!.insuranceCoverage).toBe(50_000_000_000n);
  });

  it("accepts audit-event variant for unknown samples too", () => {
    const sample = liabilitySnapshotToSample({
      detail: {
        custodianId: CUSTODIAN_IDS.fireblocks,
        liabilityUnknown: true,
        capturedAt: 1_700_000_000_500,
      },
    });
    expect(sample).not.toBeNull();
    expect(sample!.liabilityUnknown).toBe(true);
    expect(sample!.custodianId).toBe(CUSTODIAN_IDS.fireblocks);
  });

  it("ignores malformed slaStatus (defensive)", () => {
    const sample = liabilitySnapshotToSample({
      custodianId: CUSTODIAN_IDS.komainu,
      liabilityUnknown: false,
      attestation: {
        slaStatus: "garbage-value",
        insuranceCoverage: 1n,
        insuranceCurrency: "USD",
      },
    });
    expect(sample).not.toBeNull();
    // slaStatus dropped — undefined rather than passing "garbage"
    // through.
    expect(sample!.slaStatus).toBeUndefined();
    expect(sample!.insuranceCoverage).toBe(1n);
  });
});
