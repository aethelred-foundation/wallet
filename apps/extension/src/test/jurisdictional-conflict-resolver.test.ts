/**
 * Tests for `JurisdictionalConflictResolver` — the dynamic compliance
 * state matrix described in feedback Issue #1.
 *
 * Coverage targets:
 *
 *   1. Conflict detection per axis (data exposure, residency, KYC level,
 *      thresholds, sanctions lists).
 *   2. The canonical UAE×Singapore travel-rule scenario from the
 *      feedback document (MAS exposure vs VARA masking via residency).
 *   3. Hierarchy application — default ordering AND per-axis override.
 *   4. Fail-closed when a transaction touches an unranked jurisdiction.
 *   5. Digest stability — identical inputs produce identical SHA-256.
 *   6. Digest sensitivity — different transactions produce different
 *      digests so an auditor can't substitute one for another.
 *   7. Empty-conflict path — when all jurisdictions agree, resolution
 *      still emits a digested record (proves the matrix was evaluated).
 */

import { describe, expect, it } from "vitest";

import {
  JurisdictionalConflictResolver,
  JurisdictionEngine,
  UnrankedJurisdictionError,
  type LegalHierarchy,
  type ResolveContext,
} from "@aethelred/wallet-compliance";

function makeResolver(): {
  readonly resolver: JurisdictionalConflictResolver;
  readonly jurisdictions: JurisdictionEngine;
} {
  const jurisdictions = new JurisdictionEngine();
  // Add a custom AE config that requires local storage so the
  // canonical UAE×SG data-exposure conflict scenario is reproducible.
  // The default seed has localStorageOnly unset; the feedback document
  // describes UAE personal-data law as forbidding cross-border export,
  // which maps to localStorageOnly=true.
  const ae = jurisdictions.getConfig("AE");
  jurisdictions.addCustomConfig({
    ...ae,
    dataResidency: { ...ae.dataResidency, localStorageOnly: true },
  });
  const resolver = new JurisdictionalConflictResolver(jurisdictions);
  return { resolver, jurisdictions };
}

function baseHierarchy(
  overrides: Partial<LegalHierarchy> = {},
): LegalHierarchy {
  return {
    tenantId: "tenant-1",
    orderedJurisdictions: ["AE", "SG", "US", "GB", "EU"],
    ...overrides,
  };
}

function baseContext(
  jurisdictions: ReadonlyArray<string>,
  overrides: Partial<ResolveContext> = {},
): ResolveContext {
  return {
    transactionId: "0xtx-001",
    jurisdictions,
    hierarchy: baseHierarchy(),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

// ─── Conflict detection ────────────────────────────────────────────

describe("JurisdictionalConflictResolver.detectConflicts", () => {
  it("returns no conflicts when there's only one jurisdiction", () => {
    const { resolver } = makeResolver();
    const conflicts = resolver.detectConflicts(baseContext(["US"]));
    expect(conflicts).toHaveLength(0);
  });

  it("returns no conflicts when all jurisdictions agree on every axis", () => {
    // US and GB are both `medium`-level travel-rule + `standard` KYC in
    // the seed configs. They're not identical though — GB has
    // travelRuleThresholdUsd 1000 vs US 3000. Build a context with just
    // GB twice (impossible in real life but useful as a no-conflict
    // sanity test).
    const { resolver } = makeResolver();
    const conflicts = resolver.detectConflicts(baseContext(["GB", "GB"]));
    expect(conflicts).toHaveLength(0);
  });

  it("flags travel-rule-threshold conflict between US (3000) and AE (1000)", () => {
    const { resolver } = makeResolver();
    const conflicts = resolver.detectConflicts(baseContext(["US", "AE"]));
    const trc = conflicts.find((c) => c.axis === "travel-rule-threshold");
    expect(trc).toBeDefined();
    expect(trc!.values).toEqual({ US: 3000, AE: 1000 });
  });

  it("flags kyc-level conflict between US (standard) and SG (enhanced)", () => {
    const { resolver } = makeResolver();
    const conflicts = resolver.detectConflicts(baseContext(["US", "SG"]));
    const kyc = conflicts.find((c) => c.axis === "kyc-level");
    expect(kyc).toBeDefined();
    expect(kyc!.values).toEqual({ US: "standard", SG: "enhanced" });
  });

  it("flags ubo-threshold conflict — DEFAULT (10%) vs seeded (25%)", () => {
    // The DEFAULT strict config drops UBO threshold to 10%. Mix it
    // in with US (25%) to surface the conflict. Note: an unknown
    // jurisdiction code falls back to DEFAULT inside JurisdictionEngine.
    const { resolver, jurisdictions } = makeResolver();
    // We need to make the unknown jurisdiction recognized by the
    // hierarchy validator AND distinct from US. Add the default config
    // under a fake code "ZZ" so detectConflicts compares two different
    // configs.
    jurisdictions.addCustomConfig({
      ...jurisdictions.getConfig("DEFAULT"),
      code: "ZZ",
    });
    const conflicts = resolver.detectConflicts(
      baseContext(["US", "ZZ"], {
        hierarchy: baseHierarchy({
          orderedJurisdictions: ["US", "ZZ"],
        }),
      }),
    );
    const ubo = conflicts.find((c) => c.axis === "ubo-threshold");
    expect(ubo).toBeDefined();
    expect(ubo!.values).toEqual({ US: 25, ZZ: 10 });
  });
});

// ─── Canonical UAE × Singapore scenario from feedback doc ──────────

describe("JurisdictionalConflictResolver: canonical UAE × Singapore data-exposure scenario (feedback Issue #1)", () => {
  it("detects data-exposure conflict (SG=may-expose vs AE=must-mask) and resolves via hierarchy", () => {
    // The feedback document's canonical example: a transaction crossing
    // MAS Singapore (which requires originator data exposure for
    // travel-rule transparency) and VARA Dubai (which forbids
    // exporting that exact data outside the UAE via personal data law).
    //
    // Our seed configs encode this through `dataResidency.localStorageOnly`:
    // AE has it set (data must stay in-region) so its data-exposure
    // axis evaluates to "must-mask"; SG doesn't require residency so
    // its axis evaluates to "may-expose".
    //
    // Tenant hierarchy here puts SG ahead of AE, so SG's exposure rule
    // wins for THIS tenant. A different tenant with AE-first hierarchy
    // would get AE's masking rule. The matrix lets the same wallet
    // serve both correctly.
    const { resolver } = makeResolver();
    const ctx = baseContext(["SG", "AE"], {
      hierarchy: baseHierarchy({
        orderedJurisdictions: ["SG", "AE", "US"],
      }),
    });
    const decision = resolver.resolve(ctx);

    const exposure = decision.conflictsFound.find(
      (c) => c.axis === "data-exposure",
    );
    expect(exposure).toBeDefined();
    expect(exposure!.values).toEqual({
      SG: "may-expose",
      AE: "must-mask",
    });

    const exposureResolution = decision.resolutions.find(
      (r) => r.axis === "data-exposure",
    );
    expect(exposureResolution).toBeDefined();
    expect(exposureResolution!.winningJurisdiction).toBe("SG");
    expect(exposureResolution!.winningRule).toBe("may-expose");
  });

  it("flips winner when tenant's hierarchy puts AE ahead of SG", () => {
    // Same transaction, different tenant. Now AE wins → must-mask.
    // This is the property the feedback document said the static
    // passport couldn't deliver: per-tenant resolution of the same
    // cross-jurisdictional conflict.
    const { resolver } = makeResolver();
    const decision = resolver.resolve(
      baseContext(["SG", "AE"], {
        hierarchy: baseHierarchy({
          orderedJurisdictions: ["AE", "SG", "US"],
        }),
      }),
    );
    const exposure = decision.resolutions.find(
      (r) => r.axis === "data-exposure",
    );
    expect(exposure!.winningJurisdiction).toBe("AE");
    expect(exposure!.winningRule).toBe("must-mask");
  });

  it("per-axis override: SG wins on data-exposure, AE wins on data-residency", () => {
    // Realistic tenant config: "in general AE wins (we're an Abu Dhabi
    // bank), but for travel-rule transparency we follow MAS because
    // our Singapore counterparties demand it." Per-axis overrides let
    // the tenant tune this without forking the whole hierarchy.
    const { resolver } = makeResolver();
    const decision = resolver.resolve(
      baseContext(["SG", "AE"], {
        hierarchy: baseHierarchy({
          orderedJurisdictions: ["AE", "SG", "US"],
          perAxisOverrides: {
            "data-exposure": ["SG", "AE", "US"],
          },
        }),
      }),
    );
    const exposure = decision.resolutions.find(
      (r) => r.axis === "data-exposure",
    );
    const residency = decision.resolutions.find(
      (r) => r.axis === "data-residency",
    );
    expect(exposure!.winningJurisdiction).toBe("SG");
    expect(residency!.winningJurisdiction).toBe("AE");
    // Rationale must explicitly cite the override.
    expect(exposure!.rationale).toMatch(/per-axis override/);
    expect(residency!.rationale).toMatch(/default tenant hierarchy/);
  });
});

// ─── Hierarchy validation ──────────────────────────────────────────

describe("JurisdictionalConflictResolver: hierarchy validation (fail-closed)", () => {
  it("throws UnrankedJurisdictionError when transaction touches a jurisdiction the tenant hasn't ranked", () => {
    const { resolver } = makeResolver();
    expect(() =>
      resolver.resolve(
        baseContext(["US", "AE", "JP"], {
          hierarchy: baseHierarchy({
            orderedJurisdictions: ["US", "AE"], // JP not present
          }),
        }),
      ),
    ).toThrowError(UnrankedJurisdictionError);
  });

  it("UnrankedJurisdictionError carries the offending jurisdiction + tenant in details", () => {
    const { resolver } = makeResolver();
    let caught: unknown;
    try {
      resolver.resolve(
        baseContext(["US", "JP"], {
          hierarchy: baseHierarchy({
            tenantId: "acme-bank",
            orderedJurisdictions: ["US"],
          }),
        }),
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnrankedJurisdictionError);
    const err = caught as UnrankedJurisdictionError;
    expect(err.code).toBe("unranked-jurisdiction");
    expect(err.details).toEqual({
      jurisdiction: "JP",
      tenantId: "acme-bank",
    });
  });
});

// ─── Audit-chain digest properties ─────────────────────────────────

describe("JurisdictionalConflictResolver: digest stability + sensitivity", () => {
  it("identical inputs produce identical digests (audit replay-ability)", () => {
    const { resolver } = makeResolver();
    const a = resolver.resolve(baseContext(["US", "SG"]));
    const b = resolver.resolve(baseContext(["US", "SG"]));
    expect(a.digest).toBe(b.digest);
  });

  it("changing transactionId changes digest (auditor can't substitute records)", () => {
    const { resolver } = makeResolver();
    const a = resolver.resolve(baseContext(["US", "SG"]));
    const b = resolver.resolve(
      baseContext(["US", "SG"], { transactionId: "0xtx-002" }),
    );
    expect(a.digest).not.toBe(b.digest);
  });

  it("changing hierarchy ordering changes digest (decision provenance is part of the hash)", () => {
    const { resolver } = makeResolver();
    const a = resolver.resolve(
      baseContext(["US", "SG"], {
        hierarchy: baseHierarchy({ orderedJurisdictions: ["US", "SG"] }),
      }),
    );
    const b = resolver.resolve(
      baseContext(["US", "SG"], {
        hierarchy: baseHierarchy({ orderedJurisdictions: ["SG", "US"] }),
      }),
    );
    expect(a.digest).not.toBe(b.digest);
  });

  it("digest is a 0x-prefixed 32-byte hex string", () => {
    const { resolver } = makeResolver();
    const decision = resolver.resolve(baseContext(["US", "SG"]));
    expect(decision.digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("jurisdiction-list permutation does NOT change digest (canonical sort)", () => {
    // Auditors should be able to verify a transaction's compliance
    // record regardless of the order jurisdictions were enumerated by
    // the caller.
    const { resolver } = makeResolver();
    const a = resolver.resolve(baseContext(["US", "SG", "EU"]));
    const b = resolver.resolve(baseContext(["EU", "US", "SG"]));
    expect(a.digest).toBe(b.digest);
  });
});

// ─── No-conflict path ──────────────────────────────────────────────

describe("JurisdictionalConflictResolver: empty-conflict resolution still emits a record", () => {
  it("resolve() returns digested MatrixResolution even when no conflicts exist", () => {
    // Even when every jurisdiction agrees, audit consumers need a
    // record that the matrix was evaluated for the transaction.
    // Otherwise an attacker who suppressed events could later claim
    // "we never checked."
    const { resolver } = makeResolver();
    const decision = resolver.resolve(baseContext(["US"]));
    expect(decision.conflictsFound).toEqual([]);
    expect(decision.resolutions).toEqual([]);
    expect(decision.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(decision.transactionId).toBe("0xtx-001");
    expect(decision.resolvedAt).toBe(1_700_000_000_000);
  });
});
