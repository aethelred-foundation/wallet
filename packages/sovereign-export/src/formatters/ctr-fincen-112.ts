/**
 * FinCEN CTR form 112 formatter.
 *
 * BSA requires a CTR when a single entity conducts aggregate
 * transactions exceeding $10,000 USD in a single business day.
 *
 * The formatter:
 *   1. Pulls transactions in the date range from the data source.
 *   2. Groups by `subjectId`.
 *   3. Filters to groups whose day-bucketed sums exceed the
 *      reporting threshold ($10k default).
 *   4. Rejects reports with zero reportable entities (filing a CTR
 *      with nobody is a bug).
 *
 * Threshold is configurable because:
 *   - Some jurisdictions have different thresholds (we support US
 *     only today but other federal regulators may piggyback).
 *   - Operators may want a stricter internal cap (e.g. $5k) to
 *     build a shadow CTR for internal review before the real
 *     filing.
 */

import type {
  CtrFincen112Payload,
  ExportDataSource,
  ExportPayload,
  ExportRequest,
  SarFincen111Payload,
  SarTransaction,
} from "../types";
import { SovereignExportError } from "../errors";

export interface CtrFormatterInput {
  readonly request: ExportRequest;
  readonly dataSource: ExportDataSource;
  readonly filingInstitution: SarFincen111Payload["filingInstitution"];
  /**
   * Reporting threshold in USD cents. Default: 1_000_000 ($10,000).
   */
  readonly thresholdUsdCents?: bigint;
  /**
   * Overrides: the transactions the CTR should group. If absent,
   * the formatter derives them from audit `signing-executed`
   * events.
   */
  readonly transactionsOverride?: ReadonlyArray<SarTransaction & { readonly subjectId: string; readonly subjectName?: string; readonly subjectCountry?: SarFincen111Payload["filingInstitution"]["jurisdiction"] }>;
}

const DEFAULT_THRESHOLD_USD_CENTS = 1_000_000n; // $10,000.00

export async function formatCtrFincen112(
  input: CtrFormatterInput,
): Promise<ExportPayload & { format: "ctr-fincen-112" }> {
  if (input.request.format !== "ctr-fincen-112") {
    throw new SovereignExportError(
      "report-format-unsupported",
      `formatCtrFincen112 called with format ${input.request.format}`,
    );
  }

  const threshold = input.thresholdUsdCents ?? DEFAULT_THRESHOLD_USD_CENTS;
  const raw =
    input.transactionsOverride ??
    (await pullFromAudit(input.dataSource, input.request));

  // Group by subjectId.
  const bySubject = new Map<
    string,
    {
      name?: string;
      country?: CtrFincen112Payload["reportableEntities"][number]["country"];
      transactions: SarTransaction[];
    }
  >();
  for (const t of raw) {
    const key = t.subjectId;
    let entry = bySubject.get(key);
    if (!entry) {
      entry = { name: t.subjectName, country: t.subjectCountry, transactions: [] };
      bySubject.set(key, entry);
    }
    entry.transactions.push({
      id: t.id,
      timestampMs: t.timestampMs,
      amountUsdCents: t.amountUsdCents,
      asset: t.asset,
      counterpartyAddress: t.counterpartyAddress,
      txHash: t.txHash,
      description: t.description,
    });
  }

  const reportable: CtrFincen112Payload["reportableEntities"][number][] = [];
  for (const [subjectId, entry] of bySubject.entries()) {
    const total = entry.transactions.reduce(
      (acc, t) => acc + BigInt(t.amountUsdCents),
      0n,
    );
    if (total <= threshold) continue;
    reportable.push({
      subjectId,
      name: entry.name,
      country: entry.country,
      totalUsdCents: total.toString(),
      transactions: entry.transactions,
    });
  }

  if (reportable.length === 0) {
    throw new SovereignExportError(
      "reportable-entity-count-zero",
      `CTR has zero reportable entities over threshold ${threshold} — filing would be rejected by FinCEN`,
    );
  }

  const body: CtrFincen112Payload = {
    formVersion: "BSA-2.0",
    filingInstitution: input.filingInstitution,
    reportableEntities: reportable,
    thresholdUsdCents: threshold.toString(),
  };

  return { format: "ctr-fincen-112", body };
}

async function pullFromAudit(
  source: ExportDataSource,
  request: ExportRequest,
): Promise<
  ReadonlyArray<
    SarTransaction & {
      readonly subjectId: string;
      readonly subjectName?: string;
      readonly subjectCountry?: SarFincen111Payload["filingInstitution"]["jurisdiction"];
    }
  >
> {
  const events = await source.listAuditEvents(request.range);
  const out: Array<
    SarTransaction & {
      subjectId: string;
      subjectName?: string;
      subjectCountry?: SarFincen111Payload["filingInstitution"]["jurisdiction"];
    }
  > = [];
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
      subjectId: ev.subjectId,
      subjectName: typeof detail.subjectName === "string" ? detail.subjectName : undefined,
      subjectCountry:
        typeof detail.subjectCountry === "string"
          ? (detail.subjectCountry as SarFincen111Payload["filingInstitution"]["jurisdiction"])
          : undefined,
    });
  }
  return out;
}
