/**
 * End-to-end tests for the audit-chain wiring of the new event kinds:
 *
 *   - `compliance-conflict-resolved` (PR #147 — JurisdictionalConflictResolver)
 *   - `custodian-liability-snapshot` (PR #148 — captureLiabilitySnapshot)
 *
 * The two source modules emit their own SHA-256 digests bound to the
 * transaction. The audit chain hashes the audit-event payload
 * (sequence + timestamp + kind + detail + previousHash) into its own
 * tamper-evident chain. These tests verify:
 *
 *   1. Each event lands in the audit chain with the expected `kind`
 *      and a detail payload that preserves the digest from the source.
 *   2. The audit chain's hash chain stays valid across both event
 *      kinds interleaved (verifyChain returns true).
 *   3. Tampering with the recorded detail breaks chain verification
 *      (regression-protection: a future refactor that lets detail
 *      mutate post-record would fail this test).
 *   4. liabilityUnknown events still land in the chain (oracle-outage
 *      gaps remain audit-visible — they don't get silently dropped).
 *   5. The detail payload preserves bigint values (insurance coverage)
 *      via lossless string coercion.
 */

import { describe, expect, it } from "vitest";

import { AuditCapture } from "@aethelred/wallet-audit";
import {
  JurisdictionEngine,
  JurisdictionalConflictResolver,
  recordMatrixResolution,
} from "@aethelred/wallet-compliance";
import {
  captureLiabilitySnapshot,
  CUSTODIAN_IDS,
  NoopLiabilityAttestor,
  recordLiabilitySnapshot,
  type CustodianLiabilityAttestation,
  type LiabilityAttestor,
} from "@aethelred/wallet-custody-adapters";

const SUBJECT = {
  subjectId: "agent-001",
  workspaceId: "wks-acme",
};

function makeResolver(): JurisdictionalConflictResolver {
  const jurisdictions = new JurisdictionEngine();
  const ae = jurisdictions.getConfig("AE");
  jurisdictions.addCustomConfig({
    ...ae,
    dataResidency: { ...ae.dataResidency, localStorageOnly: true },
  });
  return new JurisdictionalConflictResolver(jurisdictions);
}

function makeAttestation(
  overrides: Partial<CustodianLiabilityAttestation> = {},
): CustodianLiabilityAttestation {
  return {
    custodianId: CUSTODIAN_IDS.komainu,
    slaStatus: "operational",
    insuranceCoverage: 500_000_000_00n,
    insuranceCurrency: "USD",
    attestedAt: 1_700_000_000_000,
    oracleId: "chainlink:custody:komainu",
    signature: ("0x" + "ab".repeat(32)) as `0x${string}`,
    ...overrides,
  };
}

// ─── compliance-conflict-resolved ─────────────────────────────────

describe("audit chain wiring: compliance-conflict-resolved", () => {
  it("records a MatrixResolution as a compliance-conflict-resolved event", () => {
    const resolver = makeResolver();
    const capture = new AuditCapture();

    const resolution = resolver.resolve({
      transactionId: "0xtx-001",
      jurisdictions: ["SG", "AE"],
      hierarchy: {
        tenantId: "wks-acme",
        orderedJurisdictions: ["SG", "AE"],
      },
    });

    const event = recordMatrixResolution(capture, resolution, SUBJECT);

    expect(event.kind).toBe("compliance-conflict-resolved");
    expect(event.subjectId).toBe(SUBJECT.subjectId);
    expect(event.workspaceId).toBe(SUBJECT.workspaceId);
    // intentId defaults to the transaction id when not overridden in
    // the subject context — keeps audit events linkable to their
    // originating intent without requiring callers to remember to set
    // intentId explicitly.
    expect(event.intentId).toBe("0xtx-001");

    const detail = event.detail as Record<string, unknown>;
    expect(detail.transactionId).toBe("0xtx-001");
    expect(detail.resolutionDigest).toBe(resolution.digest);
    expect(detail.conflictCount).toBe(resolution.conflictsFound.length);
    expect(detail.jurisdictions).toEqual(["AE", "SG"]); // canonical sort
  });

  it("audit chain remains verifiable after recording the matrix event", () => {
    const resolver = makeResolver();
    const capture = new AuditCapture();

    const resolution = resolver.resolve({
      transactionId: "0xtx-001",
      jurisdictions: ["US", "SG"],
      hierarchy: {
        tenantId: "wks-acme",
        orderedJurisdictions: ["SG", "US"],
      },
    });

    const event = recordMatrixResolution(capture, resolution, SUBJECT);
    expect(AuditCapture.verifyChain([event])).toBe(true);
  });
});

// ─── custodian-liability-snapshot ─────────────────────────────────

describe("audit chain wiring: custodian-liability-snapshot", () => {
  it("records a LiabilitySnapshotEvent with attestation as a custodian-liability-snapshot event", async () => {
    const capture = new AuditCapture();
    const attestor: LiabilityAttestor = {
      custodianId: CUSTODIAN_IDS.komainu,
      async fetchAttestation() {
        return makeAttestation();
      },
    };

    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-002",
      attestor,
      now: () => 1_700_000_000_500,
    });

    const event = recordLiabilitySnapshot(capture, snapshot, SUBJECT);

    expect(event.kind).toBe("custodian-liability-snapshot");
    expect(event.intentId).toBe("0xtx-002");

    const detail = event.detail as Record<string, unknown>;
    expect(detail.transactionId).toBe("0xtx-002");
    expect(detail.custodianId).toBe(CUSTODIAN_IDS.komainu);
    expect(detail.liabilityUnknown).toBe(false);
    expect(detail.snapshotDigest).toBe(snapshot.digest);

    // bigint coercion: insuranceCoverage stored as "<digits>n" string.
    // Auditors recover the bigint via BigInt(parseFromAuditDetail()).
    const att = detail.attestation as Record<string, unknown>;
    expect(att.insuranceCoverage).toBe("50000000000n");
    expect(att.slaStatus).toBe("operational");
    expect(att.insuranceCurrency).toBe("USD");
  });

  it("liabilityUnknown=true events still land in the chain", async () => {
    // Critical invariant: oracle-outage gaps must remain visible in
    // the audit trail. If recordLiabilitySnapshot silently dropped
    // unknown events, an attacker who knocked over the oracle could
    // hide the gap from auditors. The wiring must record either way.
    const capture = new AuditCapture();
    const attestor = new NoopLiabilityAttestor(CUSTODIAN_IDS.fireblocks);

    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-003",
      attestor,
    });

    const event = recordLiabilitySnapshot(capture, snapshot, SUBJECT);

    expect(event.kind).toBe("custodian-liability-snapshot");
    const detail = event.detail as Record<string, unknown>;
    expect(detail.liabilityUnknown).toBe(true);
    expect(detail.attestation).toBeNull();
    // The bound-to-transaction digest is still present + meaningful —
    // chain integrity holds even when liability was unattested.
    expect(detail.snapshotDigest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("audit chain remains verifiable after recording the liability event", async () => {
    const capture = new AuditCapture();
    const attestor: LiabilityAttestor = {
      custodianId: CUSTODIAN_IDS.komainu,
      async fetchAttestation() {
        return makeAttestation();
      },
    };
    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-004",
      attestor,
    });
    const event = recordLiabilitySnapshot(capture, snapshot, SUBJECT);
    expect(AuditCapture.verifyChain([event])).toBe(true);
  });
});

// ─── interleaved chain ────────────────────────────────────────────

describe("audit chain wiring: interleaved compliance + custody events", () => {
  it("hash chain stays valid across both event kinds in sequence", async () => {
    // Realistic shape of an institutional transfer's audit trail:
    //   1. compliance-conflict-resolved (jurisdictional matrix run)
    //   2. custodian-liability-snapshot (custodian liability captured)
    //   3. compliance-conflict-resolved (a second transfer in the same chain)
    //   4. custodian-liability-snapshot (with liabilityUnknown — oracle blip)
    //   5. compliance-conflict-resolved
    //
    // verifyChain must accept the whole interleaved sequence.
    const resolver = makeResolver();
    const capture = new AuditCapture();
    const attestor: LiabilityAttestor = {
      custodianId: CUSTODIAN_IDS.komainu,
      async fetchAttestation() {
        return makeAttestation();
      },
    };
    const noopAttestor = new NoopLiabilityAttestor(CUSTODIAN_IDS.fireblocks);

    const events = [];

    for (let i = 0; i < 5; i++) {
      if (i % 2 === 0) {
        const resolution = resolver.resolve({
          transactionId: `0xtx-00${i}`,
          jurisdictions: ["SG", "AE"],
          hierarchy: {
            tenantId: "wks-acme",
            orderedJurisdictions: ["SG", "AE"],
          },
        });
        events.push(recordMatrixResolution(capture, resolution, SUBJECT));
      } else {
        const snapshot = await captureLiabilitySnapshot({
          transactionId: `0xtx-00${i}`,
          attestor: i === 3 ? noopAttestor : attestor,
        });
        events.push(recordLiabilitySnapshot(capture, snapshot, SUBJECT));
      }
    }

    expect(events).toHaveLength(5);
    expect(AuditCapture.verifyChain(events)).toBe(true);

    // Sanity: kinds appear in the expected order (3 compliance + 2
    // custody events).
    expect(events.map((e) => e.kind)).toEqual([
      "compliance-conflict-resolved",
      "custodian-liability-snapshot",
      "compliance-conflict-resolved",
      "custodian-liability-snapshot",
      "compliance-conflict-resolved",
    ]);

    // Sanity: the noop-attestor event records liabilityUnknown=true.
    const unknownEvent = events[3]!;
    expect((unknownEvent.detail as Record<string, unknown>).liabilityUnknown).toBe(true);
  });

  it("tampering with the detail payload of a recorded event breaks chain verification", () => {
    // Regression-protection: a future refactor that allowed detail to
    // mutate post-record would silently break this property. By
    // pinning the test, we ensure mutation is caught immediately.
    const resolver = makeResolver();
    const capture = new AuditCapture();
    const resolution = resolver.resolve({
      transactionId: "0xtx-001",
      jurisdictions: ["US", "SG"],
      hierarchy: {
        tenantId: "wks-acme",
        orderedJurisdictions: ["SG", "US"],
      },
    });

    const event = recordMatrixResolution(capture, resolution, SUBJECT);
    // Mutate detail (in-memory tamper). verifyChain re-derives the
    // hash from the detail; it must reject this.
    (event.detail as Record<string, unknown>).transactionId = "0xtx-FAKE";

    expect(AuditCapture.verifyChain([event])).toBe(false);
  });
});
