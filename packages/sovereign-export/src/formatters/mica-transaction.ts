/**
 * MiCA transaction reporting formatter.
 *
 * MiCA (EU 2023/1114) Title V requires Crypto-Asset Service Providers
 * (CASPs) to report transaction data to their national competent
 * authority on a periodic basis. The payload mirrors the ESMA
 * technical standard (draft) with fields structured for JSON upload.
 *
 * Redaction profile: `pseudonymous` — counterparty PII is hashed,
 * amounts disclosed. Regulators cross-reference hashed commitments
 * against their own CASP registry data, which is what MiCA
 * technical standards explicitly anticipate.
 */

import type {
  ExportDataSource,
  ExportPayload,
  ExportRequest,
  MicaTransactionPayload,
  RedactionPolicy,
} from "../types";
import { SovereignExportError } from "../errors";
import { redactPayload } from "../redaction";

export interface MicaFormatterInput {
  readonly request: ExportRequest;
  readonly dataSource: ExportDataSource;
  readonly casp: MicaTransactionPayload["casp"];
  /** Default service category when audit events don't specify. */
  readonly defaultServiceCategory: MicaTransactionPayload["transactions"][number]["serviceCategory"];
}

export async function formatMicaTransaction(
  input: MicaFormatterInput,
): Promise<ExportPayload & { format: "mica-transaction" }> {
  if (input.request.format !== "mica-transaction") {
    throw new SovereignExportError(
      "report-format-unsupported",
      `formatMicaTransaction called with format ${input.request.format}`,
    );
  }

  const events = await input.dataSource.listAuditEvents(input.request.range);
  const redaction: RedactionPolicy =
    input.request.redaction ?? { profile: "pseudonymous" };

  const raw: MicaTransactionPayload["transactions"][number][] = [];
  let totalCents = 0n;
  const counterparties = new Set<string>();

  for (const ev of events) {
    if (ev.kind !== "signing-executed") continue;
    const detail = ev.detail ?? {};
    const amount = detail.amountUsdCents;
    if (amount === undefined || amount === null) continue;

    const cents = BigInt(String(amount));
    totalCents += cents;

    const sender = typeof detail.senderId === "string" ? detail.senderId : ev.subjectId;
    const receiver =
      typeof detail.receiverId === "string"
        ? detail.receiverId
        : typeof detail.counterpartyAddress === "string"
          ? detail.counterpartyAddress
          : "unknown";

    counterparties.add(receiver);

    // Apply redaction to sender/receiver fields — pseudonymise.
    const redacted = redactPayload(redaction, { sender, receiver }) as {
      sender: string;
      receiver: string;
    };

    const category = typeof detail.serviceCategory === "string"
      ? (detail.serviceCategory as MicaTransactionPayload["transactions"][number]["serviceCategory"])
      : input.defaultServiceCategory;

    const counterpartyIsCasp =
      typeof detail.counterpartyIsCasp === "boolean"
        ? detail.counterpartyIsCasp
        : false;

    raw.push({
      id: ev.id,
      timestampMs: ev.timestamp,
      asset: typeof detail.asset === "string" ? detail.asset : "unknown",
      amountUsdCents: cents.toString(),
      sender: redacted.sender,
      receiver: redacted.receiver,
      counterpartyIsCasp,
      serviceCategory: category,
    });
  }

  if (raw.length === 0) {
    throw new SovereignExportError(
      "reportable-entity-count-zero",
      "MiCA transaction report has zero transactions — nothing to file",
    );
  }

  const body: MicaTransactionPayload = {
    reportingVersion: "MiCA-2024-Q1",
    casp: input.casp,
    period: input.request.range,
    transactions: raw,
    aggregates: {
      totalUsdCents: totalCents.toString(),
      transactionCount: raw.length,
      uniqueCounterparties: counterparties.size,
    },
  };

  return { format: "mica-transaction", body };
}
