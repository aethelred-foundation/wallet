/**
 * Enterprise-grade compliance types.
 * Covers workflow state machines, jurisdiction configs, compliance officer roles,
 * investigation cases, evidence chains, regulatory filing, alerts, and velocity monitoring.
 */

// ─── KYC Workflow State Machine ───────────────────────────────────

export type KycWorkflowState =
  | "intake"
  | "document-collection"
  | "identity-verification"
  | "address-verification"
  | "pep-screening"
  | "sanctions-screening"
  | "adverse-media-screening"
  | "source-of-funds-review"
  | "ubo-identification"
  | "edd-required"
  | "manual-review"
  | "case-escalation"
  | "final-approval"
  | "approved"
  | "rejected"
  | "suspended";

export interface KycWorkflowTransition {
  from: KycWorkflowState;
  to: KycWorkflowState;
  trigger: string;
  requiresApproval: boolean;
  approverRole: ComplianceRole;
  autoTransition: boolean;
  conditions?: string[];
}

export interface UltimateBeneficialOwner {
  id: string;
  name: string;
  ownershipPercentage: number;
  controlType: "direct" | "indirect" | "nominee" | "trust-beneficiary";
  nationality: string;
  residency: string;
  pepStatus: boolean;
  sanctionsStatus: boolean;
  verifiedAt?: number;
  verificationMethod?: string;
  identityDocumentHash?: string;
}

export interface OngoingMonitoringSchedule {
  profileId: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "annually";
  lastExecuted?: number;
  nextScheduled: number;
  checksToPerform: Array<"sanctions" | "pep" | "adverse-media" | "transaction-patterns" | "jurisdiction-changes">;
  autoEscalateOnMatch: boolean;
}

// ─── Jurisdiction Configuration ───────────────────────────────────

export interface JurisdictionConfig {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  riskLevel: "low" | "medium" | "high" | "very-high" | "prohibited";
  kycRequirements: {
    minimumLevel: "basic" | "standard" | "enhanced" | "institutional";
    documentTypes: string[];
    uboThresholdPercent: number; // Typically 25% or 10%
    eddTriggers: string[];
  };
  amlThresholds: {
    reportingThresholdLocal: number;
    reportingCurrency: string;
    reportingThresholdUsd: number;
    travelRuleThresholdUsd: number;
    ctrThresholdUsd: number; // Currency Transaction Report
  };
  sanctionsLists: string[]; // Required sanctions lists to check
  dataResidency: {
    required: boolean;
    allowedRegions?: string[];
    localStorageOnly?: boolean;
  };
  reportingRequirements: {
    sarRequired: boolean;
    ctrRequired: boolean;
    periodicReportingFrequency?: string;
    regulatoryBody: string;
    filingFormat: string;
  };
}

// ─── Compliance Officer Roles ─────────────────────────────────────

export type ComplianceRole =
  | "chief-compliance-officer"
  | "mlro"                    // Money Laundering Reporting Officer
  | "kyc-analyst"
  | "kyc-reviewer"
  | "transaction-analyst"
  | "case-investigator"
  | "sanctions-analyst"
  | "reporting-officer"
  | "approval-authority"
  | "audit-lead"
  | "data-protection-officer"
  | "risk-manager";

export interface ComplianceOfficer {
  id: string;
  subjectId: string;
  name: string;
  roles: ComplianceRole[];
  certifications: string[]; // CAMS, ICA, ACFCS
  jurisdiction: string;
  approvalAuthority: number; // Max USD value per approval
  maxConcurrentCases: number;
  activeCaseCount: number;
  status: "active" | "on-leave" | "suspended";
}

// ─── Investigation & Case Management ──────────────────────────────

export type CaseStatus =
  | "open"
  | "assigned"
  | "under-investigation"
  | "evidence-collection"
  | "analysis"
  | "pending-review"
  | "escalated"
  | "escalated-to-law-enforcement"
  | "sar-filed"
  | "resolved-no-action"
  | "resolved-action-taken"
  | "closed";

export type CasePriority = "low" | "medium" | "high" | "critical" | "urgent";

export interface InvestigationCase {
  id: string;
  title: string;
  description: string;
  workspaceId: string;

  // Source
  sourceScreeningIds: string[];
  sourceAlertIds: string[];

  // Assignment
  investigatorId: string;
  reviewerId?: string;
  status: CaseStatus;
  priority: CasePriority;

  // Risk
  riskLevel: "low" | "medium" | "high" | "prohibited";
  suspectedActivity: string[];
  totalExposureUsd: number;

  // Evidence
  evidenceChain: EvidenceChain;

  // Timeline
  createdAt: number;
  assignedAt?: number;
  lastActivityAt: number;
  dueDate?: number;
  resolvedAt?: number;
  closedAt?: number;

  // Resolution
  resolution?: {
    outcome: "no-action" | "enhanced-monitoring" | "account-restriction" | "account-closure" | "sar-filed" | "law-enforcement-referral";
    rationale: string;
    approvedBy: string;
    approvedAt: number;
  };

  // Law enforcement
  lawEnforcementReferral?: {
    agencyName: string;
    referenceNumber: string;
    contactPerson: string;
    reportedAt: number;
    responseReceived: boolean;
  };

  // Audit
  notes: CaseNote[];
  statusHistory: Array<{ status: CaseStatus; changedAt: number; changedBy: string; reason?: string }>;
}

export interface CaseNote {
  id: string;
  authorId: string;
  content: string;
  attachments: string[];
  createdAt: number;
  isConfidential: boolean;
}

export interface EvidenceChain {
  id: string;
  caseId: string;
  items: EvidenceItem[];
  integrityHash: string;
  lastUpdated: number;
}

export interface EvidenceItem {
  id: string;
  type: "transaction" | "document" | "screenshot" | "communication" | "blockchain-analysis" | "kyc-record" | "screening-result" | "expert-analysis";
  title: string;
  description: string;
  contentHash: string;
  collectedAt: number;
  collectedBy: string;
  chainOfCustody: Array<{ holderId: string; receivedAt: number; releasedAt?: number }>;
  tags: string[];
  classification: string;
  admissible: boolean; // Whether this evidence meets legal admissibility standards
}

// ─── Compliance Alerts ────────────────────────────────────────────

export type AlertSeverity = "info" | "low" | "medium" | "high" | "critical";
export type AlertStatus = "new" | "acknowledged" | "assigned" | "under-review" | "resolved" | "false-positive" | "suppressed";
export type AlertCategory =
  | "sanctions-match"
  | "pep-match"
  | "adverse-media"
  | "unusual-transaction"
  | "velocity-breach"
  | "threshold-breach"
  | "mixer-interaction"
  | "high-risk-jurisdiction"
  | "kyc-expiry"
  | "structuring-suspected"
  | "counterparty-risk"
  | "compliance-deadline";

export interface ComplianceAlert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  description: string;
  sourceId: string; // Screening, KYC, or transaction ID
  workspaceId: string;

  // Assignment
  assignedTo?: string;
  escalationLevel: number;
  escalationPath: string[]; // Ordered list of compliance officer IDs

  // Timing
  createdAt: number;
  acknowledgedAt?: number;
  resolvedAt?: number;
  dueDate?: number;
  suppressedUntil?: number;

  // Related
  relatedCaseId?: string;
  relatedAlertIds: string[];

  // History — append-only audit trail of actions taken against the alert
  // (acknowledged, escalated, snoozed, resolved). Preserving the history
  // is essential for SOC 2 / ISO 27001 audit and for answering "why did
  // this alert get escalated" questions during incident review.
  history?: Array<{
    at: number;
    action: "created" | "acknowledged" | "escalated" | "snoozed" | "resolved" | "false-positive";
    detail: string;
    level?: number;
    actor?: string;
  }>;

  // Resolution
  resolution?: {
    outcome: "confirmed" | "false-positive" | "no-action" | "escalated" | "sar-filed";
    notes: string;
    resolvedBy: string;
  };
}

// ─── Velocity Monitoring ──────────────────────────────────────────

export interface VelocityRule {
  id: string;
  name: string;
  description: string;
  scope: "account" | "workspace" | "entity" | "jurisdiction";
  metric: "count" | "volume-usd" | "unique-counterparties" | "unique-jurisdictions";
  window: "1h" | "24h" | "7d" | "30d" | "90d";
  threshold: number;
  action: "alert" | "block" | "review" | "escalate";
  severity: AlertSeverity;
  enabled: boolean;
}

export interface VelocityCounter {
  ruleId: string;
  subjectId: string;
  windowStart: number;
  windowEnd: number;
  currentValue: number;
  threshold: number;
  breached: boolean;
  lastUpdated: number;
}

// ─── Regulatory Filing ────────────────────────────────────────────

export type FilingStatus =
  | "draft"
  | "pending-officer-review"
  | "pending-approval"
  | "approved"
  | "pending-submission"
  | "submitted"
  | "acknowledged"
  | "rejected-by-regulator"
  | "amendment-required"
  | "audit-received";

export type FilingType =
  | "sar"        // Suspicious Activity Report
  | "ctr"        // Currency Transaction Report
  | "str"        // Suspicious Transaction Report (non-US)
  | "aml-return" // Periodic AML return
  | "kyc-audit"  // KYC audit report
  | "travel-rule-report"
  | "annual-compliance-report"
  | "mca-report" // MiCA compliance
  | "adgm-dlt-report";

export interface RegulatoryFiling {
  id: string;
  reportId: string;
  type: FilingType;
  status: FilingStatus;
  jurisdiction: string;
  regulatoryBody: string;

  // Review chain
  preparedBy: string;
  preparedAt: number;
  reviewedBy?: string;
  reviewedAt?: number;
  approvedBy?: string;
  approvedAt?: number;

  // Submission
  submittedAt?: number;
  submissionMethod: "api" | "portal" | "email" | "postal";
  submissionReference?: string;

  // Response
  acknowledgedAt?: number;
  acknowledgmentReference?: string;
  rejectionReason?: string;
  amendmentDeadline?: number;

  // Audit
  filingHistory: Array<{ status: FilingStatus; timestamp: number; actor: string; notes?: string }>;
}

// ─── Access Audit Log ─────────────────────────────────────────────

export interface AccessAuditEntry {
  id: string;
  resourceId: string;
  resourceType: string;
  classificationLevel: string;
  subjectId: string;
  action: "read" | "write" | "delete" | "export" | "share" | "classify" | "declassify";
  allowed: boolean;
  denialReason?: string;
  timestamp: number;
  ipAddress?: string;
  deviceFingerprint?: string;
}
