/**
 * Enterprise compliance types for regulated sectors.
 * Covers: Finance (KYC/AML, FATF), Healthcare (HIPAA), Defense (FIPS),
 * Supply Chain (provenance), AI/IoT (machine identity).
 */

// ─── Regulatory Frameworks ────────────────────────────────────────

export type RegulatoryFramework =
  | "ADGM-DLT"      // Abu Dhabi Global Market DLT Framework
  | "MiCA"           // EU Markets in Crypto-Assets
  | "SEC"            // US Securities and Exchange Commission
  | "FCA"            // UK Financial Conduct Authority
  | "MAS"            // Monetary Authority of Singapore
  | "HIPAA"          // Health Insurance Portability and Accountability
  | "GDPR"           // EU General Data Protection Regulation
  | "SOC2"           // Service Organization Control 2
  | "ISO27001"       // Information Security Management
  | "FIPS-140-2"     // Federal Information Processing Standards
  | "NIST-800-53"    // Security and Privacy Controls
  | "PCI-DSS"        // Payment Card Industry Data Security
  | "FATF"           // Financial Action Task Force
  | "BSA"            // Bank Secrecy Act
  | "OFAC";          // Office of Foreign Assets Control

// ─── KYC/AML ──────────────────────────────────────────────────────

export type KycStatus = "not-started" | "pending" | "verified" | "rejected" | "expired" | "suspended";
export type KycLevel = "basic" | "standard" | "enhanced" | "institutional";
export type RiskRating = "low" | "medium" | "high" | "prohibited";

export interface KycProfile {
  id: string;
  subjectId: string;
  level: KycLevel;
  status: KycStatus;
  riskRating: RiskRating;

  // Identity fields
  legalName?: string;
  entityType: "individual" | "corporation" | "foundation" | "trust" | "dao" | "government";
  jurisdiction: string; // ISO 3166-1 alpha-2
  incorporationCountry?: string;

  // Verification
  identityVerified: boolean;
  addressVerified: boolean;
  sourceOfFundsVerified: boolean;
  sanctionsScreened: boolean;
  pepScreened: boolean; // Politically Exposed Person

  // Timestamps
  submittedAt?: number;
  verifiedAt?: number;
  expiresAt?: number;
  lastScreenedAt?: number;

  // Documents
  documents: KycDocument[];

  // Risk assessment
  riskFactors: RiskFactor[];
}

export interface KycDocument {
  id: string;
  type: "passport" | "national-id" | "drivers-license" | "utility-bill" | "bank-statement" | "incorporation-cert" | "shareholder-register" | "board-resolution";
  status: "pending" | "approved" | "rejected";
  hash: string; // SHA-256 of document content
  uploadedAt: number;
  reviewedAt?: number;
  expiresAt?: number;
}

export interface RiskFactor {
  category: "jurisdiction" | "activity" | "volume" | "counterparty" | "product" | "sanctions" | "pep";
  level: RiskRating;
  description: string;
  detectedAt: number;
  mitigated: boolean;
  mitigationNote?: string;
}

// ─── FATF Travel Rule ─────────────────────────────────────────────

export interface TravelRuleData {
  id: string;
  transactionId: string;

  // Originator (sender)
  originator: TravelRuleParty;

  // Beneficiary (receiver)
  beneficiary: TravelRuleParty;

  // Transfer details
  amount: string;
  currency: string;
  assetType: "virtual-asset" | "fiat" | "stablecoin";
  transferDate: number;
  transferPurpose?: string;

  // VASP information
  originatingVasp?: VaspInfo;
  beneficiaryVasp?: VaspInfo;

  // Compliance
  screeningResult: ScreeningResult;
  threshold: "below" | "above"; // FATF threshold ($1000/€1000)
  status: "pending" | "transmitted" | "confirmed" | "failed";
}

export interface TravelRuleParty {
  name: string;
  accountNumber: string; // wallet address
  geographicAddress?: string;
  nationalId?: string;
  dateOfBirth?: string;
  placeOfBirth?: string;
  legalEntityId?: string; // LEI
}

export interface VaspInfo {
  name: string;
  lei?: string; // Legal Entity Identifier
  jurisdiction: string;
  registrationNumber?: string;
  address?: string;
}

export interface ScreeningResult {
  sanctionsMatch: boolean;
  pepMatch: boolean;
  adverseMediaMatch: boolean;
  riskScore: number; // 0-100
  screenedAt: number;
  provider: string;
  matchDetails?: SanctionsMatch[];
}

export interface SanctionsMatch {
  listName: string; // "OFAC SDN", "EU Sanctions", "UN Consolidated"
  matchScore: number; // 0-100
  matchedName: string;
  matchedId?: string;
  listDate?: string;
}

// ─── Transaction Screening ────────────────────────────────────────

export interface TransactionScreening {
  id: string;
  transactionHash?: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  asset: string;

  // Screening results
  fromAddressRisk: RiskRating;
  toAddressRisk: RiskRating;
  overallRisk: RiskRating;

  // Flags
  sanctionsFlag: boolean;
  mixerFlag: boolean;
  darknetFlag: boolean;
  highRiskJurisdiction: boolean;
  unusualPattern: boolean;

  // Decision
  decision: "approve" | "review" | "block" | "escalate";
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNotes?: string;

  screenedAt: number;
}

// ─── Compliance Evidence & Reporting ──────────────────────────────

export type ReportFormat = "json" | "csv" | "pdf" | "xml";
export type ReportType =
  | "kyc-summary"
  | "aml-screening"
  | "transaction-report"
  | "suspicious-activity" // SAR
  | "currency-transaction" // CTR
  | "travel-rule-compliance"
  | "audit-trail"
  | "risk-assessment"
  | "soc2-evidence"
  | "regulatory-filing";

export interface ComplianceReport {
  id: string;
  type: ReportType;
  format: ReportFormat;
  framework: RegulatoryFramework;
  title: string;
  description: string;
  generatedAt: number;
  generatedBy: string;
  periodStart: number;
  periodEnd: number;
  workspaceId: string;
  data: Record<string, unknown>;
  integrityHash: string; // SHA-256 of report data
  signatures?: string[]; // Signing officer attestations
}

// ─── Data Classification (HIPAA/Defense) ──────────────────────────

export type ClassificationLevel =
  | "public"
  | "internal"
  | "confidential"
  | "restricted"
  | "top-secret"
  | "phi"              // Protected Health Information (HIPAA)
  | "pii"              // Personally Identifiable Information
  | "spii"             // Sensitive PII
  | "cui"              // Controlled Unclassified Information (Defense)
  | "classified";      // Classified (Defense)

export interface DataClassification {
  id: string;
  resourceId: string;
  resourceType: "transaction" | "account" | "document" | "credential" | "record" | "key";
  level: ClassificationLevel;
  labels: string[];
  handlingInstructions: string[];
  retentionDays: number;
  encryptionRequired: boolean;
  accessControl: {
    roles: string[];
    subjects: string[];
    conditions: string[];
  };
  createdAt: number;
  createdBy: string;
  reviewedAt?: number;
}

// ─── Machine Identity (AI/IoT/Autonomous) ─────────────────────────

export type MachineType =
  | "ai-agent"
  | "iot-device"
  | "autonomous-vehicle"
  | "smart-contract"
  | "oracle"
  | "validator"
  | "keeper"
  | "relayer"
  | "bridge-operator";

export interface MachineIdentity {
  id: string;
  name: string;
  type: MachineType;
  workspaceId: string;
  parentIdentityId?: string; // Human or organization owner

  // Authentication
  publicKey: string;
  certificateHash?: string;
  deviceFingerprint?: string;

  // Authorization
  permissions: MachinePermission[];
  maxOperationsPerHour: number;
  maxValuePerTransaction: string;
  maxDailyVolume: string;
  requiresHumanApproval: boolean;
  approvalThreshold: string; // Amount above which human approval needed

  // Lifecycle
  status: "active" | "suspended" | "revoked" | "expired";
  activatedAt: number;
  expiresAt?: number;
  lastActiveAt?: number;
  suspensionReason?: string;

  // Audit
  totalOperations: number;
  totalValueProcessed: string;
  lastOperationAt?: number;
  anomalyCount: number;
}

export interface MachinePermission {
  action: string; // "sign-transaction", "read-balance", "submit-proof", etc.
  scope: string; // "workspace", "account", "chain", etc.
  conditions: string[];
  expiresAt?: number;
}

// ─── Provenance & Attestation ─────────────────────────────────────

export interface ProvenanceRecord {
  id: string;
  entityId: string; // What is being tracked
  entityType: "asset" | "document" | "product" | "credential" | "model" | "dataset";
  chainOfCustody: CustodyEntry[];
  attestations: Attestation[];
  metadata: Record<string, unknown>;
  createdAt: number;
  integrityHash: string;
}

export interface CustodyEntry {
  holderId: string;
  holderName: string;
  holderType: "person" | "organization" | "machine" | "contract";
  receivedAt: number;
  releasedAt?: number;
  location?: string;
  conditions?: string[];
  evidenceHash?: string;
}

export interface Attestation {
  id: string;
  attesterId: string;
  attesterName: string;
  attesterType: "person" | "organization" | "machine" | "auditor" | "regulator";
  claim: string;
  evidence: string;
  timestamp: number;
  signature: string;
  expiresAt?: number;
  revoked: boolean;
}

// ─── Consent Framework ────────────────────────────────────────────

export interface ConsentRecord {
  id: string;
  subjectId: string; // Data subject
  grantedTo: string; // Organization/service receiving consent
  purpose: string;
  legalBasis: "consent" | "contract" | "legal-obligation" | "vital-interest" | "public-interest" | "legitimate-interest";
  dataCategories: string[];
  processingActivities: string[];
  retentionPeriod: number; // days
  crossBorderTransfer: boolean;
  transferDestinations?: string[];
  status: "active" | "withdrawn" | "expired";
  grantedAt: number;
  expiresAt?: number;
  withdrawnAt?: number;
  evidenceHash: string;
}
