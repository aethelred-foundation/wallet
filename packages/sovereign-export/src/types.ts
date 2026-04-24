/**
 * `@aethelred/wallet-sovereign-export` — type surface.
 *
 * Every regulator report has the same outer shape:
 *
 *   1. A `format` discriminant (`sar-fincen-111`, `ctr-fincen-112`,
 *      `gdpr-dsar`, `mica-transaction`).
 *   2. A `payload` whose shape is regulator-specific.
 *   3. An `envelope` carrying operator id, jurisdiction, date range,
 *      integrity hash, EIP-712 signature.
 *
 * The envelope is what regulators verify: they don't need to parse
 * our internal audit format, they need to know the report was
 * produced by an authorised operator over a specific period and
 * hasn't been tampered with.
 */

import type { AuditEvent } from "@aethelred/wallet-audit";

// ─── Formats + jurisdictions ───────────────────────────────────

export type ExportFormat =
  | "sar-fincen-111"
  | "ctr-fincen-112"
  | "gdpr-dsar"
  | "gdpr-erasure"
  | "mica-transaction";

/**
 * ISO 3166-1 alpha-2 country codes the package understands as
 * jurisdictions for reporting. More can be added as templates land.
 */
export type Jurisdiction =
  | "US"
  | "GB"
  | "DE"
  | "FR"
  | "IE"
  | "NL"
  | "IT"
  | "ES"
  | "LU"
  | "EU"
  | "CH"
  | "SG"
  | "AE";

export interface DateRange {
  readonly fromMs: number;
  readonly toMs: number;
}

// ─── Redaction ────────────────────────────────────────────────

/**
 * PII redaction profile. Each report type picks the profile that
 * matches regulator expectations:
 *
 *   - SAR/CTR → `full-disclosure` (the regulator REQUIRES raw PII).
 *   - GDPR DSAR → `subject-only` (disclose only the requesting
 *     subject's PII, redact everyone else).
 *   - GDPR erasure → `hashed` (all PII hashed + truncated).
 *   - MiCA transaction → `pseudonymous` (counterparty hashed,
 *     amounts disclosed).
 */
export type RedactionProfile =
  | "full-disclosure"
  | "subject-only"
  | "hashed"
  | "pseudonymous";

export interface RedactionPolicy {
  readonly profile: RedactionProfile;
  /** Subject commitment that the caller is allowed to see fully. */
  readonly privilegedSubject?: string;
  /**
   * Fields whose raw values MUST never appear even under
   * `full-disclosure` (typically internal system tokens).
   */
  readonly alwaysRedacted?: ReadonlyArray<string>;
}

// ─── Data source ──────────────────────────────────────────────

/**
 * What the formatters read from. Callers plug their own data source
 * so we never take a hard dep on a specific store. Every method is
 * async because production stores are network-backed.
 */
export interface ExportDataSource {
  /** Audit events within a date range. */
  listAuditEvents(range: DateRange): Promise<ReadonlyArray<AuditEvent>>;
  /** KYC profiles touched by the range. Shape passthrough from compliance package. */
  listKycProfiles(range: DateRange): Promise<ReadonlyArray<Record<string, unknown>>>;
  /** Travel-rule events within range. */
  listTravelRuleEvents(range: DateRange): Promise<ReadonlyArray<Record<string, unknown>>>;
  /** Transactions for a specific subject (for GDPR DSAR). */
  listSubjectTransactions(
    subjectId: string,
    range: DateRange,
  ): Promise<ReadonlyArray<Record<string, unknown>>>;
}

// ─── Report request ───────────────────────────────────────────

export interface ExportRequest {
  readonly format: ExportFormat;
  readonly jurisdiction: Jurisdiction;
  readonly range: DateRange;
  readonly operatorId: string;
  readonly operatorDisplayName: string;
  /**
   * Optional subject identifier — required for `gdpr-dsar` and
   * `gdpr-erasure`. The formatter rejects other formats with a
   * subject set (to prevent accidental mass-PII disclosure).
   */
  readonly subjectId?: string;
  /** Whether to apply additional caller-scoped redactions. */
  readonly redaction?: RedactionPolicy;
  /** Arbitrary caller metadata. Goes into envelope, never altered. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ─── Report payloads ──────────────────────────────────────────

/**
 * FinCEN SAR form 111 payload. Schema mirrors BSA e-File 2.0 JSON
 * shape — the fields regulated operators' existing SAR pipelines
 * already consume. `filingType: "initial" | "continuing"` matches
 * FinCEN's categorization.
 */
export interface SarFincen111Payload {
  readonly formVersion: "BSA-2.0";
  readonly filingType: "initial" | "continuing" | "corrected";
  readonly filingInstitution: {
    readonly legalName: string;
    readonly tin?: string;
    readonly jurisdiction: Jurisdiction;
  };
  readonly subjectActivity: {
    readonly activityStartMs: number;
    readonly activityEndMs: number;
    /** Sum in USD cents so the regulator needs no currency conversion. */
    readonly totalAmountUsdCents: string;
    readonly narrative: string;
    readonly suspiciousActivityCategories: ReadonlyArray<SarCategory>;
  };
  readonly subjects: ReadonlyArray<SarSubject>;
  readonly transactions: ReadonlyArray<SarTransaction>;
}

export type SarCategory =
  | "structuring"
  | "identity-theft"
  | "money-laundering"
  | "terrorism-financing"
  | "sanctions-evasion"
  | "fraud"
  | "unusual-behaviour"
  | "other";

export interface SarSubject {
  readonly subjectId: string;
  readonly role: "filer" | "conductor" | "subject" | "other";
  readonly name?: string;
  readonly identifierType?: "passport" | "drivers-license" | "tin" | "ein" | "lei" | "other";
  readonly identifierValue?: string;
  readonly country?: Jurisdiction;
  readonly address?: string;
}

export interface SarTransaction {
  readonly id: string;
  readonly timestampMs: number;
  readonly amountUsdCents: string;
  readonly asset: string;
  readonly counterpartyAddress?: `0x${string}`;
  readonly txHash?: `0x${string}`;
  readonly description: string;
}

/**
 * FinCEN CTR form 112 payload. Similar envelope to SAR but restricted
 * to > $10k aggregated transactions.
 */
export interface CtrFincen112Payload {
  readonly formVersion: "BSA-2.0";
  readonly filingInstitution: SarFincen111Payload["filingInstitution"];
  readonly reportableEntities: ReadonlyArray<{
    readonly subjectId: string;
    readonly name?: string;
    readonly country?: Jurisdiction;
    readonly totalUsdCents: string;
    readonly transactions: ReadonlyArray<SarTransaction>;
  }>;
  readonly thresholdUsdCents: string;
}

/**
 * GDPR DSAR payload (articles 15, 20). One per requesting subject.
 * Article 17 (erasure) is a separate format that only carries the
 * subject id + the confirmation of deletion — no data.
 */
export interface GdprDsarPayload {
  readonly gdprArticle: "15" | "20";
  readonly subjectId: string;
  readonly subjectName?: string;
  readonly dataCategoriesIncluded: ReadonlyArray<
    | "identity"
    | "kyc"
    | "transaction-history"
    | "audit-log"
    | "credentials"
    | "policy-state"
  >;
  readonly transactions: ReadonlyArray<Record<string, unknown>>;
  readonly auditEvents: ReadonlyArray<Record<string, unknown>>;
  readonly retentionPeriod: {
    readonly fromMs: number;
    readonly keptUntilMs: number;
  };
}

export interface GdprErasurePayload {
  readonly gdprArticle: "17";
  readonly subjectId: string;
  readonly erasureRequestedAtMs: number;
  readonly dataCategoriesErased: ReadonlyArray<string>;
  readonly retainedForLegalObligationMs?: number;
  readonly retentionJustification?: string;
}

/**
 * MiCA transaction reporting payload. Per the MiCA (EU 2023/1114)
 * Title V requirements — CASPs report transaction data to the
 * competent authority on a periodic basis.
 */
export interface MicaTransactionPayload {
  readonly reportingVersion: "MiCA-2024-Q1";
  readonly casp: {
    readonly legalName: string;
    readonly authorisationRef: string; // national competent authority reference
    readonly jurisdiction: Jurisdiction;
  };
  readonly period: DateRange;
  readonly transactions: ReadonlyArray<{
    readonly id: string;
    readonly timestampMs: number;
    readonly asset: string;
    readonly amountUsdCents: string;
    readonly sender: string; // hashed subject commitment
    readonly receiver: string; // hashed subject commitment
    readonly counterpartyIsCasp: boolean;
    readonly serviceCategory:
      | "custody"
      | "exchange"
      | "advice"
      | "portfolio-management"
      | "transfer"
      | "issuance";
  }>;
  readonly aggregates: {
    readonly totalUsdCents: string;
    readonly transactionCount: number;
    readonly uniqueCounterparties: number;
  };
}

// ─── Envelope + report ────────────────────────────────────────

/**
 * Signed envelope every export carries. Regulators verify this
 * without parsing payload internals.
 */
export interface ExportEnvelope {
  readonly envelopeVersion: "aethelred-export-1";
  readonly operatorId: string;
  readonly operatorDisplayName: string;
  readonly jurisdiction: Jurisdiction;
  readonly format: ExportFormat;
  readonly range: DateRange;
  readonly generatedAtMs: number;
  /** sha256 of canonical JSON of the payload. */
  readonly payloadHash: `0x${string}`;
  /**
   * EIP-712 signature by the operator over the envelope fields.
   * Regulators verify against the operator's registered public key.
   * `"0x"` when unsigned (CLI --no-sign flag).
   */
  readonly signature: `0x${string}`;
  /** Signer address (recovered from signature, cached here for audit). */
  readonly signerAddress?: `0x${string}`;
  /** Caller metadata (passthrough). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExportPayload =
  | { readonly format: "sar-fincen-111"; readonly body: SarFincen111Payload }
  | { readonly format: "ctr-fincen-112"; readonly body: CtrFincen112Payload }
  | { readonly format: "gdpr-dsar"; readonly body: GdprDsarPayload }
  | { readonly format: "gdpr-erasure"; readonly body: GdprErasurePayload }
  | { readonly format: "mica-transaction"; readonly body: MicaTransactionPayload };

export interface SignedExport {
  readonly envelope: ExportEnvelope;
  readonly payload: ExportPayload;
}
