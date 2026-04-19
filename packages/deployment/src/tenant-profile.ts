/**
 * Moat #5 — Tiered Deployment with Data Continuity
 *
 * `TenantProfile` is the strategic primitive that differentiates the
 * Aethelred Wallet from every other custody product on the market:
 *
 *   - MetaMask ships only the consumer tier (`personal`).
 *   - Fireblocks ships only the institutional tier (`managed-institutional`).
 *   - Safe is tier-agnostic but cannot graduate a SINGLE identity from
 *     Personal → Enterprise → Sovereign while preserving the
 *     *audit chain + keys + credentials* untouched.
 *
 * The Aethelred stack treats tier as a *profile attached to a tenant*,
 * not a global deployment toggle. One subject can own multiple tenants
 * across tiers simultaneously, and — crucially — a tenant can be
 * *graduated* into a higher tier with full data continuity (see
 * {@link tier-migrator.ts}).
 *
 * This file defines the *shape* of a tenant profile; the canonical
 * templates live in {@link tier-presets.ts}; the migration engine lives
 * in {@link tier-migrator.ts}; persistence in {@link tenant-store.ts}.
 *
 * All shapes are JSON-serialisable (no `bigint`, no class instances)
 * so they round-trip through Chrome message-passing and backend APIs
 * without a custom reviver.
 */

/**
 * Six-valued tier ladder.
 *
 * The three *self-managed* tiers (`personal`, `enterprise`, `sovereign`)
 * describe what the *user* operates. The three *managed* tiers map onto
 * SaaS offerings Aethelred operates on the user's behalf:
 *
 *   - `managed-shared`        — multi-tenant shared cloud (startups, SMB)
 *   - `managed-dedicated`     — dedicated infra per tenant (regulated SMB)
 *   - `managed-institutional` — sovereign-grade control plane + BYOKMS
 *
 * The ladder is ordered — see {@link TIER_ORDER} in
 * {@link tier-migrator.ts} — so the migrator can determine whether a
 * migration is an *upgrade* (feature-gaining) or a *downgrade*
 * (feature-losing) and enforce the correct consent protocol.
 */
export type TierLevel =
  | "personal"
  | "enterprise"
  | "sovereign"
  | "managed-shared"
  | "managed-dedicated"
  | "managed-institutional";

/**
 * KYC depth enforced by the tier's compliance profile.
 *
 * The ordering `none < basic < enhanced < institutional` is meaningful —
 * promoting to a higher tier must re-run KYC at the higher level or the
 * migrator refuses to execute.
 */
export type KycLevel = "none" | "basic" | "enhanced" | "institutional";

/**
 * Data-handling classification consumed by the audit exporter,
 * redaction layer, and evidence packager.
 */
export type DataClassification =
  | "public"
  | "internal"
  | "confidential"
  | "restricted";

/**
 * Hosting mode determines where encrypted data lives and who operates
 * the control plane. `self-hosted` means the user runs everything
 * locally; `institutional-sovereign` means a regulator-witnessed tenant
 * with dedicated HSMs and BYOKMS.
 */
export type HostingMode =
  | "self-hosted"
  | "shared-cloud"
  | "dedicated-tenant"
  | "institutional-sovereign";

/**
 * Hosting-level attributes (region, residency, infra isolation).
 *
 * `dataResidency` is a list of ISO-3166 alpha-2 region codes the
 * tenant's data may legally traverse. The RoPA (Record of Processing
 * Activity) generator enforces this list downstream — if a migration
 * would move data outside the declared set, the migrator flags a
 * `jurisdiction-conflict` invariant error.
 */
export interface HostingProfile {
  mode: HostingMode;
  /** Optional cloud-region code (e.g. `eu-west-1`, `me-central-1`). */
  region?: string;
  /** ISO-3166 alpha-2 region codes data may traverse. Never empty. */
  dataResidency: string[];
  /** True if this tenant is the sole consumer of its underlying infra. */
  dedicatedInfra: boolean;
  /** True if signing keys are wrapped by a customer-managed KMS. */
  byoKms: boolean;
}

/**
 * Compliance posture for the tenant. Determines which regulatory
 * reports are generated, whether Travel Rule is enforced on outbound
 * transfers, and whether OFAC screening is active.
 *
 * `ofacScreeningEnabled` is a *hard floor*: every preset in
 * {@link tier-presets.ts} has it set to `true`, and the migrator will
 * not accept a plan that turns it off. See the test suite for the
 * invariant check.
 */
export interface ComplianceProfile {
  kycLevel: KycLevel;
  travelRuleRequired: boolean;
  ofacScreeningEnabled: boolean;
  fatfHighRiskBlocked: boolean;
  /** e.g. `["MiCA", "VASP-UAE", "ADGM-DLT"]`. */
  regulatoryReports: string[];
  dataClassification: DataClassification;
}

/**
 * Numeric ceilings enforced by the policy engine. All values are USD-
 * denominated even when the actual txn is in a non-USD asset — the
 * policy engine performs the oracle conversion before comparing.
 */
export interface TenantLimits {
  maxDailyTransactionsUsd: number;
  maxSingleTransactionUsd: number;
  maxMonthlyTransactionsUsd: number;
  maxApprovers: number;
  maxConnectedDapps: number;
  maxMachineAgents: number;
  /** Maximum number of concurrent active workspaces under this tenant. */
  maxWorkspaces: number;
  /** Maximum number of hardware/software accounts across all workspaces. */
  maxAccounts: number;
}

/**
 * Feature flags that gate wallet capabilities at the tenant level.
 *
 * These are *enterprise product decisions*, not technical toggles — a
 * `personal` tenant with `mpcSigning: true` would be inconsistent with
 * the tier's support model, so the preset forbids it. Individual users
 * on the `personal` tier who want MPC must graduate to `enterprise`.
 */
export interface TenantFeatures {
  hardwareWallet: boolean;
  passkey2fa: boolean;
  mpcSigning: boolean;
  workflowEscalation: boolean;
  regulatoryPassport: boolean;
  machineDelegation: boolean;
  notarizedAuditChain: boolean;
  smartAccountAbstraction: boolean;
}

/**
 * Audit retention policy. `retainForDays` is the *minimum* — the
 * notarizer may pin events to L1 for longer, and
 * `immutableAfterDays` is the cut-off past which even the tenant owner
 * cannot redact an event (regulatory ratchet).
 *
 * `exportFormatVersion` is semver-like and identifies the evidence
 * bundle schema; graduating tiers never downgrade this version —
 * history from a v2 tenant carried into a v1 tenant would lose fields,
 * so the migrator refuses.
 */
export interface AuditRetentionPolicy {
  retainForDays: number;
  notarizeToL1: boolean;
  exportFormatVersion: string;
  /**
   * Optional number of days after an event lands before it becomes
   * immutable (i.e. even the tenant owner cannot redact it). Used by
   * sovereign and institutional tiers to mirror regulatory ratchet
   * requirements like "cannot be modified after 24h" for MiCA.
   */
  immutableAfterDays?: number;
}

/**
 * Full tenant profile. A subject can own multiple tenants across tiers.
 *
 * When a tenant is graduated (see {@link tier-migrator.ts}), a NEW
 * `TenantProfile` is created with a fresh `tenantId`, the new tier's
 * presets, and `upgradedFrom` pointing at the previous tenant. The old
 * tenant remains in the store in `migrated` state (see
 * {@link TenantLifecycleState}) — auditors must be able to trace the
 * full lineage.
 *
 * @example
 * ```ts
 * const profile: TenantProfile = {
 *   tenantId: "tenant-abc123",
 *   tier: "enterprise",
 *   createdAt: Date.now(),
 *   workspaceId: "ws-primary",
 *   jurisdiction: "AE",
 *   hostingProfile: { mode: "dedicated-tenant", dataResidency: ["AE"], dedicatedInfra: true, byoKms: false },
 *   complianceProfile: { kycLevel: "enhanced", travelRuleRequired: true, ofacScreeningEnabled: true, fatfHighRiskBlocked: true, regulatoryReports: ["VASP-UAE"], dataClassification: "confidential" },
 *   limits: { maxDailyTransactionsUsd: 5_000_000, ... },
 *   features: { mpcSigning: true, workflowEscalation: true, ... },
 *   auditRetention: { retainForDays: 2555, notarizeToL1: true, exportFormatVersion: "v2", immutableAfterDays: 30 },
 * };
 * ```
 */
export interface TenantProfile {
  tenantId: string;
  tier: TierLevel;
  createdAt: number;
  /** Parent tenantId if this tier was promoted from another. */
  upgradedFrom?: string;
  /** UNIX ms timestamp of the migration that created this tenant. */
  upgradedAt?: number;
  /** Links to the identity-package workspace the tenant is anchored on. */
  workspaceId: string;
  /** ISO-3166 alpha-2 jurisdiction that drives default policy templates. */
  jurisdiction: string;
  hostingProfile: HostingProfile;
  complianceProfile: ComplianceProfile;
  limits: TenantLimits;
  features: TenantFeatures;
  auditRetention: AuditRetentionPolicy;
  /** Lifecycle state. Defaults to `active` on creation. */
  state?: TenantLifecycleState;
}

/**
 * Tenant lifecycle marker.
 *
 *   - `active`   — the tenant is the current live profile.
 *   - `migrated` — a successor tenant (linked via `upgradedFrom`) has
 *                  superseded this one. Retained for audit lineage;
 *                  new operations are refused by the policy engine.
 *   - `archived` — the tenant is out of retention window, kept only
 *                  for evidence export.
 */
export type TenantLifecycleState = "active" | "migrated" | "archived";

/**
 * Input shape for {@link tier-migrator.ts}'s
 * `getTierPreset(tier, jurisdiction)`. We omit the fields a concrete
 * tenant requires but a preset cannot know (identity, timestamps).
 */
export type TierPreset = Omit<
  TenantProfile,
  "tenantId" | "workspaceId" | "createdAt"
>;

/**
 * Type-guard: narrow an arbitrary value to a `TierLevel`. Useful when
 * decoding bridge messages from the popup — the payload is
 * structurally typed `unknown` until validated.
 */
export function isTierLevel(value: unknown): value is TierLevel {
  return (
    value === "personal" ||
    value === "enterprise" ||
    value === "sovereign" ||
    value === "managed-shared" ||
    value === "managed-dedicated" ||
    value === "managed-institutional"
  );
}

/**
 * Numeric rank used by the migrator to decide upgrade vs downgrade.
 *
 * Self-managed tiers and managed tiers share the same ordering because
 * *capability surface* — not hosting topology — is what determines
 * whether consent is required for a transition.
 *
 *   personal / managed-shared          →  1
 *   enterprise / managed-dedicated     →  2
 *   sovereign / managed-institutional  →  3
 *
 * A move within the same rank that crosses the self-managed / managed
 * boundary is treated as a *lateral* graduation (no feature loss but
 * hosting change), which requires `jurisdiction-confirm` consent only.
 */
export const TIER_RANK: Readonly<Record<TierLevel, number>> = Object.freeze({
  personal: 1,
  "managed-shared": 1,
  enterprise: 2,
  "managed-dedicated": 2,
  sovereign: 3,
  "managed-institutional": 3,
});
