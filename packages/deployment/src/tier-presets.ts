/**
 * Concrete TenantProfile templates — one per {@link TierLevel}.
 *
 * Each preset encodes the *policy posture* and *feature surface* that
 * Aethelred commits to for that tier. The presets are deep-frozen at
 * module load so they cannot be mutated at runtime — any caller that
 * wants to derive a variant must clone via {@link cloneTierPreset}
 * first.
 *
 * Two invariants run across every preset (enforced by the test suite):
 *
 *   1. `ofacScreeningEnabled` is `true`  — no tier may turn off OFAC.
 *   2. `auditRetention.retainForDays >= 90` — 90-day regulatory floor.
 *
 * These invariants are defense-in-depth: the policy engine *also*
 * checks them at runtime, but catching a violation at preset-load time
 * turns a production incident into a CI failure.
 */

import type { TenantProfile, TierLevel, TierPreset } from "./tenant-profile";

/* ─── Internal helpers ─────────────────────────────────────────────── */

/**
 * Deep-freeze a preset object so mutations fail in strict mode and
 * throw TypeError in dev. We implement this locally (rather than pull
 * a dependency) because the preset surface is small and
 * enumerable-only — no getters, no Symbol keys.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    const nested = (value as Record<string, unknown>)[key];
    if (nested && typeof nested === "object" && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return value;
}

/**
 * Return an unfrozen structural clone of a preset. Used by the
 * migrator when composing a new tenant from a preset — the caller
 * needs to mutate the resulting object to set tenantId / workspaceId /
 * createdAt, so handing back the frozen preset directly would throw.
 *
 * Uses `structuredClone` where available (MV3 service-worker and
 * modern Node), falling back to JSON round-trip for older runtimes.
 * Preset shapes contain no non-JSON types (no bigint, Date, or RegExp).
 */
export function cloneTierPreset(preset: TierPreset): TierPreset {
  if (typeof structuredClone === "function") {
    return structuredClone(preset);
  }
  return JSON.parse(JSON.stringify(preset)) as TierPreset;
}

/* ─── Personal tier ────────────────────────────────────────────────── *
 *
 * The consumer-grade default. Conservative limits, zero custom
 * compliance reports, OFAC screening on (always), no MPC signing (cost
 * floor), 90-day audit retention (the regulatory minimum).
 */
export const PERSONAL_TIER_DEFAULTS: TierPreset = deepFreeze({
  tier: "personal" as TierLevel,
  jurisdiction: "US",
  hostingProfile: {
    mode: "self-hosted",
    dataResidency: ["US"],
    dedicatedInfra: false,
    byoKms: false,
  },
  complianceProfile: {
    kycLevel: "none",
    travelRuleRequired: false,
    ofacScreeningEnabled: true,
    fatfHighRiskBlocked: false,
    regulatoryReports: [],
    dataClassification: "public",
  },
  limits: {
    maxDailyTransactionsUsd: 10_000,
    maxSingleTransactionUsd: 5_000,
    maxMonthlyTransactionsUsd: 100_000,
    maxApprovers: 1,
    maxConnectedDapps: 20,
    maxMachineAgents: 0,
    maxWorkspaces: 1,
    maxAccounts: 10,
  },
  features: {
    hardwareWallet: true,
    passkey2fa: true,
    mpcSigning: false,
    workflowEscalation: false,
    regulatoryPassport: false,
    machineDelegation: false,
    notarizedAuditChain: false,
    smartAccountAbstraction: true,
  },
  auditRetention: {
    retainForDays: 90,
    notarizeToL1: false,
    exportFormatVersion: "v1",
    immutableAfterDays: undefined,
  },
});

/* ─── Enterprise tier ─────────────────────────────────────────────── *
 *
 * Regulated mid-market. KYC enhanced, Travel Rule on outbound transfers,
 * MiCA reports generated, MPC signing available, 1-year audit window.
 */
export const ENTERPRISE_TIER_DEFAULTS: TierPreset = deepFreeze({
  tier: "enterprise" as TierLevel,
  jurisdiction: "US",
  hostingProfile: {
    mode: "dedicated-tenant",
    dataResidency: ["US", "EU"],
    dedicatedInfra: true,
    byoKms: false,
  },
  complianceProfile: {
    kycLevel: "enhanced",
    travelRuleRequired: true,
    ofacScreeningEnabled: true,
    fatfHighRiskBlocked: true,
    regulatoryReports: ["MiCA", "SOC-2"],
    dataClassification: "confidential",
  },
  limits: {
    maxDailyTransactionsUsd: 5_000_000,
    maxSingleTransactionUsd: 1_000_000,
    maxMonthlyTransactionsUsd: 50_000_000,
    maxApprovers: 10,
    maxConnectedDapps: 200,
    maxMachineAgents: 50,
    maxWorkspaces: 25,
    maxAccounts: 500,
  },
  features: {
    hardwareWallet: true,
    passkey2fa: true,
    mpcSigning: true,
    workflowEscalation: true,
    regulatoryPassport: true,
    machineDelegation: true,
    notarizedAuditChain: false,
    smartAccountAbstraction: true,
  },
  auditRetention: {
    retainForDays: 365,
    notarizeToL1: false,
    exportFormatVersion: "v2",
    immutableAfterDays: 7,
  },
});

/* ─── Sovereign tier ──────────────────────────────────────────────── *
 *
 * Ministries, public institutions, systemic-importance operators.
 * Unlimited numeric limits (rendered as `Number.MAX_SAFE_INTEGER`),
 * 7-year retention with on-chain notarization, institutional-grade
 * KYC, and a catalogue of regulatory reports already wired.
 */
export const SOVEREIGN_TIER_DEFAULTS: TierPreset = deepFreeze({
  tier: "sovereign" as TierLevel,
  jurisdiction: "AE",
  hostingProfile: {
    mode: "institutional-sovereign",
    dataResidency: ["AE"],
    dedicatedInfra: true,
    byoKms: true,
  },
  complianceProfile: {
    kycLevel: "institutional",
    travelRuleRequired: true,
    ofacScreeningEnabled: true,
    fatfHighRiskBlocked: true,
    regulatoryReports: ["ADGM-DLT", "VASP-UAE", "MiCA", "FATF-TR", "SOC-2"],
    dataClassification: "restricted",
  },
  limits: {
    maxDailyTransactionsUsd: Number.MAX_SAFE_INTEGER,
    maxSingleTransactionUsd: 1_000_000_000,
    maxMonthlyTransactionsUsd: Number.MAX_SAFE_INTEGER,
    maxApprovers: 50,
    maxConnectedDapps: Number.MAX_SAFE_INTEGER,
    maxMachineAgents: 1000,
    maxWorkspaces: Number.MAX_SAFE_INTEGER,
    maxAccounts: Number.MAX_SAFE_INTEGER,
  },
  features: {
    hardwareWallet: true,
    passkey2fa: true,
    mpcSigning: true,
    workflowEscalation: true,
    regulatoryPassport: true,
    machineDelegation: true,
    notarizedAuditChain: true,
    smartAccountAbstraction: true,
  },
  auditRetention: {
    retainForDays: 2555, // 7 years
    notarizeToL1: true,
    exportFormatVersion: "v3",
    immutableAfterDays: 1,
  },
});

/* ─── Managed-shared (SaaS tier 1) ─────────────────────────────────── */

export const MANAGED_SHARED_CLOUD: TierPreset = deepFreeze({
  tier: "managed-shared" as TierLevel,
  jurisdiction: "US",
  hostingProfile: {
    mode: "shared-cloud",
    region: "us-east-1",
    dataResidency: ["US"],
    dedicatedInfra: false,
    byoKms: false,
  },
  complianceProfile: {
    kycLevel: "basic",
    travelRuleRequired: false,
    ofacScreeningEnabled: true,
    fatfHighRiskBlocked: true,
    regulatoryReports: ["SOC-2"],
    dataClassification: "internal",
  },
  limits: {
    maxDailyTransactionsUsd: 250_000,
    maxSingleTransactionUsd: 50_000,
    maxMonthlyTransactionsUsd: 2_500_000,
    maxApprovers: 3,
    maxConnectedDapps: 50,
    maxMachineAgents: 5,
    maxWorkspaces: 3,
    maxAccounts: 50,
  },
  features: {
    hardwareWallet: true,
    passkey2fa: true,
    mpcSigning: false,
    workflowEscalation: false,
    regulatoryPassport: false,
    machineDelegation: false,
    notarizedAuditChain: false,
    smartAccountAbstraction: true,
  },
  auditRetention: {
    retainForDays: 180,
    notarizeToL1: false,
    exportFormatVersion: "v1",
    immutableAfterDays: undefined,
  },
});

/* ─── Managed-dedicated (SaaS tier 2) ─────────────────────────────── */

export const MANAGED_DEDICATED_TENANT: TierPreset = deepFreeze({
  tier: "managed-dedicated" as TierLevel,
  jurisdiction: "US",
  hostingProfile: {
    mode: "dedicated-tenant",
    region: "us-east-1",
    dataResidency: ["US", "EU"],
    dedicatedInfra: true,
    byoKms: false,
  },
  complianceProfile: {
    kycLevel: "enhanced",
    travelRuleRequired: true,
    ofacScreeningEnabled: true,
    fatfHighRiskBlocked: true,
    regulatoryReports: ["MiCA", "SOC-2"],
    dataClassification: "confidential",
  },
  limits: {
    maxDailyTransactionsUsd: 10_000_000,
    maxSingleTransactionUsd: 2_000_000,
    maxMonthlyTransactionsUsd: 100_000_000,
    maxApprovers: 15,
    maxConnectedDapps: 500,
    maxMachineAgents: 100,
    maxWorkspaces: 50,
    maxAccounts: 1000,
  },
  features: {
    hardwareWallet: true,
    passkey2fa: true,
    mpcSigning: true,
    workflowEscalation: true,
    regulatoryPassport: true,
    machineDelegation: true,
    notarizedAuditChain: false,
    smartAccountAbstraction: true,
  },
  auditRetention: {
    retainForDays: 730, // 2 years
    notarizeToL1: false,
    exportFormatVersion: "v2",
    immutableAfterDays: 14,
  },
});

/* ─── Managed-institutional (SaaS tier 3) ─────────────────────────── */

export const MANAGED_INSTITUTIONAL: TierPreset = deepFreeze({
  tier: "managed-institutional" as TierLevel,
  jurisdiction: "AE",
  hostingProfile: {
    mode: "institutional-sovereign",
    region: "me-central-1",
    dataResidency: ["AE", "EU"],
    dedicatedInfra: true,
    byoKms: true,
  },
  complianceProfile: {
    kycLevel: "institutional",
    travelRuleRequired: true,
    ofacScreeningEnabled: true,
    fatfHighRiskBlocked: true,
    regulatoryReports: ["ADGM-DLT", "VASP-UAE", "MiCA", "FATF-TR", "SOC-2"],
    dataClassification: "restricted",
  },
  limits: {
    // ≥ 100_000_000 is a tested invariant — the institutional tier
    // explicitly underwrites nine-figure monthly volume.
    maxDailyTransactionsUsd: 500_000_000,
    maxSingleTransactionUsd: 100_000_000,
    maxMonthlyTransactionsUsd: 10_000_000_000,
    maxApprovers: 100,
    maxConnectedDapps: Number.MAX_SAFE_INTEGER,
    maxMachineAgents: 5000,
    maxWorkspaces: 1000,
    maxAccounts: Number.MAX_SAFE_INTEGER,
  },
  features: {
    hardwareWallet: true,
    passkey2fa: true,
    mpcSigning: true,
    workflowEscalation: true,
    regulatoryPassport: true,
    machineDelegation: true,
    notarizedAuditChain: true,
    smartAccountAbstraction: true,
  },
  auditRetention: {
    retainForDays: 3650, // 10 years
    notarizeToL1: true,
    exportFormatVersion: "v3",
    immutableAfterDays: 1,
  },
});

/* ─── Aggregate registry ──────────────────────────────────────────── */

/**
 * All presets keyed by tier. Deep-frozen via `Object.freeze` on the
 * outer object; each value is already deep-frozen above.
 */
export const ALL_TIER_PRESETS: Readonly<Record<TierLevel, TierPreset>> =
  Object.freeze({
    personal: PERSONAL_TIER_DEFAULTS,
    enterprise: ENTERPRISE_TIER_DEFAULTS,
    sovereign: SOVEREIGN_TIER_DEFAULTS,
    "managed-shared": MANAGED_SHARED_CLOUD,
    "managed-dedicated": MANAGED_DEDICATED_TENANT,
    "managed-institutional": MANAGED_INSTITUTIONAL,
  });

/**
 * Return a clone of the preset for `tier` with the jurisdiction field
 * overridden. The clone is *not* frozen so the caller can mutate it.
 *
 * Downstream invariants (like "AE sovereign tenants must notarize to
 * L1") are handled by the migrator — this helper is structurally pure.
 *
 * @example
 * ```ts
 * const preset = getTierPreset("enterprise", "AE");
 * preset.complianceProfile.regulatoryReports.push("ADGM-DLT");
 * ```
 */
export function getTierPreset(
  tier: TierLevel,
  jurisdiction: string
): TierPreset {
  const base = ALL_TIER_PRESETS[tier];
  if (!base) {
    throw new Error(`Unknown tier: ${String(tier)}`);
  }
  const clone = cloneTierPreset(base);
  clone.jurisdiction = jurisdiction;
  // EU data residency narrows to EU-only when jurisdiction is an EU
  // member code — the RoPA generator expects this to match exactly.
  if (EU_JURISDICTIONS.has(jurisdiction)) {
    clone.hostingProfile.dataResidency = ["EU"];
  }
  return clone;
}

/**
 * Rough ISO-3166 EU set used to narrow `dataResidency` when the
 * caller declares an EU jurisdiction. This is a narrow overlay — not
 * a comprehensive list — sufficient for the graduation UX and RoPA.
 */
const EU_JURISDICTIONS: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

/**
 * Convert a {@link TierPreset} + concrete ids into a full
 * {@link TenantProfile}. Used by the migrator when executing a plan.
 */
export function materializeTenantProfile(
  preset: TierPreset,
  opts: { tenantId: string; workspaceId: string; createdAt: number }
): TenantProfile {
  return {
    ...preset,
    tenantId: opts.tenantId,
    workspaceId: opts.workspaceId,
    createdAt: opts.createdAt,
    state: "active",
  };
}
