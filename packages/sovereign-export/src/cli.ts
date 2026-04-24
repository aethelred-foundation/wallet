/**
 * CLI entry point — thin, dependency-free argument parser.
 *
 * Why no commander / yargs? Keeps the bundle lean, avoids a
 * transitive-dep security surface, and the CLI's option surface is
 * small enough to hand-parse without tears.
 *
 * Exported `runCli()` is the testable core; `bin/export.js` is the
 * shell entry that calls it with `process.argv`.
 *
 * Supported flags:
 *
 *   --format          sar-fincen-111 | ctr-fincen-112 | gdpr-dsar
 *                      | gdpr-erasure | mica-transaction
 *   --jurisdiction    ISO country code (US, EU, DE, ...)
 *   --from            ISO-8601 datetime or unix-ms integer
 *   --to              ISO-8601 datetime or unix-ms integer
 *   --operator-id     stable operator id
 *   --operator-name   display name
 *   --subject         subjectId (required for GDPR formats)
 *   --output          path to write the signed export JSON (default: stdout)
 *   --no-sign         emit an unsigned envelope (dev/testing only)
 *
 * Everything else (data source, signer, narratives, filing
 * institution metadata) is wired via a `CliContext` the caller
 * passes in — we never embed an HTTP client or expect env vars.
 */

import type { TypedDataSigner } from "@aethelred/wallet-custody-adapters";

import type {
  ExportDataSource,
  ExportFormat,
  ExportPayload,
  ExportRequest,
  Jurisdiction,
  SignedExport,
} from "./types";
import { SovereignExportError } from "./errors";
import {
  assertFormatJurisdictionCompatible,
  buildSignedExport,
} from "./envelope";
import { formatSarFincen111, type SarFormatterInput } from "./formatters/sar-fincen-111";
import { formatCtrFincen112, type CtrFormatterInput } from "./formatters/ctr-fincen-112";
import {
  formatGdprDsar,
  formatGdprErasure,
  type GdprDsarFormatterInput,
  type GdprErasureFormatterInput,
} from "./formatters/gdpr";
import {
  formatMicaTransaction,
  type MicaFormatterInput,
} from "./formatters/mica-transaction";

// ─── Options ──────────────────────────────────────────────

export interface CliOptions {
  readonly format: ExportFormat;
  readonly jurisdiction: Jurisdiction;
  readonly fromMs: number;
  readonly toMs: number;
  readonly operatorId: string;
  readonly operatorDisplayName: string;
  readonly subjectId?: string;
  readonly output?: string;
  readonly sign: boolean;
}

export interface CliContext {
  readonly dataSource: ExportDataSource;
  readonly signer?: TypedDataSigner;
  /** Extra input for format-specific fields — narrative, casp, etc. */
  readonly sarExtra?: Pick<
    SarFormatterInput,
    "filingType" | "suspiciousActivityCategories" | "narrative" | "subjects" | "filingInstitution" | "transactionsOverride"
  >;
  readonly ctrExtra?: Pick<
    CtrFormatterInput,
    "filingInstitution" | "thresholdUsdCents" | "transactionsOverride"
  >;
  readonly gdprDsarExtra?: Pick<
    GdprDsarFormatterInput,
    "article" | "subjectName" | "retentionWindowMs"
  >;
  readonly gdprErasureExtra?: Pick<
    GdprErasureFormatterInput,
    "erasureRequestedAtMs" | "dataCategoriesErased" | "retainedForLegalObligationMs" | "retentionJustification"
  >;
  readonly micaExtra?: Pick<
    MicaFormatterInput,
    "casp" | "defaultServiceCategory"
  >;
  readonly writeFile?: (path: string, data: string) => Promise<void>;
  readonly writeStdout?: (data: string) => void;
  readonly now?: () => number;
}

// ─── Argument parsing ────────────────────────────────────

const KNOWN_FORMATS: ReadonlyArray<ExportFormat> = [
  "sar-fincen-111",
  "ctr-fincen-112",
  "gdpr-dsar",
  "gdpr-erasure",
  "mica-transaction",
];

const KNOWN_JURISDICTIONS: ReadonlyArray<Jurisdiction> = [
  "US", "GB", "DE", "FR", "IE", "NL", "IT", "ES", "LU", "EU", "CH", "SG", "AE",
];

/**
 * Parse CLI argv (excluding node + script). Exported for tests.
 *
 * Accepts flags in any order. Rejects unknown flags with
 * `cli-argument-invalid`. Missing required flags throw with the
 * specific field name.
 */
export function parseCliArgs(argv: ReadonlyArray<string>): CliOptions {
  const kv = new Map<string, string>();
  const bools = new Set<string>();
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new SovereignExportError(
        "cli-argument-invalid",
        `positional argument "${arg}" not supported; use --flag value`,
      );
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (key === "no-sign" || key === "help") {
      bools.add(key);
      i += 1;
      continue;
    }
    if (next === undefined || next.startsWith("--")) {
      throw new SovereignExportError(
        "cli-argument-invalid",
        `flag --${key} requires a value`,
      );
    }
    kv.set(key, next);
    i += 2;
  }

  if (bools.has("help")) {
    throw new SovereignExportError("cli-argument-invalid", helpText());
  }

  const format = required(kv, "format") as ExportFormat;
  if (!KNOWN_FORMATS.includes(format)) {
    throw new SovereignExportError(
      "cli-argument-invalid",
      `unknown --format "${format}"; expected one of ${KNOWN_FORMATS.join(", ")}`,
    );
  }
  const jurisdiction = required(kv, "jurisdiction") as Jurisdiction;
  if (!KNOWN_JURISDICTIONS.includes(jurisdiction)) {
    throw new SovereignExportError(
      "cli-argument-invalid",
      `unknown --jurisdiction "${jurisdiction}"`,
    );
  }
  const fromMs = parseDate(required(kv, "from"), "from");
  const toMs = parseDate(required(kv, "to"), "to");
  if (toMs <= fromMs) {
    throw new SovereignExportError(
      "date-range-invalid",
      `--to (${toMs}) must be > --from (${fromMs})`,
    );
  }
  const operatorId = required(kv, "operator-id");
  const operatorDisplayName = required(kv, "operator-name");
  const subjectId = kv.get("subject");
  const output = kv.get("output");
  const sign = !bools.has("no-sign");

  if ((format === "gdpr-dsar" || format === "gdpr-erasure") && !subjectId) {
    throw new SovereignExportError(
      "subject-not-found",
      `--subject is required for format ${format}`,
    );
  }

  return {
    format,
    jurisdiction,
    fromMs,
    toMs,
    operatorId,
    operatorDisplayName,
    subjectId,
    output,
    sign,
  };
}

function required(kv: Map<string, string>, key: string): string {
  const v = kv.get(key);
  if (!v) {
    throw new SovereignExportError(
      "cli-argument-invalid",
      `--${key} is required`,
    );
  }
  return v;
}

function parseDate(raw: string, flag: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  const iso = new Date(raw);
  if (Number.isNaN(iso.getTime())) {
    throw new SovereignExportError(
      "cli-argument-invalid",
      `--${flag} "${raw}" is not a valid ISO-8601 datetime or unix-ms integer`,
    );
  }
  return iso.getTime();
}

function helpText(): string {
  return [
    "aethelred-export — produce a signed regulator export.",
    "",
    "Required flags:",
    "  --format          one of: " + KNOWN_FORMATS.join(", "),
    "  --jurisdiction    ISO-3166-1 alpha-2 country code",
    "  --from            ISO-8601 datetime or unix-ms",
    "  --to              ISO-8601 datetime or unix-ms (> --from)",
    "  --operator-id     stable operator identifier",
    "  --operator-name   display name shown on the envelope",
    "",
    "Optional flags:",
    "  --subject <id>    required for gdpr-dsar / gdpr-erasure",
    "  --output <path>   file to write; default: stdout",
    "  --no-sign         emit an unsigned envelope (dev/testing only)",
    "",
    "Example:",
    "  aethelred-export --format sar-fincen-111 --jurisdiction US \\",
    "    --from 2026-01-01 --to 2026-01-31 \\",
    "    --operator-id acme --operator-name \"Acme Custody\"",
  ].join("\n");
}

// ─── Runner ──────────────────────────────────────────────

/**
 * Main CLI entry — orchestrates parseCliArgs → format → sign →
 * write. Exported for tests that want to drive the whole flow
 * without spawning a subprocess.
 */
export async function runCli(
  argv: ReadonlyArray<string>,
  context: CliContext,
): Promise<SignedExport> {
  const opts = parseCliArgs(argv);
  assertFormatJurisdictionCompatible(opts.format, opts.jurisdiction);

  const request: ExportRequest = {
    format: opts.format,
    jurisdiction: opts.jurisdiction,
    range: { fromMs: opts.fromMs, toMs: opts.toMs },
    operatorId: opts.operatorId,
    operatorDisplayName: opts.operatorDisplayName,
    subjectId: opts.subjectId,
  };

  const payload = await buildPayload(request, context);

  const signed = await buildSignedExport({
    request,
    payload,
    signer: opts.sign ? context.signer : undefined,
    now: context.now,
  });

  const json = JSON.stringify(signed, jsonReplacer, 2);
  if (opts.output && context.writeFile) {
    await context.writeFile(opts.output, json);
  } else if (context.writeStdout) {
    context.writeStdout(json);
  }

  return signed;
}

async function buildPayload(
  request: ExportRequest,
  ctx: CliContext,
): Promise<ExportPayload> {
  switch (request.format) {
    case "sar-fincen-111": {
      if (!ctx.sarExtra) {
        throw new SovereignExportError(
          "schema-field-missing",
          "CliContext.sarExtra required for sar-fincen-111",
        );
      }
      return formatSarFincen111({
        request,
        dataSource: ctx.dataSource,
        ...ctx.sarExtra,
      });
    }
    case "ctr-fincen-112": {
      if (!ctx.ctrExtra) {
        throw new SovereignExportError(
          "schema-field-missing",
          "CliContext.ctrExtra required for ctr-fincen-112",
        );
      }
      return formatCtrFincen112({
        request,
        dataSource: ctx.dataSource,
        ...ctx.ctrExtra,
      });
    }
    case "gdpr-dsar": {
      if (!ctx.gdprDsarExtra) {
        throw new SovereignExportError(
          "schema-field-missing",
          "CliContext.gdprDsarExtra required for gdpr-dsar",
        );
      }
      return formatGdprDsar({
        request,
        dataSource: ctx.dataSource,
        ...ctx.gdprDsarExtra,
      });
    }
    case "gdpr-erasure": {
      if (!ctx.gdprErasureExtra) {
        throw new SovereignExportError(
          "schema-field-missing",
          "CliContext.gdprErasureExtra required for gdpr-erasure",
        );
      }
      return formatGdprErasure({
        request,
        ...ctx.gdprErasureExtra,
      });
    }
    case "mica-transaction": {
      if (!ctx.micaExtra) {
        throw new SovereignExportError(
          "schema-field-missing",
          "CliContext.micaExtra required for mica-transaction",
        );
      }
      return formatMicaTransaction({
        request,
        dataSource: ctx.dataSource,
        ...ctx.micaExtra,
      });
    }
    default: {
      const exhaustive: never = request.format;
      throw new SovereignExportError(
        "report-format-unsupported",
        `unsupported format: ${exhaustive}`,
      );
    }
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  return value;
}
