/**
 * Deployment tier types.
 * The same wallet architecture adapts to different trust environments.
 */

export type DeploymentTier =
  | "shared-cloud"       // Tier 1: consumers, startups
  | "dedicated-tenant"   // Tier 2: regulated enterprises
  | "sovereign-cloud"    // Tier 3: ministries, public institutions
  | "self-hosted"        // Tier 4: highly regulated, defense-adjacent
  | "air-gapped";        // Tier 5: top-tier sovereign, offline signing

export type CustodyTier =
  | "software"           // Local key storage (encrypted)
  | "hardware"           // Hardware wallet (Ledger, Trezor)
  | "hsm"               // Hardware Security Module
  | "mpc"               // Multi-Party Computation
  | "offline";           // Air-gapped, manual approval

export type CatalogMode =
  | "public"             // Public app catalog
  | "private"            // Organization-specific catalog
  | "restricted"         // Sovereign-restricted distribution
  | "isolated";          // Air-gapped, no external catalog

export interface DeploymentProfile {
  id: string;
  name: string;
  tier: DeploymentTier;
  description: string;

  // Features
  features: DeploymentFeatures;

  // Restrictions
  restrictions: DeploymentRestrictions;

  // Custody
  custodyOptions: CustodyTier[];
  defaultCustody: CustodyTier;

  // Catalog
  catalogMode: CatalogMode;

  // Compliance
  compliance: ComplianceConfig;

  createdAt: number;
}

export interface DeploymentFeatures {
  multiWorkspace: boolean;
  approvalWorkflows: boolean;
  dualControl: boolean;
  committeeApproval: boolean;
  spendLimits: boolean;
  auditExport: boolean;
  evidencePackaging: boolean;
  serviceIdentities: boolean;
  agentIdentities: boolean;
  customPolicies: boolean;
  adminConsole: boolean;
  realTimeOps: boolean;
  offlineSigning: boolean;
  hsmIntegration: boolean;
  mpcCustody: boolean;
}

export interface DeploymentRestrictions {
  maxWorkspaces: number | null;       // null = unlimited
  maxAccountsPerWorkspace: number | null;
  maxAppsInCatalog: number | null;
  allowExternalApps: boolean;
  allowCrossWorkspaceTransfers: boolean;
  requireKyc: boolean;
  dataResidency?: string;             // e.g., "UAE", "EU", "US"
  networkRestrictions?: string[];     // Allowed chain IDs
  ipWhitelist?: string[];
}

export interface ComplianceConfig {
  auditRetentionDays: number;
  requireApprovalEvidence: boolean;
  requireSigningEvidence: boolean;
  regulatoryFramework?: string;       // e.g., "ADGM-DLT", "MiCA", "SEC"
  reportingFrequency?: "daily" | "weekly" | "monthly" | "quarterly";
}

export interface ServiceIdentity {
  id: string;
  name: string;
  workspaceId: string;
  deploymentId: string;
  permissions: string[];
  apiKeyHash?: string;
  lastActive?: number;
  createdAt: number;
  expiresAt?: number;
  status: "active" | "suspended" | "revoked";
}

export interface AgentIdentity {
  id: string;
  name: string;
  parentServiceId: string;
  workspaceId: string;
  capabilities: string[];
  maxOperationsPerHour: number;
  requiresHumanApproval: boolean;
  createdAt: number;
  status: "active" | "suspended" | "revoked";
}
