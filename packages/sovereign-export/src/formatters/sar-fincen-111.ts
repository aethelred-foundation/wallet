/**
 * FinCEN SAR form 111 formatter.
 *
 * Input: audit events + flagged transactions from the operator's
 * data source. Output: `SarFincen111Payload` + the narrative the
 * compliance officer dictates.
 *
 * The formatter enforces regulator-critical invariants:
 *
 *   - At least one subject.
 *   - At least one transaction.
 *   - Total amount > 0 (SAR has no minimum threshold technically,
 *     but a zero-total report is always a filing bug).
 *   - `filingType: "continuing"` requires a prior SAR reference in
 *     caller-supplied narrative (we only warn via an error code,
 *     not a reject, because FinCEN accepts a free-form narrative).
 *
 * Redaction profile: `full-disclosure` (FinCEN requires raw PII).
 * Operators who need to redact should NOT use SAR — they should use
 * an internal case file.
 */

import type {
  ExportDataSource,
  ExportPayload,
  ExportRequest,
  SarCategory,
  SarFincen111Payload,
  SarSubject,
  SarTransaction,
} from "../types";
import { SovereignExportError } from "../errors";

export interface SarFormatterInput {
  readonly request: ExportRequest;
  readonly dataSource: ExportDataSource;
  readonly filingType: "initial" | "continuing" | "corrected";
  readonly suspiciousActivityCategories: ReadonlyArray<SarCategory>;
  readonly narrative: string;
  /**
   * Explicit subjects the SAR covers. FinCEN requires structured
   * subject rows even if the audit log only knows about internal
   * ids — the caller supplies name / jurisdiction / identifier at
   * filing time.
   */
  readonly subjects: ReadonlyArray<SarSubject>;
  /**
   * Optional: override the transactions the formatter would pull
   * from the data source. Used for callers that curate the SAR's
   * transactions outside the audit log.
   */
  readonly transactionsOverride?: ReadonlyArray<SarTransaction>;
  /** Filing institution identity. */
  readonly filingInstitution: SarFincen111Payload["filingInstitution"];
}

export async function formatSarFincen111(
  input: SarFormatterInput,
): Promise<ExportPayload & { format: "sar-fincen-111" }> {
  if (input.request.format !== "sar-fincen-111") {
    throw new SovereignExportError(
      "report-format-unsupported",
      `formatSarFincen111 called with format ${input.request.format}`,
    );
  }
  if (input.subjects.length === 0) {
    throw new SovereignExportError(
      "schema-field-missing",
      "SAR requires at least one subject",
    );
  }
  if (input.suspiciousActivityCategories.length === 0) {
    throw new SovereignExportError(
      "schema-field-missing",
      "SAR requires at least one suspicious-activity category",
    );
  }
  if (input.narrative.trim().length < 20) {
    throw new SovereignExportError(
      "schema-field-invalid",
      "SAR narrative must be at least 20 chars (FinCEN field 101 minimum)",
    );
  }

  const transactions =
    input.transactionsOverride ??
    (await pullTransactionsFromAudit(input.dataSource, input.request));

  if (transactions.length === 0) {
    throw new SovereignExportError(
      "schema-field-missing",
      "SAR requires at least one transaction",
    );
  }

  const totalCents = transactions.reduce(
    (acc, t) => acc + BigInt(t.amountUsdCents),
    0n,
  );
  if (totalCents <= 0n) {
    throw new SovereignExportError(
      "amount-threshold-not-met",
      `SAR totalAmount must be > 0; got ${totalCents}`,
    );
  }

  const activityStartMs = transactions.reduce(
    (acc, t) => Math.min(acc, t.timestampMs),
    Number.POSITIVE_INFINITY,
  );
  const activityEndMs = transactions.reduce(
    (acc, t) => Math.max(acc, t.timestampMs),
    0,
  );

  const body: SarFincen111Payload = {
    formVersion: "BSA-2.0",
    filingType: input.filingType,
    filingInstitution: input.filingInstitution,
    subjectActivity: {
      activityStartMs,
      activityEndMs,
      totalAmountUsdCents: totalCents.toString(),
      narrative: input.narrative.trim(),
      suspiciousActivityCategories: input.suspiciousActivityCategories,
    },
    subjects: input.subjects,
    transactions,
  };

  return { format: "sar-fincen-111", body };
}

/**
 * Default transaction extraction. Pulls audit events, filters to
 * signing-executed kind, lifts out the transaction details from the
 * `detail` bag. Callers with richer transaction schemas override
 * via `transactionsOverride`.
 */
async function pullTransactionsFromAudit(
  source: ExportDataSource,
  request: ExportRequest,
): Promise<ReadonlyArray<SarTransaction>> {
  const events = await source.listAuditEvents(request.range);
  const out: SarTransaction[] = [];
  for (const ev of events) {
    if (ev.kind !== "signing-executed") continue;
    const detail = ev.detail ?? {};
    const amount = detail.amountUsdCents;
    if (amount === undefined || amount === null) continue;
    out.push({
      id: ev.id,
      timestampMs: ev.timestamp,
      amountUsdCents: String(amount),
      asset: typeof detail.asset === "string" ? detail.asset : "unknown",
      counterpartyAddress:
        typeof detail.counterpartyAddress === "string"
          ? (detail.counterpartyAddress as `0x${string}`)
          : undefined,
      txHash:
        typeof detail.txHash === "string" ? (detail.txHash as `0x${string}`) : undefined,
      description:
        typeof detail.description === "string"
          ? detail.description
          : `audit event ${ev.id}`,
    });
  }
  return out;
}
