/**
 * Smoke tests for `runInstitutionalComplianceDemo` — proves the
 * demo runner composes cleanly and yields a deterministic result
 * in all three modes (happy / deny / mixed).
 *
 * Lives in `apps/extension/src/test/` (alongside the other
 * integration-package smoke tests) so it runs in the same vitest
 * suite without `packages/integration` needing its own test
 * runner config.
 *
 * Coverage:
 *   1. Happy mode: every transaction succeeds, unknownRate=0, audit
 *      chain valid, Prometheus output includes the expected metrics.
 *   2. Deny mode: every transaction's attestation fails (HTTP 503),
 *      but audit chain STILL valid (suppression-defense property)
 *      and every event flagged `liabilityUnknown: true`.
 *   3. Mixed mode: 80% / 20% known/unknown split; unknownRate in
 *      the expected band.
 *   4. samples count controls audit-event count (2 per tx).
 *   5. Custom tenantId surfaces in the audit events.
 */

import { describe, expect, it } from "vitest";

import { runInstitutionalComplianceDemo } from "@aethelred/wallet-integration";

import { AuditCapture } from "@aethelred/wallet-audit";

// ─── Happy mode ────────────────────────────────────────────────────

describe("runInstitutionalComplianceDemo: happy mode", () => {
  it("composes the full pipeline; every transaction's attestation succeeds", async () => {
    const result = await runInstitutionalComplianceDemo({
      mode: "happy",
      samples: 5,
    });

    expect(result.mode).toBe("happy");
    expect(result.transactions).toHaveLength(5);

    // Every transaction has a successful attestation.
    for (const tx of result.transactions) {
      expect(tx.liabilityUnknown).toBe(false);
      expect(tx.liability.attestation).not.toBeNull();
      expect(tx.liability.attestation!.insuranceCoverage).toBe(50_000_000_000n);
      expect(tx.liability.attestation!.slaStatus).toBe("operational");
    }

    // SLI is healthy.
    expect(result.liabilityStats.unknownRate).toBe(0);
    expect(result.liabilityStats.knownCount).toBe(5);
    expect(result.liabilityStats.unknownCount).toBe(0);
    expect(result.liabilityStats.latestCoverage).toBe(50_000_000_000n);

    // Audit chain integrity holds end-to-end.
    expect(result.auditChainValid).toBe(true);
    expect(result.auditEvents).toHaveLength(10); // 2 per tx × 5 txs
    // Re-verify the chain via the static method to prove it's not
    // a cached value.
    expect(AuditCapture.verifyChain([...result.auditEvents])).toBe(true);

    // Prometheus output includes the expected metrics.
    expect(result.prometheusOutput).toContain(
      "# TYPE custodian_liability_window_total gauge",
    );
    expect(result.prometheusOutput).toContain(
      'custodian_liability_unknown_rate{custodian_id="komainu"} 0',
    );
    expect(result.prometheusOutput).toContain(
      "# TYPE custodian_liability_attestations_total counter",
    );
  });

  it("matrix decisions reflect UAE-first hierarchy (VARA wins data-exposure)", async () => {
    // The canonical MAS×VARA scenario from the feedback document.
    // Tenant hierarchy puts AE first → VARA's must-mask wins over
    // MAS's may-expose. This is the per-tenant resolution property
    // the static-passport design couldn't deliver.
    const result = await runInstitutionalComplianceDemo({
      mode: "happy",
      samples: 1,
    });

    const tx = result.transactions[0]!;
    const exposureResolution = tx.resolution.resolutions.find(
      (r) => r.axis === "data-exposure",
    );
    expect(exposureResolution).toBeDefined();
    expect(exposureResolution!.winningJurisdiction).toBe("AE");
    expect(exposureResolution!.winningRule).toBe("must-mask");
  });
});

// ─── Deny mode ────────────────────────────────────────────────────

describe("runInstitutionalComplianceDemo: deny mode (oracle unreachable)", () => {
  it("every transaction's attestation fails; audit chain still valid; unknownRate=1", async () => {
    const result = await runInstitutionalComplianceDemo({
      mode: "deny",
      samples: 5,
    });

    expect(result.mode).toBe("deny");
    expect(result.transactions).toHaveLength(5);

    // Every transaction has a failed attestation — fail-graceful.
    for (const tx of result.transactions) {
      expect(tx.liabilityUnknown).toBe(true);
      expect(tx.liability.attestation).toBeNull();
    }

    // SLI fully degraded.
    expect(result.liabilityStats.unknownRate).toBe(1);
    expect(result.liabilityStats.knownCount).toBe(0);
    expect(result.liabilityStats.unknownCount).toBe(5);
    // No coverage data was ever attested — latestCoverage stays unset.
    expect(result.liabilityStats.latestCoverage).toBeUndefined();

    // Critical: audit chain STILL valid even though every event has
    // liabilityUnknown=true. This is the suppression-defense property
    // — the wallet records the gap rather than hiding it.
    expect(result.auditChainValid).toBe(true);
    expect(result.auditEvents).toHaveLength(10);

    // Prometheus surface reflects the degraded SLI.
    expect(result.prometheusOutput).toContain(
      'custodian_liability_unknown_rate{custodian_id="komainu"} 1',
    );
    expect(result.prometheusOutput).toContain(
      'custodian_liability_attestations_total{custodian_id="komainu",outcome="unknown"} 5',
    );
  });
});

// ─── Mixed mode ───────────────────────────────────────────────────

describe("runInstitutionalComplianceDemo: mixed mode (realistic SLI signal)", () => {
  it("produces unknownRate strictly between 0 and 1 with the documented 80/20 split", async () => {
    // Mixed mode fails every 5th sample (deny path). With samples=10
    // that gives 2 unknown + 8 known → unknownRate = 0.2.
    const result = await runInstitutionalComplianceDemo({
      mode: "mixed",
      samples: 10,
    });

    expect(result.liabilityStats.knownCount).toBe(8);
    expect(result.liabilityStats.unknownCount).toBe(2);
    expect(result.liabilityStats.unknownRate).toBeCloseTo(0.2, 5);

    // The audit chain integrity holds across the mixed sequence —
    // this is the regression-guard for "demo mode interaction
    // accidentally broke chain validity for transactions on either
    // side of the failure boundary."
    expect(result.auditChainValid).toBe(true);

    // Known transactions retained the coverage data; unknown
    // transactions have null attestations. Both shapes coexist in
    // the result.
    const knownTxs = result.transactions.filter((t) => !t.liabilityUnknown);
    const unknownTxs = result.transactions.filter((t) => t.liabilityUnknown);
    expect(knownTxs).toHaveLength(8);
    expect(unknownTxs).toHaveLength(2);
    for (const tx of knownTxs) {
      expect(tx.liability.attestation).not.toBeNull();
    }
    for (const tx of unknownTxs) {
      expect(tx.liability.attestation).toBeNull();
    }
  });
});

// ─── Configuration ────────────────────────────────────────────────

describe("runInstitutionalComplianceDemo: configuration", () => {
  it("samples controls the audit-event count (2 per transaction)", async () => {
    // Verify the scaling property — important for SOC-2 evidence
    // capture where the demo runs with different sample counts.
    const small = await runInstitutionalComplianceDemo({
      mode: "happy",
      samples: 1,
    });
    expect(small.auditEvents).toHaveLength(2);

    const large = await runInstitutionalComplianceDemo({
      mode: "happy",
      samples: 25,
    });
    expect(large.auditEvents).toHaveLength(50);
    expect(large.auditChainValid).toBe(true);
  });

  it("custom tenantId surfaces in the audit events' workspaceId", async () => {
    const result = await runInstitutionalComplianceDemo({
      mode: "happy",
      samples: 2,
      tenantId: "acme-bank-uae",
    });
    expect(result.tenantId).toBe("acme-bank-uae");
    for (const event of result.auditEvents) {
      expect(event.workspaceId).toBe("acme-bank-uae");
    }
  });

  it("samples=0 floored to 1 (defensive)", async () => {
    // Defensive — a caller passing 0 should get a useful result,
    // not an empty one that breaks downstream assumptions about
    // "the demo always exercises the pipeline at least once."
    const result = await runInstitutionalComplianceDemo({
      mode: "happy",
      samples: 0,
    });
    expect(result.transactions).toHaveLength(1);
  });
});

// ─── Determinism ──────────────────────────────────────────────────

describe("runInstitutionalComplianceDemo: determinism", () => {
  it("two happy-mode runs with the same config produce identical resolution digests", async () => {
    // Determinism is what makes the demo a useful SOC-2 evidence
    // artifact — auditors can replay the demo and confirm the same
    // matrix decisions land in the audit chain. If a future change
    // introduces non-determinism (e.g., reading Date.now in the
    // resolver), this test fails immediately.
    const a = await runInstitutionalComplianceDemo({
      mode: "happy",
      samples: 3,
    });
    const b = await runInstitutionalComplianceDemo({
      mode: "happy",
      samples: 3,
    });
    expect(a.transactions.map((t) => t.resolution.digest)).toEqual(
      b.transactions.map((t) => t.resolution.digest),
    );
  });
});
