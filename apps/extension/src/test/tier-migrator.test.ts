/**
 * Moat #5 — Tiered Deployment with Data Continuity.
 *
 * The suite exercises every surface of the graduation engine:
 *
 *   - `getTierPreset` (distinctness, regulatory floors, jurisdiction overlay).
 *   - `TierMigrator.planMigration` (upgrade, lateral, downgrade, jurisdiction).
 *   - `TierMigrator.executeMigration` (receipt shape, lineage, audit-link).
 *   - `TierMigrator.verifyContinuity` (success + audit-chain-break detection).
 *   - `InMemoryTenantProfileStore` (round-trip, lineage traversal, filters).
 *   - Frozen-preset invariant (Object.freeze enforcement).
 *   - Compliance invariants (OFAC floor, 90-day retention floor).
 *
 * Every test is deterministic: injected clock + injected id generator
 * feed stable inputs into `computePlanHash`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  TierMigrator,
  InMemoryTenantProfileStore,
  TierMigrationError,
  getTierPreset,
  materializeTenantProfile,
  ALL_TIER_PRESETS,
  PERSONAL_TIER_DEFAULTS,
  ENTERPRISE_TIER_DEFAULTS,
  SOVEREIGN_TIER_DEFAULTS,
  MANAGED_SHARED_CLOUD,
  MANAGED_DEDICATED_TENANT,
  MANAGED_INSTITUTIONAL,
  computePlanHash,
  TIER_RANK,
  type TenantProfile,
  type TierLevel,
  type AuditRef,
  type CredentialRef,
  type WorkflowRef,
} from "@aethelred/wallet-deployment";

/* ─── Test fixtures ────────────────────────────────────────────────── */

const FIXED_NOW = 1_710_000_000_000;
let idCounter = 0;
const fixedIdGenerator = (): string => {
  idCounter += 1;
  return `tenant-fixed-${idCounter.toString().padStart(4, "0")}`;
};

/**
 * Build a fresh tenant profile at the requested tier with a
 * deterministic tenantId for test stability.
 */
function buildTenant(
  tier: TierLevel,
  overrides: Partial<TenantProfile> = {}
): TenantProfile {
  const preset = getTierPreset(tier, overrides.jurisdiction ?? "US");
  return {
    ...materializeTenantProfile(preset, {
      tenantId: overrides.tenantId ?? `tenant-base-${tier}`,
      workspaceId: overrides.workspaceId ?? "ws-primary",
      createdAt: overrides.createdAt ?? FIXED_NOW - 1_000_000,
    }),
    ...overrides,
  };
}

/** Minimal audit ref — counts events and appends a migration link. */
class StubAuditRef implements AuditRef {
  private counts = new Map<string, number>();
  private lastHashes = new Map<string, string>();
  public appended: Array<{
    fromTenantId: string;
    toTenantId: string;
    planHash: `0x${string}`;
    previousHash: string;
  }> = [];

  seed(tenantId: string, count: number, lastHash = `0xlast-${tenantId}`) {
    this.counts.set(tenantId, count);
    this.lastHashes.set(tenantId, lastHash);
  }

  async countForTenant(tenantId: string): Promise<number> {
    return this.counts.get(tenantId) ?? 0;
  }
  async lastHashForTenant(tenantId: string): Promise<string> {
    return this.lastHashes.get(tenantId) ?? "0x0";
  }
  async appendMigrationLink(opts: {
    fromTenantId: string;
    toTenantId: string;
    planHash: `0x${string}`;
    executedAt: number;
    previousHash: string;
  }): Promise<{ newTailHash: string }> {
    this.appended.push({
      fromTenantId: opts.fromTenantId,
      toTenantId: opts.toTenantId,
      planHash: opts.planHash,
      previousHash: opts.previousHash,
    });
    const newHash = `0xlink-${opts.toTenantId}`;
    this.counts.set(
      opts.toTenantId,
      (this.counts.get(opts.fromTenantId) ?? 0) + 1
    );
    this.lastHashes.set(opts.toTenantId, newHash);
    return { newTailHash: newHash };
  }

  /** Helper used by the audit-chain-break test to drop successor events. */
  forceSuccessorCount(tenantId: string, count: number): void {
    this.counts.set(tenantId, count);
  }
}

class StubCredentialRef implements CredentialRef {
  private counts = new Map<string, number>();
  public invalidateOnCheck = false;

  seed(tenantId: string, count: number) {
    this.counts.set(tenantId, count);
  }
  async countForTenant(tenantId: string): Promise<number> {
    return this.counts.get(tenantId) ?? 0;
  }
  async revalidateForLineage() {
    if (this.invalidateOnCheck) {
      return { valid: false, invalidCredentialIds: ["cred-leak-1"] };
    }
    return { valid: true, invalidCredentialIds: [] };
  }
}

class StubWorkflowRef implements WorkflowRef {
  private counts = new Map<string, number>();
  seed(tenantId: string, count: number) {
    this.counts.set(tenantId, count);
  }
  async countForTenant(tenantId: string): Promise<number> {
    return this.counts.get(tenantId) ?? 0;
  }
}

function makeMigrator(opts?: {
  store?: InMemoryTenantProfileStore;
  audit?: StubAuditRef;
  credentials?: StubCredentialRef;
  workflows?: StubWorkflowRef;
}) {
  const store = opts?.store ?? new InMemoryTenantProfileStore();
  return {
    store,
    audit: opts?.audit,
    credentials: opts?.credentials,
    workflows: opts?.workflows,
    migrator: new TierMigrator({
      profileStore: store,
      auditStore: opts?.audit,
      credentialStore: opts?.credentials,
      workflowStore: opts?.workflows,
      now: () => FIXED_NOW,
      idGenerator: fixedIdGenerator,
    }),
  };
}

beforeEach(() => {
  idCounter = 0;
});

/* ─── Preset + invariant tests ─────────────────────────────────────── */

describe("tier presets", () => {
  it("getTierPreset returns distinct profiles for every tier", () => {
    const tiers: TierLevel[] = [
      "personal",
      "enterprise",
      "sovereign",
      "managed-shared",
      "managed-dedicated",
      "managed-institutional",
    ];
    const digests = tiers.map((t) => JSON.stringify(getTierPreset(t, "US")));
    const uniq = new Set(digests);
    expect(uniq.size).toBe(tiers.length);
  });

  it("Enterprise has stricter posture than Personal (higher limits AND more compliance)", () => {
    const personal = getTierPreset("personal", "US");
    const enterprise = getTierPreset("enterprise", "US");
    expect(enterprise.limits.maxDailyTransactionsUsd).toBeGreaterThan(
      personal.limits.maxDailyTransactionsUsd
    );
    expect(enterprise.complianceProfile.regulatoryReports.length).toBeGreaterThan(
      personal.complianceProfile.regulatoryReports.length
    );
    expect(enterprise.complianceProfile.travelRuleRequired).toBe(true);
    expect(personal.complianceProfile.travelRuleRequired).toBe(false);
  });

  it("Sovereign tier enables notarizedAuditChain by default", () => {
    const sovereign = getTierPreset("sovereign", "AE");
    expect(sovereign.features.notarizedAuditChain).toBe(true);
    expect(sovereign.auditRetention.notarizeToL1).toBe(true);
  });

  it("Managed tiers vary hostingProfile.dedicatedInfra (shared vs dedicated vs institutional)", () => {
    expect(MANAGED_SHARED_CLOUD.hostingProfile.dedicatedInfra).toBe(false);
    expect(MANAGED_DEDICATED_TENANT.hostingProfile.dedicatedInfra).toBe(true);
    expect(MANAGED_INSTITUTIONAL.hostingProfile.dedicatedInfra).toBe(true);
    expect(MANAGED_SHARED_CLOUD.hostingProfile.byoKms).toBe(false);
    expect(MANAGED_INSTITUTIONAL.hostingProfile.byoKms).toBe(true);
  });

  it("Institutional tier enables byoKms by default", () => {
    expect(MANAGED_INSTITUTIONAL.hostingProfile.byoKms).toBe(true);
  });

  it("Institutional tier underwrites ≥ 100M monthly volume", () => {
    expect(
      MANAGED_INSTITUTIONAL.limits.maxMonthlyTransactionsUsd
    ).toBeGreaterThanOrEqual(100_000_000);
  });

  it("tier presets are frozen (mutating throws or is a no-op under freeze)", () => {
    expect(Object.isFrozen(PERSONAL_TIER_DEFAULTS)).toBe(true);
    expect(Object.isFrozen(ENTERPRISE_TIER_DEFAULTS.limits)).toBe(true);
    expect(Object.isFrozen(SOVEREIGN_TIER_DEFAULTS.features)).toBe(true);
    // Attempt mutation — strict mode throws; non-strict silently ignores
    // and the value remains unchanged.
    const before = PERSONAL_TIER_DEFAULTS.limits.maxSingleTransactionUsd;
    expect(() => {
      (PERSONAL_TIER_DEFAULTS.limits as {
        maxSingleTransactionUsd: number;
      }).maxSingleTransactionUsd = 999_999_999;
    }).toThrow();
    expect(PERSONAL_TIER_DEFAULTS.limits.maxSingleTransactionUsd).toBe(before);
  });

  it("every tier enables OFAC screening (never disabled)", () => {
    for (const tier of Object.keys(ALL_TIER_PRESETS) as TierLevel[]) {
      const preset = ALL_TIER_PRESETS[tier];
      expect(preset.complianceProfile.ofacScreeningEnabled).toBe(true);
    }
  });

  it("every tier retains audit events for ≥ 90 days (regulatory floor)", () => {
    for (const tier of Object.keys(ALL_TIER_PRESETS) as TierLevel[]) {
      const preset = ALL_TIER_PRESETS[tier];
      expect(preset.auditRetention.retainForDays).toBeGreaterThanOrEqual(90);
    }
  });

  it("EU jurisdiction overlay narrows dataResidency", () => {
    const preset = getTierPreset("enterprise", "DE");
    expect(preset.hostingProfile.dataResidency).toEqual(["EU"]);
  });

  it("TIER_RANK orders self-managed and managed ladders consistently", () => {
    expect(TIER_RANK.personal).toBe(TIER_RANK["managed-shared"]);
    expect(TIER_RANK.enterprise).toBe(TIER_RANK["managed-dedicated"]);
    expect(TIER_RANK.sovereign).toBe(TIER_RANK["managed-institutional"]);
    expect(TIER_RANK.enterprise).toBeGreaterThan(TIER_RANK.personal);
  });
});

/* ─── planMigration tests ──────────────────────────────────────────── */

describe("TierMigrator.planMigration", () => {
  it("Personal → Enterprise produces non-empty plan", async () => {
    const { store, migrator } = makeMigrator();
    const tenant = buildTenant("personal");
    await store.put(tenant);
    const plan = await migrator.planMigration(tenant.tenantId, "enterprise");
    expect("errors" in plan).toBe(false);
    if (!("errors" in plan)) {
      expect(plan.estimatedChanges.length).toBeGreaterThan(0);
      expect(plan.toTier).toBe("enterprise");
    }
  });

  it("plan flags audit retention changes", async () => {
    const { store, migrator } = makeMigrator();
    const tenant = buildTenant("personal");
    await store.put(tenant);
    const plan = await migrator.planMigration(tenant.tenantId, "enterprise");
    if ("errors" in plan) throw new Error("expected plan");
    const auditChanges = plan.estimatedChanges.filter(
      (c) => c.area === "audit"
    );
    expect(auditChanges.length).toBeGreaterThan(0);
    expect(auditChanges.some((c) => c.detail.includes("retainForDays"))).toBe(
      true
    );
  });

  it("plan flags enterprise-only features as 'added' during upgrade", async () => {
    const { store, migrator } = makeMigrator();
    const tenant = buildTenant("personal");
    await store.put(tenant);
    const plan = await migrator.planMigration(tenant.tenantId, "enterprise");
    if ("errors" in plan) throw new Error("expected plan");
    const added = plan.estimatedChanges.filter(
      (c) => c.area === "features" && c.kind === "added"
    );
    expect(added.some((c) => c.detail.startsWith("mpcSigning"))).toBe(true);
    expect(added.some((c) => c.detail.startsWith("workflowEscalation"))).toBe(
      true
    );
  });

  it("downgrade Enterprise → Personal errors with tier-downgrade-without-consent when not explicit", async () => {
    const { store, migrator } = makeMigrator();
    const tenant = buildTenant("enterprise");
    await store.put(tenant);
    const result = await migrator.planMigration(tenant.tenantId, "personal");
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(
        result.errors.some((e) => e.code === "tier-downgrade-without-consent")
      ).toBe(true);
    }
  });

  it("downgrade with explicit policyAdjustment='keep' produces feature-loss warnings", async () => {
    const { store, migrator } = makeMigrator();
    const tenant = buildTenant("enterprise");
    await store.put(tenant);
    const result = await migrator.planMigration(
      tenant.tenantId,
      "personal",
      undefined,
      "keep"
    );
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      const featureLoss = result.errors.find((e) => e.code === "feature-loss");
      expect(featureLoss).toBeDefined();
      expect(featureLoss!.detail).toMatch(/mpcSigning|workflowEscalation/);
    }
  });

  it("jurisdiction change triggers requiresUserConsent", async () => {
    const { store, migrator } = makeMigrator();
    const tenant = buildTenant("enterprise", { jurisdiction: "US" });
    await store.put(tenant);
    const plan = await migrator.planMigration(
      tenant.tenantId,
      "enterprise",
      "DE"
    );
    // EU DE narrows dataResidency to ["EU"] — no overlap with ["US","EU"]?
    // Actually enterprise preset has ["US","EU"], so there IS overlap;
    // consent-required still true because jurisdiction itself changed.
    expect("errors" in plan).toBe(false);
    if (!("errors" in plan)) {
      expect(plan.requiresUserConsent).toBe(true);
    }
  });

  it("jurisdiction change with no data-residency overlap errors with jurisdiction-conflict", async () => {
    const { store, migrator } = makeMigrator();
    const tenant = buildTenant("personal", { jurisdiction: "US" });
    // Personal preset has dataResidency: ["US"]; moving to AE (sovereign's
    // default jurisdiction) keeps us on personal tier though — craft a
    // scenario with no overlap by forcing dataResidency.
    tenant.hostingProfile = {
      ...tenant.hostingProfile,
      dataResidency: ["JP"],
    };
    await store.put(tenant);
    const result = await migrator.planMigration(
      tenant.tenantId,
      "sovereign",
      "AE"
    );
    expect("errors" in result).toBe(true);
    if ("errors" in result) {
      expect(
        result.errors.some((e) => e.code === "jurisdiction-conflict")
      ).toBe(true);
    }
  });
});

/* ─── executeMigration + receipt tests ─────────────────────────────── */

describe("TierMigrator.executeMigration", () => {
  it("creates a new tenant with upgradedFrom linking the predecessor", async () => {
    const audit = new StubAuditRef();
    const { store, migrator } = makeMigrator({ audit });
    const tenant = buildTenant("personal");
    audit.seed(tenant.tenantId, 12, "0xpredhash");
    await store.put(tenant);

    const plan = await migrator.planMigration(
      tenant.tenantId,
      "enterprise"
    );
    if ("errors" in plan) throw new Error("expected plan");
    const receipt = await migrator.executeMigration(plan, []);

    const successor = await store.get(receipt.toTenantId);
    expect(successor).toBeDefined();
    expect(successor!.upgradedFrom).toBe(tenant.tenantId);
    expect(successor!.upgradedAt).toBe(FIXED_NOW);
    expect(successor!.state).toBe("active");

    const predecessor = await store.get(tenant.tenantId);
    expect(predecessor!.state).toBe("migrated");
  });

  it("receipt planHash is deterministic across identical plans", async () => {
    const { store, migrator } = makeMigrator();
    const tenant = buildTenant("personal");
    await store.put(tenant);
    const plan = await migrator.planMigration(tenant.tenantId, "enterprise");
    if ("errors" in plan) throw new Error("expected plan");
    const hashA = computePlanHash(plan);
    const hashB = computePlanHash(plan);
    expect(hashA).toBe(hashB);
  });

  it("receipt carries audit event count = predecessor + 1 link", async () => {
    const audit = new StubAuditRef();
    const credentials = new StubCredentialRef();
    const workflows = new StubWorkflowRef();
    const { store, migrator } = makeMigrator({ audit, credentials, workflows });
    const tenant = buildTenant("personal");
    audit.seed(tenant.tenantId, 42, "0xlast");
    credentials.seed(tenant.tenantId, 3);
    workflows.seed(tenant.tenantId, 7);
    await store.put(tenant);
    const plan = await migrator.planMigration(tenant.tenantId, "enterprise");
    if ("errors" in plan) throw new Error("expected plan");
    const receipt = await migrator.executeMigration(plan, []);
    expect(receipt.auditEventsCarried).toBe(43);
    expect(receipt.credentialsCarried).toBe(3);
    expect(receipt.workflowsCarried).toBe(7);
    expect(receipt.previousTenantMergeFinalized).toBe(true);
    expect(audit.appended.length).toBe(1);
    expect(audit.appended[0]!.previousHash).toBe("0xlast");
    expect(audit.appended[0]!.planHash).toBe(receipt.planHash);
  });

  it("refuses execution when preserveData.auditEvents=false", async () => {
    const { store, migrator } = makeMigrator();
    const tenant = buildTenant("personal");
    await store.put(tenant);
    const plan = await migrator.planMigration(tenant.tenantId, "enterprise");
    if ("errors" in plan) throw new Error("expected plan");
    plan.preserveData.auditEvents = false;
    await expect(migrator.executeMigration(plan, [])).rejects.toBeInstanceOf(
      TierMigrationError
    );
  });
});

/* ─── verifyContinuity tests ───────────────────────────────────────── */

describe("TierMigrator.verifyContinuity", () => {
  it("returns valid:true for a successful migration", async () => {
    const audit = new StubAuditRef();
    const credentials = new StubCredentialRef();
    const { store, migrator } = makeMigrator({ audit, credentials });
    const tenant = buildTenant("personal");
    audit.seed(tenant.tenantId, 5, "0xhash");
    await store.put(tenant);
    const plan = await migrator.planMigration(tenant.tenantId, "enterprise");
    if ("errors" in plan) throw new Error("expected plan");
    const receipt = await migrator.executeMigration(plan, []);
    const verdict = await migrator.verifyContinuity(
      receipt.fromTenantId,
      receipt.toTenantId
    );
    expect(verdict.valid).toBe(true);
    expect(verdict.errors).toHaveLength(0);
  });

  it("detects audit-chain-break when successor events are dropped", async () => {
    const audit = new StubAuditRef();
    const { store, migrator } = makeMigrator({ audit });
    const tenant = buildTenant("personal");
    audit.seed(tenant.tenantId, 5, "0xhash");
    await store.put(tenant);
    const plan = await migrator.planMigration(tenant.tenantId, "enterprise");
    if ("errors" in plan) throw new Error("expected plan");
    const receipt = await migrator.executeMigration(plan, []);
    // Simulate audit-event loss on the successor.
    audit.forceSuccessorCount(receipt.toTenantId, 0);
    const verdict = await migrator.verifyContinuity(
      receipt.fromTenantId,
      receipt.toTenantId
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((e) => e.code === "audit-chain-break")).toBe(
      true
    );
  });

  it("detects credential-leak when revalidation fails", async () => {
    const audit = new StubAuditRef();
    const credentials = new StubCredentialRef();
    const { store, migrator } = makeMigrator({ audit, credentials });
    const tenant = buildTenant("personal");
    audit.seed(tenant.tenantId, 1);
    await store.put(tenant);
    const plan = await migrator.planMigration(tenant.tenantId, "enterprise");
    if ("errors" in plan) throw new Error("expected plan");
    const receipt = await migrator.executeMigration(plan, []);
    credentials.invalidateOnCheck = true;
    const verdict = await migrator.verifyContinuity(
      receipt.fromTenantId,
      receipt.toTenantId
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.errors.some((e) => e.code === "credential-leak")).toBe(
      true
    );
  });
});

/* ─── InMemoryTenantProfileStore tests ─────────────────────────────── */

describe("InMemoryTenantProfileStore", () => {
  it("round-trips profiles via put/get", async () => {
    const store = new InMemoryTenantProfileStore();
    const tenant = buildTenant("personal");
    await store.put(tenant);
    const got = await store.get(tenant.tenantId);
    expect(got).toEqual(tenant);
  });

  it("lineage traces parent → child in ancestor-first order", async () => {
    const audit = new StubAuditRef();
    const { store, migrator } = makeMigrator({ audit });
    const p = buildTenant("personal");
    audit.seed(p.tenantId, 1);
    await store.put(p);
    const plan1 = await migrator.planMigration(p.tenantId, "enterprise");
    if ("errors" in plan1) throw new Error("expected plan");
    const r1 = await migrator.executeMigration(plan1, []);
    const plan2 = await migrator.planMigration(r1.toTenantId, "sovereign");
    if ("errors" in plan2) throw new Error("expected plan");
    const r2 = await migrator.executeMigration(plan2, []);

    const lineage = await store.getLineage(r2.toTenantId);
    expect(lineage.map((t) => t.tier)).toEqual([
      "personal",
      "enterprise",
      "sovereign",
    ]);
  });

  it("filters list by tier, jurisdiction, and upgradedFrom", async () => {
    const store = new InMemoryTenantProfileStore();
    const a = buildTenant("personal", { tenantId: "a", jurisdiction: "US" });
    const b = buildTenant("enterprise", { tenantId: "b", jurisdiction: "DE" });
    const c = buildTenant("enterprise", {
      tenantId: "c",
      jurisdiction: "US",
      upgradedFrom: "a",
    });
    await store.put(a);
    await store.put(b);
    await store.put(c);

    const usOnly = await store.list({ jurisdiction: "US" });
    expect(usOnly.map((t) => t.tenantId).sort()).toEqual(["a", "c"]);

    const enterpriseOnly = await store.list({ tier: "enterprise" });
    expect(enterpriseOnly.map((t) => t.tenantId).sort()).toEqual(["b", "c"]);

    const promotedFromA = await store.list({ upgradedFrom: "a" });
    expect(promotedFromA.map((t) => t.tenantId)).toEqual(["c"]);
  });
});
