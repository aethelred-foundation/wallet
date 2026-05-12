/**
 * `runInstitutionalComplianceDemo` — runnable proof the institutional
 * compliance pipeline composes end-to-end.
 *
 * Where `runSolverTrioDemo` exercises composition breadth across
 * three intent kinds, this demo exercises **compliance depth across
 * a single transaction class** — institutional cross-jurisdictional
 * transfers routed through a tier-1 custodian. The pipeline:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Intent: UAE bank → Singapore counterparty via Komainu       │
 *   └─────────────────────────────┬────────────────────────────────┘
 *                                 │
 *                                 ▼
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  JurisdictionalConflictResolver  (PR #147)                   │
 *   │  Detects MAS×VARA conflicts, applies tenant hierarchy        │
 *   └─────────────────────────────┬────────────────────────────────┘
 *                                 │ MatrixResolution (SHA-256 digest)
 *                                 ▼
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  recordMatrixResolution → AuditCapture       (PR #150)       │
 *   └─────────────────────────────┬────────────────────────────────┘
 *                                 │
 *                                 ▼
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  JsonFeedLiabilityAttestor                   (PR #152)       │
 *   │   + Secp256k1OracleSignatureVerifier         (PR #153)       │
 *   └─────────────────────────────┬────────────────────────────────┘
 *                                 │ CustodianLiabilityAttestation
 *                                 ▼
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  captureLiabilitySnapshot                    (PR #148)       │
 *   │  recordLiabilitySnapshot → AuditCapture      (PR #150)       │
 *   └─────────────────────────────┬────────────────────────────────┘
 *                                 │
 *                                 ▼
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  CustodianLiabilityHistogram                 (PR #164)       │
 *   │  → exportToMeter → Prometheus                (PR #165)       │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Returns a structured result with:
 *   - Per-transaction MatrixResolution + LiabilitySnapshotEvent
 *   - Full ordered audit-event sequence (verifyChain MUST pass)
 *   - Snapshot of the histogram's SLI gauges
 *   - Prometheus-formatted metric output
 *
 * Modes:
 *   - `mode: "happy"` (default) — all transactions succeed, oracle
 *     healthy, signature verifies, `unknownRate === 0`.
 *   - `mode: "deny"` — oracle unreachable for every transaction.
 *     Demonstrates the `liabilityUnknown: true` path: the audit
 *     chain STILL records the gap, transactions still settle, but
 *     `unknownRate === 1`. This is the suppression-defense property
 *     from PR #148.
 *   - `mode: "mixed"` — 80% happy + 20% deny. Produces a realistic
 *     SLI signal where `unknownRate` is meaningfully between 0 and 1.
 *
 * Sibling artifact to `runSolverTrioDemo`. Both are runnable proofs
 * with structured results designed to drop into either a CLI
 * binary, an HTML dashboard renderer, or a JSON snapshot for ops
 * / SOC-2 evidence capture.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import * as secp256k1 from "@noble/secp256k1";

import { AuditCapture, type AuditEvent } from "@aethelred/wallet-audit";

import {
  JurisdictionEngine,
  JurisdictionalConflictResolver,
  recordMatrixResolution,
  type LegalHierarchy,
  type MatrixResolution,
} from "@aethelred/wallet-compliance";

import {
  CUSTODIAN_IDS,
  JsonFeedLiabilityAttestor,
  Secp256k1OracleSignatureVerifier,
  captureLiabilitySnapshot,
  recordLiabilitySnapshot,
  type LiabilitySnapshotEvent,
} from "@aethelred/wallet-custody-adapters";

import {
  CustodianLiabilityHistogram,
  InMemoryMeter,
  liabilitySnapshotToSample,
  type PerCustodianLiabilityStats,
} from "@aethelred/wallet-observability";

// ─── Public types ──────────────────────────────────────────────────

export type InstitutionalComplianceDemoMode = "happy" | "deny" | "mixed";

export interface InstitutionalComplianceDemoConfig {
  /**
   * Happy / deny / mixed scenario selector. Default `"happy"` — the
   * pipeline executes successfully end-to-end with a healthy oracle.
   */
  readonly mode?: InstitutionalComplianceDemoMode;
  /**
   * Number of transactions to push through the pipeline. Default 5.
   * Each transaction triggers one matrix resolution + one liability
   * snapshot, so total audit events = `samples * 2`.
   */
  readonly samples?: number;
  /**
   * Override clock — used for deterministic tests. Defaults to the
   * fixture clock anchored at 2026-11-15.
   */
  readonly now?: () => number;
  /**
   * Override tenant id for the legal hierarchy. Defaults to the
   * synthetic "demo-uae-tier1-bank" tenant. Useful when an operator
   * wants to render the demo for their actual tenant id.
   */
  readonly tenantId?: string;
}

export interface InstitutionalComplianceDemoTransaction {
  /** Synthetic transaction id (hex-prefixed). */
  readonly transactionId: string;
  /** Resolution of the jurisdictional conflict matrix. */
  readonly resolution: MatrixResolution;
  /** Liability snapshot event (always populated — null attestation is encoded inside). */
  readonly liability: LiabilitySnapshotEvent;
  /**
   * `true` when this specific transaction's attestation failed.
   * Set even in `happy` mode where it'll always be `false`.
   */
  readonly liabilityUnknown: boolean;
}

export interface InstitutionalComplianceDemoResult {
  readonly mode: InstitutionalComplianceDemoMode;
  readonly tenantId: string;
  /** Ordered per-transaction details. */
  readonly transactions: ReadonlyArray<InstitutionalComplianceDemoTransaction>;
  /**
   * Every audit event captured during the run, in order.
   * `AuditCapture.verifyChain(auditEvents)` MUST return `true`.
   */
  readonly auditEvents: ReadonlyArray<AuditEvent>;
  /** Set by the runner from `AuditCapture.verifyChain` over `auditEvents`. */
  readonly auditChainValid: boolean;
  /** Snapshot of the histogram at the end of the run. */
  readonly liabilityStats: PerCustodianLiabilityStats;
  /**
   * Prometheus text output from the histogram, after a final
   * `exportToMeter` call. Useful for SOC-2 evidence capture —
   * a snapshot of the metric surface at the end of the run.
   */
  readonly prometheusOutput: string;
}

// ─── Constants ─────────────────────────────────────────────────────

/** Synthetic tenant id used as the default. */
const DEFAULT_TENANT_ID = "demo-uae-tier1-bank";

/** Anchored fixture timestamp — keeps the demo deterministic. */
const FIXTURE_TIME_MS = 1_700_000_000_000;

/** Komainu oracle id used in the synthetic feed. */
const ORACLE_ID = "chainlink:custody:komainu";

/** Custodian-side coverage stamped into the synthetic feed (=$500M in cents). */
const SYNTHETIC_COVERAGE = 50_000_000_000n;

// ─── Helpers ───────────────────────────────────────────────────────

function bytesToHex(b: Uint8Array): `0x${string}` {
  return ("0x" +
    Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(
      "",
    )) as `0x${string}`;
}

/**
 * Build a synthetic Komainu oracle keypair. Deterministic across
 * runs so the demo output is stable — last byte of the private key
 * is fixed at 7. NOT for production use.
 */
function makeOracleKeypair(): {
  readonly privateKey: Uint8Array;
  readonly publicKeyCompressed: Uint8Array;
} {
  const priv = new Uint8Array(32);
  priv[31] = 7;
  return {
    privateKey: priv,
    publicKeyCompressed: secp256k1.getPublicKey(priv, true),
  };
}

/**
 * Build a UAE config variant with `localStorageOnly: true` so the
 * canonical MAS×VARA data-exposure conflict from the feedback
 * document is reproducible. The default seed leaves
 * `localStorageOnly` unset; this override matches the documented
 * VARA personal-data law behaviour.
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
 * Build a signed JSON snapshot body that the
 * `JsonFeedLiabilityAttestor` can parse + verify.
 */
function buildSignedFeed(privateKey: Uint8Array): string {
  const body = {
    attestedAt: FIXTURE_TIME_MS,
    custodianId: CUSTODIAN_IDS.komainu,
    insuranceCoverage: `${SYNTHETIC_COVERAGE}n`, // canonical bigint-string
    insuranceCurrency: "USD",
    oracleId: ORACLE_ID,
    slaStatus: "operational",
  };
  // Mirror the attestor's canonical serializer (alphabetically sorted keys).
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

// ─── Orchestrator ────────────────────────────────────────────────

/**
 * Wires the full institutional compliance pipeline and pushes
 * `samples` synthetic transactions through it. Returns a structured
 * result suitable for a CLI binary, HTML dashboard, or SOC-2
 * evidence snapshot.
 */
export async function runInstitutionalComplianceDemo(
  config: InstitutionalComplianceDemoConfig = {},
): Promise<InstitutionalComplianceDemoResult> {
  const mode: InstitutionalComplianceDemoMode = config.mode ?? "happy";
  const samples = Math.max(1, config.samples ?? 5);
  const now = config.now ?? (() => FIXTURE_TIME_MS);
  const tenantId = config.tenantId ?? DEFAULT_TENANT_ID;

  // ─── 1. Construct every component ───────────────────────────
  const oracleKp = makeOracleKeypair();
  const resolver = makeResolver();
  const audit = new AuditCapture();
  const histogram = new CustodianLiabilityHistogram({ windowSize: 1024 });
  const meter = new InMemoryMeter();

  // AuditCapture doesn't persist events — listeners do. Collect
  // them here so the demo result includes the full ordered sequence
  // for verifyChain + auditor review.
  const auditEvents: AuditEvent[] = [];
  audit.onEvent((event) => {
    auditEvents.push(event);
  });

  const verifier = new Secp256k1OracleSignatureVerifier({
    pinnedKeys: new Map([[ORACLE_ID, [oracleKp.publicKeyCompressed]]]),
  });

  // The attestor's `fetch` is the per-mode behavior toggle. In
  // happy mode it always returns a valid signed feed; in deny
  // mode it always rejects with a 503; in mixed mode it alternates
  // based on the sample index (80/20 happy:deny).
  let sampleIdx = 0;
  const attestor = new JsonFeedLiabilityAttestor({
    custodianId: CUSTODIAN_IDS.komainu,
    feedUrl: "https://oracle.example.com/komainu",
    verifier,
    fetch: async () => {
      const i = sampleIdx;
      const shouldFail =
        mode === "deny" ||
        (mode === "mixed" && i % 5 === 4); // every 5th sample fails
      if (shouldFail) {
        return {
          ok: false,
          status: 503,
          text: async () => "service unavailable",
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => buildSignedFeed(oracleKp.privateKey),
      };
    },
    now,
  });

  const hierarchy: LegalHierarchy = {
    tenantId,
    // UAE-domiciled tenant → VARA wins overall. The demo's canonical
    // data-exposure conflict (MAS may-expose vs VARA must-mask)
    // resolves to AE/must-mask.
    orderedJurisdictions: ["AE", "SG", "US"],
  };

  // ─── 2. Push N transactions through the pipeline ─────────────
  const transactions: InstitutionalComplianceDemoTransaction[] = [];

  for (let i = 0; i < samples; i++) {
    const txId = `0xtx-demo-${i.toString().padStart(4, "0")}`;

    // Matrix resolution: applies regardless of mode (it's not
    // dependent on the oracle).
    const resolution = resolver.resolve({
      transactionId: txId,
      jurisdictions: ["SG", "AE"],
      hierarchy,
      now: () => now() + i, // distinct timestamps for verifyChain
    });
    recordMatrixResolution(audit, resolution, {
      subjectId: `agent-${tenantId}`,
      workspaceId: tenantId,
    });

    // Liability snapshot: mode-dependent. In `deny` mode the
    // attestor returns null and the captured event has
    // liabilityUnknown=true.
    sampleIdx = i;
    const snapshot = await captureLiabilitySnapshot({
      transactionId: txId,
      attestor,
      now: () => now() + i,
    });
    recordLiabilitySnapshot(audit, snapshot, {
      subjectId: `agent-${tenantId}`,
      workspaceId: tenantId,
    });

    // Feed the histogram for SLI tracking.
    const sample = liabilitySnapshotToSample(snapshot);
    if (sample) histogram.record(sample);

    transactions.push({
      transactionId: txId,
      resolution,
      liability: snapshot,
      liabilityUnknown: snapshot.liabilityUnknown,
    });
  }

  // ─── 3. Verify audit chain integrity ────────────────────────
  // Pass a defensive copy so verifyChain can sort without
  // mutating our run-order collection.
  const auditChainValid = AuditCapture.verifyChain([...auditEvents]);

  // ─── 4. Export to meter + capture Prometheus snapshot ───────
  histogram.exportToMeter(meter, { now });
  const prometheusOutput = meter.toPrometheus();

  const liabilityStats =
    histogram.snapshot(CUSTODIAN_IDS.komainu) ?? {
      // Edge case: should never happen because we always record at
      // least one sample, but provides a safe default for type
      // narrowing.
      custodianId: CUSTODIAN_IDS.komainu,
      total: 0,
      knownCount: 0,
      unknownCount: 0,
      unknownRate: 0,
      slaStatusCounts: { operational: 0, degraded: 0, unavailable: 0 },
    };

  return {
    mode,
    tenantId,
    transactions,
    auditEvents,
    auditChainValid,
    liabilityStats,
    prometheusOutput,
  };
}
