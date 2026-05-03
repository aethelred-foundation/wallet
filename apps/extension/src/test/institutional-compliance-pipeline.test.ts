/**
 * End-to-end integration test for the institutional compliance
 * pipeline.
 *
 * Wires together every component shipped in this session and exercises
 * a single realistic transaction through the full flow:
 *
 *   JurisdictionalConflictResolver       (PR #147)
 *      ↓ MatrixResolution + digest
 *   recordMatrixResolution → AuditCapture (PR #150)
 *
 *   JsonFeedLiabilityAttestor             (PR #152)
 *      with Secp256k1OracleSignatureVerifier (PR #153)
 *      ↓ LiabilitySnapshotEvent + bound digest
 *   captureLiabilitySnapshot              (PR #148)
 *      ↓
 *   recordLiabilitySnapshot → AuditCapture (PR #150)
 *
 *   AuditCapture.verifyChain → true (chain integrity holds end-to-end)
 *
 * Doubles as executable documentation: contributors looking at how
 * the pipeline composes can read this file as a working code example.
 *
 * Scenario:
 *   A UAE-domiciled tier-1 bank sends a $5M tokenized-asset transfer
 *   to a Singapore counterparty, routed through Komainu as the
 *   custodian. The transaction crosses MAS (Singapore) and VARA (UAE)
 *   simultaneously and triggers the canonical jurisdictional conflict
 *   from the feedback document.
 */

import { describe, expect, it } from "vitest";

import * as secp256k1 from "@noble/secp256k1";
import { sha256 } from "@noble/hashes/sha2.js";

import { AuditCapture } from "@aethelred/wallet-audit";

import {
  JurisdictionEngine,
  JurisdictionalConflictResolver,
  recordMatrixResolution,
} from "@aethelred/wallet-compliance";

import {
  CUSTODIAN_IDS,
  JsonFeedLiabilityAttestor,
  Secp256k1OracleSignatureVerifier,
  captureLiabilitySnapshot,
  recordLiabilitySnapshot,
} from "@aethelred/wallet-custody-adapters";

// ─── Shared scenario fixtures ──────────────────────────────────────

const NOW_MS = 1_700_000_000_500;
const ATTESTED_AT_MS = 1_700_000_000_000;

const SUBJECT = {
  subjectId: "agent-treasurer-001",
  workspaceId: "wks-acme-bank-uae",
};

const ORACLE_ID = "chainlink:custody:komainu";

function bytesToHex(b: Uint8Array): `0x${string}` {
  return ("0x" +
    Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

/**
 * Synthetic Komainu oracle keypair. In production the operator pins
 * the real Komainu attestation public key.
 */
function makeOracleKeypair(): {
  readonly privateKey: Uint8Array;
  readonly publicKeyCompressed: Uint8Array;
} {
  const priv = new Uint8Array(32);
  // Deterministic non-zero key — last byte = 7 to keep the test
  // reproducible across runs.
  priv[31] = 7;
  return {
    privateKey: priv,
    publicKeyCompressed: secp256k1.getPublicKey(priv, true),
  };
}

/**
 * Build a custom resolver. UAE seeded config has localStorageOnly=true
 * so the data-exposure axis evaluates to "must-mask" — required to
 * reproduce the canonical MAS×VARA scenario from the feedback doc.
 */
function makeResolver(): JurisdictionalConflictResolver {
  const jurisdictions = new JurisdictionEngine();
  const ae = jurisdictions.getConfig("AE");
  jurisdictions.addCustomConfig({
    ...ae,
    dataResidency: { ...ae.dataResidency, localStorageOnly: true },
  });
  return new JurisdictionalConflictResolver(jurisdictions);
}

/**
 * Build a signed JSON feed body for the scenario's custodian
 * snapshot. The signing payload is the canonical-key-sorted JSON
 * EXCLUDING the signature field — same convention the
 * JsonFeedLiabilityAttestor uses internally.
 */
function buildSignedFeed(privateKey: Uint8Array): string {
  const body = {
    attestedAt: ATTESTED_AT_MS,
    custodianId: CUSTODIAN_IDS.komainu,
    insuranceCoverage: "50000000000n", // $500M (in cents, bigint-string form)
    insuranceCurrency: "USD",
    oracleId: ORACLE_ID,
    slaStatus: "operational",
  };
  const canonical = `{${Object.keys(body)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${JSON.stringify(
          (body as Record<string, unknown>)[k],
        )}`,
    )
    .join(",")}}`;
  const digest = sha256(new TextEncoder().encode(canonical));
  const sig = secp256k1.sign(digest, privateKey, { lowS: true });
  return JSON.stringify({
    ...body,
    signature: bytesToHex(sig.toCompactRawBytes()),
  });
}

// ─── Pipeline integration test ────────────────────────────────────

describe("end-to-end: institutional compliance pipeline (UAE×Singapore $5M scenario)", () => {
  it("composes resolver + verifier + attestor + audit chain into a single tamper-evident transaction record", async () => {
    // ─── 1. Construct every component in the pipeline ──────────
    const oracleKp = makeOracleKeypair();
    const resolver = makeResolver();
    const audit = new AuditCapture();

    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([[ORACLE_ID, [oracleKp.publicKeyCompressed]]]),
    });

    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier,
      // Synthetic feed: returns a signed JSON snapshot. In production
      // this hits Komainu's signed attestation API.
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => buildSignedFeed(oracleKp.privateKey),
      }),
      now: () => NOW_MS,
    });

    const txId = "0xtx-uae-sg-5m-001";

    // ─── 2. Resolve the jurisdictional conflict matrix ─────────
    //
    // The transaction crosses MAS (Singapore) and VARA (UAE).
    // - SG seed config: dataResidency.required=false → "may-expose"
    // - AE custom config: localStorageOnly=true → "must-mask"
    //
    // Tenant hierarchy puts AE first because the bank is UAE-domiciled,
    // so VARA's masking rule wins. SG's exposure rule on data-exposure
    // is overridden but recorded.
    const resolution = resolver.resolve({
      transactionId: txId,
      jurisdictions: ["SG", "AE"],
      hierarchy: {
        tenantId: SUBJECT.workspaceId,
        orderedJurisdictions: ["AE", "SG"],
      },
      now: () => NOW_MS,
    });

    // The matrix correctly identified the canonical data-exposure
    // conflict from the feedback document.
    const exposure = resolution.conflictsFound.find(
      (c) => c.axis === "data-exposure",
    );
    expect(exposure).toBeDefined();
    expect(exposure!.values).toEqual({
      AE: "must-mask",
      SG: "may-expose",
    });

    // VARA wins per the hierarchy.
    const exposureRes = resolution.resolutions.find(
      (r) => r.axis === "data-exposure",
    );
    expect(exposureRes!.winningJurisdiction).toBe("AE");
    expect(exposureRes!.winningRule).toBe("must-mask");

    // ─── 3. Record the matrix decision to the audit chain ──────
    const matrixEvent = recordMatrixResolution(audit, resolution, SUBJECT);
    expect(matrixEvent.kind).toBe("compliance-conflict-resolved");
    expect(
      (matrixEvent.detail as { resolutionDigest: string }).resolutionDigest,
    ).toBe(resolution.digest);

    // ─── 4. Capture the custodian liability snapshot ───────────
    //
    // The attestor fetches Komainu's signed JSON, verifies the
    // signature against the pinned secp256k1 key, applies the
    // freshness gate, and returns the parsed attestation. Then
    // captureLiabilitySnapshot wraps it with a transaction-bound
    // digest.
    const snapshot = await captureLiabilitySnapshot({
      transactionId: txId,
      attestor,
      now: () => NOW_MS,
    });

    expect(snapshot.liabilityUnknown).toBe(false);
    expect(snapshot.attestation).not.toBeNull();
    expect(snapshot.attestation!.custodianId).toBe(CUSTODIAN_IDS.komainu);
    // The exact $500M coverage from the feedback document.
    expect(snapshot.attestation!.insuranceCoverage).toBe(50_000_000_000n);
    expect(snapshot.attestation!.slaStatus).toBe("operational");

    // ─── 5. Record the snapshot to the audit chain ─────────────
    const snapshotEvent = recordLiabilitySnapshot(audit, snapshot, SUBJECT);
    expect(snapshotEvent.kind).toBe("custodian-liability-snapshot");
    expect(
      (snapshotEvent.detail as { snapshotDigest: string }).snapshotDigest,
    ).toBe(snapshot.digest);

    // ─── 6. Audit chain integrity holds across both events ─────
    //
    // verifyChain re-derives every event's hash from sequence +
    // timestamp + kind + detail + previousHash and confirms the link
    // chain. This is the property an external auditor checks.
    expect(AuditCapture.verifyChain([matrixEvent, snapshotEvent])).toBe(true);

    // ─── 7. Both events bind to the same transaction ───────────
    //
    // intentId defaults to the transaction id (per recordMatrix-
    // Resolution + recordLiabilitySnapshot). Audit consumers can
    // query "show me everything for tx 0xtx-uae-sg-5m-001" without
    // joining across multiple keys.
    expect(matrixEvent.intentId).toBe(txId);
    expect(snapshotEvent.intentId).toBe(txId);
  });

  it("fails closed when the oracle's signature is invalid, but transaction still proceeds with liabilityUnknown=true", async () => {
    // Adversarial scenario: the JSON feed returns a snapshot with the
    // CORRECT shape but signed by an attacker (different keypair).
    // The verifier's pinned key rejects it. The attestor returns null.
    // captureLiabilitySnapshot stamps the event with
    // liabilityUnknown=true. The audit chain still records the gap —
    // the auditor can later see the wallet TRIED to attest at this
    // exact millisecond and the verification failed.
    //
    // Critical: the transaction itself must NOT be blocked. Wallet
    // liveness doesn't depend on oracle availability.
    const realKp = makeOracleKeypair();
    const attackerKp = (() => {
      const p = new Uint8Array(32);
      p[31] = 99;
      return { privateKey: p, publicKeyCompressed: secp256k1.getPublicKey(p, true) };
    })();

    const audit = new AuditCapture();
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([[ORACLE_ID, [realKp.publicKeyCompressed]]]),
    });
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier,
      // Feed signed by attacker, NOT by the pinned real key.
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => buildSignedFeed(attackerKp.privateKey),
      }),
      now: () => NOW_MS,
    });

    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-attacked-001",
      attestor,
      now: () => NOW_MS,
    });
    expect(snapshot.liabilityUnknown).toBe(true);
    expect(snapshot.attestation).toBeNull();

    // The audit chain still records the gap (this is the suppression
    // defense — without it, an attacker who knocked over the oracle
    // could hide the gap from auditors).
    const event = recordLiabilitySnapshot(audit, snapshot, SUBJECT);
    expect(event.kind).toBe("custodian-liability-snapshot");
    expect(
      (event.detail as { liabilityUnknown: boolean }).liabilityUnknown,
    ).toBe(true);
    expect(AuditCapture.verifyChain([event])).toBe(true);
  });

  it("compose: 5-tx audit trail with matrix + liability for each transaction stays verifiable", async () => {
    // Operational acceptance test — the kind of audit trail an SRE
    // sees in the wild. Each of 5 sequential transactions emits a
    // matrix-resolution event followed by a liability-snapshot event,
    // for a total of 10 audit events. verifyChain across the full
    // sequence must hold.
    //
    // This is the test that fails if a future refactor introduces
    // any non-determinism or any cross-event interference (e.g., a
    // global counter that's not properly reset, a singleton that
    // leaks state across resolves).
    const oracleKp = makeOracleKeypair();
    const resolver = makeResolver();
    const audit = new AuditCapture();
    const verifier = new Secp256k1OracleSignatureVerifier({
      pinnedKeys: new Map([[ORACLE_ID, [oracleKp.publicKeyCompressed]]]),
    });
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier,
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => buildSignedFeed(oracleKp.privateKey),
      }),
      now: () => NOW_MS,
    });

    const events = [];
    for (let i = 0; i < 5; i++) {
      const txId = `0xtx-batch-${i.toString().padStart(3, "0")}`;
      const resolution = resolver.resolve({
        transactionId: txId,
        jurisdictions: ["SG", "AE"],
        hierarchy: {
          tenantId: SUBJECT.workspaceId,
          orderedJurisdictions: ["AE", "SG"],
        },
        now: () => NOW_MS + i, // distinct timestamps
      });
      events.push(recordMatrixResolution(audit, resolution, SUBJECT));

      const snapshot = await captureLiabilitySnapshot({
        transactionId: txId,
        attestor,
        now: () => NOW_MS + i,
      });
      events.push(recordLiabilitySnapshot(audit, snapshot, SUBJECT));
    }

    expect(events).toHaveLength(10);
    expect(AuditCapture.verifyChain(events)).toBe(true);

    // Sanity: alternating kinds (matrix then liability, ×5).
    expect(events.map((e) => e.kind)).toEqual([
      "compliance-conflict-resolved",
      "custodian-liability-snapshot",
      "compliance-conflict-resolved",
      "custodian-liability-snapshot",
      "compliance-conflict-resolved",
      "custodian-liability-snapshot",
      "compliance-conflict-resolved",
      "custodian-liability-snapshot",
      "compliance-conflict-resolved",
      "custodian-liability-snapshot",
    ]);
  });
});
