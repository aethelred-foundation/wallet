/**
 * Tests for the custodian liability attestation module — closing the
 * audit-chain dark spot at the third-party custodian API boundary
 * (feedback Issue #2).
 *
 * Coverage targets:
 *
 *   1. Successful attestation from a real attestor → liabilitySnapshot
 *      includes the snapshot + a digest binding it to the transaction.
 *   2. Attestor returns null (oracle unreachable) → snapshot includes
 *      `liabilityUnknown: true`. Transaction NOT blocked.
 *   3. Attestor THROWS (buggy implementation) → still safely produces
 *      a snapshot with `liabilityUnknown: true`.
 *   4. Digest stability — same inputs produce same hash; different
 *      transaction id produces different hash; different attestation
 *      produces different hash.
 *   5. Cache wrapper: hits within TTL skip inner attestor; expiry
 *      forces a fresh fetch; null responses do NOT poison the cache.
 *   6. Liability-unknown events still hash deterministically (so chain
 *      integrity holds even when the oracle is down).
 */

import { describe, expect, it, vi } from "vitest";

import {
  CachingLiabilityAttestor,
  CUSTODIAN_IDS,
  captureLiabilitySnapshot,
  NoopLiabilityAttestor,
  type CustodianLiabilityAttestation,
  type LiabilityAttestor,
} from "@aethelred/wallet-custody-adapters";

function makeAttestation(
  overrides: Partial<CustodianLiabilityAttestation> = {},
): CustodianLiabilityAttestation {
  return {
    custodianId: CUSTODIAN_IDS.komainu,
    slaStatus: "operational",
    insuranceCoverage: 500_000_000_00n, // $500M in cents
    insuranceCurrency: "USD",
    attestedAt: 1_700_000_000_000,
    oracleId: "chainlink:custody:komainu",
    signature: ("0x" + "ab".repeat(32)) as `0x${string}`,
    ...overrides,
  };
}

function makeAttestor(opts: {
  readonly custodianId?: string;
  readonly attestation?: CustodianLiabilityAttestation | null;
  readonly throwOnFetch?: boolean;
}): LiabilityAttestor {
  return {
    custodianId: opts.custodianId ?? CUSTODIAN_IDS.komainu,
    async fetchAttestation() {
      if (opts.throwOnFetch) throw new Error("oracle unreachable");
      return opts.attestation ?? null;
    },
  };
}

// ─── Successful path ───────────────────────────────────────────────

describe("captureLiabilitySnapshot: successful attestation", () => {
  it("returns a snapshot with the attestation, liabilityUnknown=false, and a digest", async () => {
    const attestation = makeAttestation();
    const attestor = makeAttestor({ attestation });
    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor,
      now: () => 1_700_000_000_500,
    });
    expect(snapshot.kind).toBe("custodian-liability-snapshot");
    expect(snapshot.transactionId).toBe("0xtx-001");
    expect(snapshot.custodianId).toBe(CUSTODIAN_IDS.komainu);
    expect(snapshot.attestation).toEqual(attestation);
    expect(snapshot.liabilityUnknown).toBe(false);
    expect(snapshot.capturedAt).toBe(1_700_000_000_500);
    expect(snapshot.digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("captures the canonical $500M Komainu scenario from the feedback doc", async () => {
    // The feedback document's specific example: "Komainu currently has
    // $500 million in active insurance coverage and their SLA is
    // fully operational." Verify the snapshot can encode that and the
    // event surfaces it cleanly to the audit chain.
    const attestation = makeAttestation({
      custodianId: CUSTODIAN_IDS.komainu,
      slaStatus: "operational",
      insuranceCoverage: 500_000_000_00n,
      insuranceCurrency: "USD",
    });
    const attestor = makeAttestor({ attestation });
    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-002",
      attestor,
      now: () => 1_700_000_000_000,
    });
    expect(snapshot.attestation).not.toBeNull();
    expect(snapshot.attestation!.insuranceCoverage).toBe(50_000_000_000n);
    expect(snapshot.attestation!.slaStatus).toBe("operational");
    expect(snapshot.liabilityUnknown).toBe(false);
  });
});

// ─── Fail-graceful path ────────────────────────────────────────────

describe("captureLiabilitySnapshot: fail-graceful when oracle is unreachable", () => {
  it("attestor returns null → snapshot has liabilityUnknown=true (transaction NOT blocked)", async () => {
    const attestor = makeAttestor({ attestation: null });
    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-003",
      attestor,
      now: () => 1_700_000_000_000,
    });
    expect(snapshot.attestation).toBeNull();
    expect(snapshot.liabilityUnknown).toBe(true);
    // Critical invariant: even when liability is unknown the snapshot
    // STILL has a deterministic digest, so chain integrity holds and
    // an auditor can later prove "we tried to attest at this exact
    // millisecond and got nothing."
    expect(snapshot.digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("attestor throws → snapshot still produced with liabilityUnknown=true (defends buggy implementations)", async () => {
    // The LiabilityAttestor contract documents that implementations
    // should return null instead of throwing, but defend against bugs:
    // a thrown error should NOT crash the wallet's transaction flow.
    const attestor = makeAttestor({ throwOnFetch: true });
    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-004",
      attestor,
    });
    expect(snapshot.attestation).toBeNull();
    expect(snapshot.liabilityUnknown).toBe(true);
  });

  it("NoopLiabilityAttestor always yields liabilityUnknown=true", async () => {
    // Used in tests + dev where there's no oracle to call. Snapshot
    // should still be a valid event; just one with no liability data.
    const attestor = new NoopLiabilityAttestor(CUSTODIAN_IDS.fireblocks);
    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-005",
      attestor,
    });
    expect(snapshot.attestation).toBeNull();
    expect(snapshot.liabilityUnknown).toBe(true);
    expect(snapshot.custodianId).toBe(CUSTODIAN_IDS.fireblocks);
  });
});

// ─── Digest properties ────────────────────────────────────────────

describe("liability snapshot digest: stability + sensitivity", () => {
  it("identical inputs → identical digest (audit replay)", async () => {
    const a = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor: makeAttestor({ attestation: makeAttestation() }),
      now: () => 1_700_000_000_000,
    });
    const b = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor: makeAttestor({ attestation: makeAttestation() }),
      now: () => 1_700_000_000_000,
    });
    expect(a.digest).toBe(b.digest);
  });

  it("different transactionId → different digest (no record substitution)", async () => {
    const att = makeAttestation();
    const a = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor: makeAttestor({ attestation: att }),
    });
    const b = await captureLiabilitySnapshot({
      transactionId: "0xtx-002",
      attestor: makeAttestor({ attestation: att }),
    });
    expect(a.digest).not.toBe(b.digest);
  });

  it("different insuranceCoverage → different digest (snapshot integrity)", async () => {
    const a = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor: makeAttestor({
        attestation: makeAttestation({ insuranceCoverage: 50_000_000_000n }),
      }),
    });
    const b = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor: makeAttestor({
        attestation: makeAttestation({ insuranceCoverage: 25_000_000_000n }),
      }),
    });
    expect(a.digest).not.toBe(b.digest);
  });

  it("liability-unknown events still hash deterministically", async () => {
    // Critical for chain integrity: an oracle outage must not produce
    // non-deterministic events. Two unknown-events for the same
    // transaction id + custodian must produce the same digest so the
    // audit chain can validate them.
    const a = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor: makeAttestor({ attestation: null }),
    });
    const b = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor: makeAttestor({ attestation: null }),
    });
    expect(a.digest).toBe(b.digest);
  });

  it("operational vs degraded SLA status → different digest", async () => {
    const a = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor: makeAttestor({
        attestation: makeAttestation({ slaStatus: "operational" }),
      }),
    });
    const b = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor: makeAttestor({
        attestation: makeAttestation({ slaStatus: "degraded" }),
      }),
    });
    expect(a.digest).not.toBe(b.digest);
  });
});

// ─── Cache wrapper ────────────────────────────────────────────────

describe("CachingLiabilityAttestor", () => {
  it("first call hits inner; subsequent calls within TTL skip inner", async () => {
    const inner = vi.fn(async () => makeAttestation());
    const innerAttestor: LiabilityAttestor = {
      custodianId: CUSTODIAN_IDS.komainu,
      fetchAttestation: inner,
    };
    let nowMs = 1_700_000_000_000;
    const cached = new CachingLiabilityAttestor(innerAttestor, {
      ttlMs: 60_000,
      now: () => nowMs,
    });

    await cached.fetchAttestation();
    await cached.fetchAttestation();
    await cached.fetchAttestation();
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("TTL expiry forces a fresh inner fetch", async () => {
    const inner = vi.fn(async () => makeAttestation());
    const innerAttestor: LiabilityAttestor = {
      custodianId: CUSTODIAN_IDS.komainu,
      fetchAttestation: inner,
    };
    let nowMs = 1_700_000_000_000;
    const cached = new CachingLiabilityAttestor(innerAttestor, {
      ttlMs: 60_000,
      now: () => nowMs,
    });

    await cached.fetchAttestation();
    nowMs += 60_001; // past TTL
    await cached.fetchAttestation();
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("null responses are NOT cached (subsequent call retries inner)", async () => {
    // The cache deliberately doesn't poison itself with null responses.
    // An oracle outage at T=0 shouldn't cause the next 60s of
    // transactions to all show liabilityUnknown=true if the oracle
    // recovers at T=1s.
    let nullThenValue = 0;
    const inner = vi.fn(async () => {
      nullThenValue += 1;
      return nullThenValue === 1 ? null : makeAttestation();
    });
    const innerAttestor: LiabilityAttestor = {
      custodianId: CUSTODIAN_IDS.komainu,
      fetchAttestation: inner,
    };
    const cached = new CachingLiabilityAttestor(innerAttestor, {
      ttlMs: 60_000,
      now: () => 1_700_000_000_000,
    });

    const r1 = await cached.fetchAttestation();
    const r2 = await cached.fetchAttestation();
    expect(r1).toBeNull();
    expect(r2).not.toBeNull();
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("invalidate() clears the cached entry", async () => {
    const inner = vi.fn(async () => makeAttestation());
    const innerAttestor: LiabilityAttestor = {
      custodianId: CUSTODIAN_IDS.komainu,
      fetchAttestation: inner,
    };
    const cached = new CachingLiabilityAttestor(innerAttestor, {
      ttlMs: 60_000,
      now: () => 1_700_000_000_000,
    });

    await cached.fetchAttestation();
    await cached.fetchAttestation();
    expect(inner).toHaveBeenCalledTimes(1);

    cached.invalidate();
    await cached.fetchAttestation();
    expect(inner).toHaveBeenCalledTimes(2);
  });
});

// ─── Canonical custodian ids ──────────────────────────────────────

describe("CUSTODIAN_IDS", () => {
  it("exports the four tier-1 custodians named in the master plan", () => {
    expect(CUSTODIAN_IDS).toEqual({
      fireblocks: "fireblocks",
      komainu: "komainu",
      blockdaemon: "blockdaemon",
      hextrust: "hextrust",
    });
  });
});
