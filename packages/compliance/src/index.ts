/**
 * @packageDocumentation
 *
 * `@aethelred/wallet-compliance` — composable compliance primitives for Web3
 * custody. Designed for VASPs, fintechs, banks, and asset managers that need
 * to meet FATF, MiCA, SOC 2, HIPAA, and jurisdiction-specific obligations
 * while integrating the primitives into their own signing and approval
 * pipelines.
 *
 * ## Surface area
 *
 * The public SDK exposes fourteen primitives grouped under the following
 * capability areas:
 *
 * | Area                 | Primary export                  | Purpose                                                       |
 * | -------------------- | ------------------------------- | ------------------------------------------------------------- |
 * | KYC / AML            | {@link KycManager}              | Multi-level identity verification, risk scoring, EDD triggers |
 * | Transaction screen   | {@link TransactionScreeningEngine} | OFAC, mixer, and high-risk jurisdiction screening          |
 * | FATF Travel Rule     | {@link TravelRuleEngine}        | Originator / beneficiary data + VASP coordination             |
 * | Reporting            | {@link ReportGenerator}         | SAR, CTR, SOC2 evidence, MiCA, audit trail export            |
 * | Data classification  | {@link DataClassificationEngine} | HIPAA / GDPR / defense classification and consent            |
 * | Machine identity     | {@link MachineIdentityManager}  | AI agent, IoT, oracle identity with human-approval gates     |
 * | Provenance           | {@link ProvenanceTracker}       | Chain-of-custody and attestation records                     |
 * | Case management      | {@link CaseManager}             | Investigation lifecycle and evidence chains                  |
 * | Alerts               | {@link AlertSystem}             | Deduplicated alert routing, escalation, audit history        |
 * | Jurisdictions        | {@link JurisdictionEngine}      | Country-keyed AML thresholds, sanctions lists, KYC rules     |
 * | Velocity             | {@link VelocityMonitor}         | Count / volume / counterparty velocity breach detection      |
 * | Filings              | {@link FilingTracker}           | SAR / CTR / MiCA filing lifecycle and regulator response     |
 *
 * Every domain type is re-exported from this barrel; subpath exports such as
 * `@aethelred/wallet-compliance/kyc` are also available for tree-shakable
 * consumers (see the package `exports` map).
 *
 * @example Import the whole SDK
 * ```ts
 * import {
 *   KycManager,
 *   TransactionScreeningEngine,
 *   AlertSystem,
 * } from "@aethelred/wallet-compliance";
 * ```
 *
 * @example Import a single primitive via a subpath
 * ```ts
 * import { KycManager } from "@aethelred/wallet-compliance/kyc";
 * ```
 */

// ─── Shared types ─────────────────────────────────────────────────
//
// `types` holds the regulated-domain models shared across every primitive
// (KYC, Travel Rule, screening, reporting, classification, machine identity,
// provenance, consent). `enterprise-types` holds the workflow state machines,
// jurisdiction configs, cases, alerts, velocity rules, and filing types.

/**
 * Core regulated-domain types: KYC, Travel Rule, screening, reporting,
 * classification, machine identity, provenance, consent.
 */
export type {
  RegulatoryFramework,
  KycStatus,
  KycLevel,
  RiskRating,
  KycProfile,
  KycDocument,
  RiskFactor,
  TravelRuleData,
  TravelRuleParty,
  VaspInfo,
  ScreeningResult,
  SanctionsMatch,
  TransactionScreening,
  ReportFormat,
  ReportType,
  ComplianceReport,
  ClassificationLevel,
  DataClassification,
  MachineType,
  MachineIdentity,
  MachinePermission,
  ProvenanceRecord,
  CustodyEntry,
  Attestation,
  ConsentRecord,
} from "./types";

/**
 * Enterprise workflow types: case management, alerts, velocity rules,
 * regulatory filings, jurisdiction configs, KYC workflow state machine.
 */
export type {
  KycWorkflowState,
  KycWorkflowTransition,
  UltimateBeneficialOwner,
  OngoingMonitoringSchedule,
  JurisdictionConfig,
  ComplianceRole,
  ComplianceOfficer,
  CaseStatus,
  CasePriority,
  InvestigationCase,
  CaseNote,
  EvidenceChain,
  EvidenceItem,
  AlertSeverity,
  AlertStatus,
  AlertCategory,
  ComplianceAlert,
  VelocityRule,
  VelocityCounter,
  FilingStatus,
  FilingType,
  RegulatoryFiling,
  AccessAuditEntry,
} from "./enterprise-types";

// ─── KYC / AML ────────────────────────────────────────────────────

/**
 * Multi-level KYC / AML identity verification manager.
 *
 * Covers profile creation, document uploads, risk scoring, EDD triggers, and
 * ongoing monitoring for individuals, corporations, foundations, trusts,
 * DAOs, and government entities.
 */
export { KycManager } from "./kyc-manager";

// ─── Transaction screening ────────────────────────────────────────

/**
 * Transaction screening engine for AML/CFT compliance.
 *
 * Screens counterparty addresses against sanctions lists (OFAC SDN by
 * default), known mixer contracts, and FATF high-risk jurisdictions, and
 * returns an `approve | review | escalate | block` decision.
 */
export { TransactionScreeningEngine } from "./transaction-screening";

// ─── FATF Travel Rule ─────────────────────────────────────────────

/**
 * FATF Travel Rule compliance engine.
 *
 * Collects originator / beneficiary PII, coordinates VASP-to-VASP transmission
 * (pluggable transport for TRISA, OpenVASP, Shyft), and enforces the
 * $1,000 / €1,000 FATF threshold.
 */
export { TravelRuleEngine } from "./travel-rule";

// ─── Reporting ────────────────────────────────────────────────────

/**
 * Compliance report generator with integrity hashing.
 *
 * Produces KYC summaries, transaction reports, Travel Rule compliance
 * reports, SOC 2 evidence packages, and tamper-evident audit-trail
 * exports. Supports JSON and CSV today.
 */
export { ReportGenerator } from "./report-generator";

// ─── Data classification (HIPAA / GDPR / defense) ────────────────

/**
 * Data classification and consent engine.
 *
 * Maps resources to classification levels (PII, PHI, CUI, classified, etc.)
 * and returns the handling rules (encryption, retention, access control)
 * for each level. Includes GDPR / HIPAA consent lifecycle management.
 */
export { DataClassificationEngine } from "./data-classification";

// ─── Machine identity (AI / IoT / autonomous) ────────────────────

/**
 * Machine Identity Protocol for non-human actors.
 *
 * Registers AI agents, IoT devices, oracles, validators, keepers, and
 * bridge operators with rate limits, per-transaction value limits,
 * human-approval thresholds, and anomaly-based auto-suspension.
 */
export { MachineIdentityManager } from "./machine-identity";

/**
 * Provenance and attestation tracker for supply chain, research datasets,
 * ML models, and credentials. Maintains chain-of-custody and revocable
 * third-party attestations.
 */
export { ProvenanceTracker } from "./machine-identity";

// ─── TEE attestation (Moat #3) ───────────────────────────────────
//
// Scaffolding for TEE-attested agent delegation: type surface + structural
// verifier + session-scoped delegation manager. The cryptographic signature
// chain of the quote is validated by a vendor SDK (Intel DCAP, AMD SEV-SNP
// attestation, AWS Nitro Enclaves attestation, Azure Attestation, GCP
// Confidential Space) at production deployment time — see the TODO markers
// in attestation-verifier.ts.

/**
 * TEE attestation types shared across the verifier and delegation manager.
 */
export type {
  TeePlatform,
  TeeQuote,
  TeeMeasurements,
  AttestedAgent,
  RevocationReason,
  RevocationRecord,
  AttestationVerificationResult,
} from "./tee-attestation";

/**
 * TEE attestation errors (structured throw surface).
 */
export {
  AttestationError,
  DelegationError,
  TeeQuoteError,
  FORBIDDEN_CODE_HASHES,
  RISKY_EXTRA_CLAIM_KEYS,
  constantTimeHexEqual,
  isHexString,
  normalizeHex,
} from "./tee-attestation";

/**
 * Structural + freshness verifier for TEE attestations.
 *
 * Performs every non-cryptographic check required to accept a quote.
 * Cryptographic signature-chain verification is explicitly TODO-marked —
 * integrate a vendor SDK at production deployment time.
 */
export { AttestationVerifier } from "./attestation-verifier";
export type { AttestationVerifierConfig } from "./attestation-verifier";

/**
 * Session-scoped delegation primitives for TEE-attested agents.
 *
 * Binds an agent + subject pair to a policy covering allowed calls, spend
 * velocity, per-call attestation freshness, and auto-revoke-on-drift.
 */
export { AgentDelegationManager } from "./agent-delegation";
export type {
  DelegationPolicy,
  DelegationSession,
  OpenSessionOpts,
  OpenSessionResult,
  OpenSessionSuccess,
  OpenSessionFailure,
  AuthorizeOperationOpts,
  AuthorizeOperationResult,
  AuthorizationAccepted,
  AuthorizationRejected,
} from "./agent-delegation";

// ─── Case management ──────────────────────────────────────────────

/**
 * Enterprise case management for compliance investigations.
 *
 * Models the case lifecycle (open → investigation → evidence collection →
 * analysis → resolution), enforces valid status transitions, hashes the
 * evidence chain, and supports law-enforcement referral and SAR filing.
 */
export { CaseManager } from "./case-management";

// ─── Alerts ───────────────────────────────────────────────────────

/**
 * Compliance alert system with deduplication, suppression, escalation,
 * and an append-only history for audit replay.
 */
export { AlertSystem } from "./alert-system";

// ─── Jurisdictions ────────────────────────────────────────────────

/**
 * Jurisdiction-aware policy engine.
 *
 * Keyed by ISO 3166-1 alpha-2 codes, returns the AML threshold, Travel Rule
 * threshold, minimum KYC level, sanctions lists, and data-residency rules
 * for the given jurisdiction. Ships with seed configs for AE, US, GB, SG,
 * EU plus prohibited KP and IR, and falls back to a strict `DEFAULT`.
 */
export { JurisdictionEngine } from "./jurisdiction-engine";

// ─── Velocity monitoring ─────────────────────────────────────────

/**
 * Transaction velocity monitor.
 *
 * Accumulates transaction count, volume-USD, unique-counterparty, and
 * unique-jurisdiction metrics per time window and triggers compliance
 * alerts on threshold breach.
 */
export { VelocityMonitor } from "./velocity-monitor";

// ─── Regulatory filings ──────────────────────────────────────────

/**
 * Regulatory filing lifecycle tracker.
 *
 * Drives a filing (SAR, CTR, STR, MiCA, ADGM-DLT, etc.) from draft through
 * officer review, approval, submission, acknowledgment, and any amendment
 * round-trip with the regulator. Every transition is recorded in
 * `filingHistory` for audit.
 */
export { FilingTracker } from "./filing-tracker";
