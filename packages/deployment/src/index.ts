export * from "./types";
export { DeploymentManager } from "./deployment-manager";
export {
  sharedCloudProfile,
  dedicatedTenantProfile,
  sovereignCloudProfile,
  selfHostedProfile,
  airGappedProfile,
  getDeploymentProfile,
  ALL_PROFILES,
} from "./profiles";

/* ─── Moat #5 — Tiered Deployment with Data Continuity ─────────────── */

export type {
  TierLevel,
  KycLevel,
  DataClassification,
  HostingMode,
  HostingProfile,
  ComplianceProfile,
  TenantLimits,
  TenantFeatures,
  AuditRetentionPolicy,
  TenantProfile,
  TenantLifecycleState,
  TierPreset,
} from "./tenant-profile";
export { isTierLevel, TIER_RANK } from "./tenant-profile";

export {
  PERSONAL_TIER_DEFAULTS,
  ENTERPRISE_TIER_DEFAULTS,
  SOVEREIGN_TIER_DEFAULTS,
  MANAGED_SHARED_CLOUD,
  MANAGED_DEDICATED_TENANT,
  MANAGED_INSTITUTIONAL,
  ALL_TIER_PRESETS,
  getTierPreset,
  cloneTierPreset,
  materializeTenantProfile,
} from "./tier-presets";

export {
  InMemoryTenantProfileStore,
  TenantStoreError,
} from "./tenant-store";
export type {
  TenantProfileStore,
  TenantProfileFilter,
} from "./tenant-store";

export {
  TierMigrator,
  TierMigrationError,
  ContinuityError,
  computePlanHash,
  createInMemoryMigrator,
} from "./tier-migrator";
export type {
  TierMigrationPlan,
  TierMigrationReceipt,
  TierMigrationSignature,
  TierMigrationInvariantError,
  TierMigratorDeps,
  AuditRef,
  CredentialRef,
  WorkflowRef,
} from "./tier-migrator";
