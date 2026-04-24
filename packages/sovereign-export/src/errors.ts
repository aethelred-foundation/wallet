/**
 * Error taxonomy for sovereign-export.
 *
 * Codes map to regulator-side "report rejected" conditions where
 * possible, so an operator can re-run with a precise fix. Audit
 * dashboards pivot on code.
 */

export type SovereignExportErrorCode =
  // Input validation
  | "export-request-malformed"
  | "date-range-invalid"
  | "subject-not-found"
  | "report-format-unsupported"
  | "jurisdiction-unsupported"
  // Schema compliance
  | "schema-field-missing"
  | "schema-field-invalid"
  | "amount-threshold-not-met"
  | "reportable-entity-count-zero"
  // PII / redaction
  | "pii-redaction-failed"
  | "pii-over-redacted"
  // Signing
  | "export-signer-mismatch"
  | "export-signature-invalid"
  | "export-integrity-mismatch"
  // CLI
  | "cli-argument-invalid"
  | "cli-datasource-unreachable"
  // Generic
  | "export-disposed";

export class SovereignExportError extends Error {
  readonly code: SovereignExportErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: SovereignExportErrorCode,
    message: string,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message);
    this.name = "SovereignExportError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}
