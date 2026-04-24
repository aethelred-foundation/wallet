/**
 * GDPR DSAR (articles 15 + 20) and erasure (article 17) formatters.
 *
 * Article 15 — right of access: the subject asks what the operator
 * knows about them. We return transactions, audit events, KYC
 * profile data, and retention period.
 *
 * Article 20 — right to data portability: same data as article 15
 * but the subject explicitly requests a machine-readable copy.
 *
 * Article 17 — right to erasure: the subject asks for data deletion.
 * The formatter emits a confirmation payload; actual data deletion
 * happens in the operator's backend (out of scope for this package).
 *
 * Redaction profile for DSAR: `subject-only` — we show the subject
 * their own PII, everything else (counterparties named in their
 * audit events, etc.) goes through the redactor.
 */

import type {
  ExportDataSource,
  ExportPayload,
  ExportRequest,
  GdprDsarPayload,
  GdprErasurePayload,
} from "../types";
import { SovereignExportError } from "../errors";
import { redactPayload } from "../redaction";
import type { RedactionPolicy } from "../types";

export interface GdprDsarFormatterInput {
  readonly request: ExportRequest;
  readonly dataSource: ExportDataSource;
  /** Article 15 or 20. */
  readonly article: "15" | "20";
  readonly subjectName?: string;
  /**
   * Retention window the operator commits to. Surfaced so subjects
   * know when their data is scheduled for removal.
   */
  readonly retentionWindowMs: number;
}

export async function formatGdprDsar(
  input: GdprDsarFormatterInput,
): Promise<ExportPayload & { format: "gdpr-dsar" }> {
  if (input.request.format !== "gdpr-dsar") {
    throw new SovereignExportError(
      "report-format-unsupported",
      `formatGdprDsar called with format ${input.request.format}`,
    );
  }
  if (!input.request.subjectId) {
    throw new SovereignExportError(
      "subject-not-found",
      "GDPR DSAR requires a subjectId",
    );
  }

  const transactions = await input.dataSource.listSubjectTransactions(
    input.request.subjectId,
    input.request.range,
  );
  const events = (await input.dataSource.listAuditEvents(input.request.range)).filter(
    (ev) => ev.subjectId === input.request.subjectId,
  );

  const redaction: RedactionPolicy = input.request.redaction ?? {
    profile: "subject-only",
    privilegedSubject: input.request.subjectId,
  };
  const redactedTransactions = redactPayload(redaction, transactions, input.request.subjectId);
  const redactedEvents = redactPayload(redaction, events, input.request.subjectId);

  const body: GdprDsarPayload = {
    gdprArticle: input.article,
    subjectId: input.request.subjectId,
    subjectName: input.subjectName,
    dataCategoriesIncluded: [
      "identity",
      "transaction-history",
      "audit-log",
    ],
    transactions: redactedTransactions as unknown as ReadonlyArray<Record<string, unknown>>,
    auditEvents: redactedEvents as unknown as ReadonlyArray<Record<string, unknown>>,
    retentionPeriod: {
      fromMs: input.request.range.fromMs,
      keptUntilMs: input.request.range.fromMs + input.retentionWindowMs,
    },
  };

  return { format: "gdpr-dsar", body };
}

// ─── Erasure ────────────────────────────────────────────

export interface GdprErasureFormatterInput {
  readonly request: ExportRequest;
  readonly erasureRequestedAtMs: number;
  readonly dataCategoriesErased: ReadonlyArray<string>;
  /** Legal-obligation retention, if applicable (AML records, etc.). */
  readonly retainedForLegalObligationMs?: number;
  readonly retentionJustification?: string;
}

export function formatGdprErasure(
  input: GdprErasureFormatterInput,
): ExportPayload & { format: "gdpr-erasure" } {
  if (input.request.format !== "gdpr-erasure") {
    throw new SovereignExportError(
      "report-format-unsupported",
      `formatGdprErasure called with format ${input.request.format}`,
    );
  }
  if (!input.request.subjectId) {
    throw new SovereignExportError(
      "subject-not-found",
      "GDPR erasure confirmation requires a subjectId",
    );
  }
  if (input.dataCategoriesErased.length === 0) {
    throw new SovereignExportError(
      "schema-field-missing",
      "erasure confirmation requires at least one dataCategoriesErased entry",
    );
  }
  if (
    input.retainedForLegalObligationMs !== undefined &&
    !input.retentionJustification
  ) {
    throw new SovereignExportError(
      "schema-field-missing",
      "retainedForLegalObligationMs set without retentionJustification — GDPR art. 17(3) requires justification",
    );
  }

  const body: GdprErasurePayload = {
    gdprArticle: "17",
    subjectId: input.request.subjectId,
    erasureRequestedAtMs: input.erasureRequestedAtMs,
    dataCategoriesErased: input.dataCategoriesErased,
    retainedForLegalObligationMs: input.retainedForLegalObligationMs,
    retentionJustification: input.retentionJustification,
  };

  return { format: "gdpr-erasure", body };
}
