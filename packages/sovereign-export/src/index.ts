/**
 * `@aethelred/wallet-sovereign-export` — regulator-format compliance
 * exports.
 *
 * Four formats ship:
 *
 *   - `sar-fincen-111` — FinCEN SAR form 111 (US suspicious activity).
 *   - `ctr-fincen-112` — FinCEN CTR form 112 (US > $10k transactions).
 *   - `gdpr-dsar` — EU articles 15 + 20 data subject access.
 *   - `gdpr-erasure` — EU article 17 erasure confirmation.
 *   - `mica-transaction` — EU MiCA transaction reporting.
 *
 * Every export carries a signed EIP-712 envelope the regulator
 * verifies before parsing payload internals. Signatures work with
 * any CustodyAdapter, including Nitro-enclave-sealed signers.
 *
 * @packageDocumentation
 */

// ─── Types ────────────────────────────────────────────────
export type {
  DateRange,
  ExportFormat,
  Jurisdiction,
  RedactionProfile,
  RedactionPolicy,
  ExportDataSource,
  ExportRequest,
  ExportEnvelope,
  ExportPayload,
  SignedExport,
  SarFincen111Payload,
  SarCategory,
  SarSubject,
  SarTransaction,
  CtrFincen112Payload,
  GdprDsarPayload,
  GdprErasurePayload,
  MicaTransactionPayload,
} from "./types";

// ─── Errors ───────────────────────────────────────────────
export { SovereignExportError } from "./errors";
export type { SovereignExportErrorCode } from "./errors";

// ─── Redaction ────────────────────────────────────────────
export {
  applyRedaction,
  hashField,
  redactPayload,
  truncateAddress,
  truncateEmail,
} from "./redaction";

// ─── Envelope / signing ───────────────────────────────────
export {
  ENVELOPE_DOMAIN_NAME,
  ENVELOPE_DOMAIN_VERSION,
  buildEnvelopeRequest,
  buildSignedExport,
  canonicalJson,
  payloadHash,
  verifySignedExport,
  assertFormatJurisdictionCompatible,
} from "./envelope";

// ─── Formatters ──────────────────────────────────────────
export { formatSarFincen111 } from "./formatters/sar-fincen-111";
export type { SarFormatterInput } from "./formatters/sar-fincen-111";
export { formatCtrFincen112 } from "./formatters/ctr-fincen-112";
export type { CtrFormatterInput } from "./formatters/ctr-fincen-112";
export { formatGdprDsar, formatGdprErasure } from "./formatters/gdpr";
export type {
  GdprDsarFormatterInput,
  GdprErasureFormatterInput,
} from "./formatters/gdpr";
export { formatMicaTransaction } from "./formatters/mica-transaction";
export type { MicaFormatterInput } from "./formatters/mica-transaction";

// ─── CLI ──────────────────────────────────────────────────
export { runCli, parseCliArgs } from "./cli";
export type { CliOptions, CliContext } from "./cli";
