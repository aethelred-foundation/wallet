/**
 * transfer-solver error taxonomy.
 *
 * Same convention as `@aethelred/wallet-x402-solver`:
 *   - `quote()` declines via `null` return, not throw.
 *   - `settle()` throws `TransferSolverError` on any failure; the
 *     intent-router translates the throw into `settlement-failed`.
 *
 * Codes here are stable — audit pipelines + the intent-router's
 * event stream surface them verbatim.
 */

export type TransferSolverErrorCode =
  // Pre-flight validation
  | "unsupported-intent-kind"
  | "invalid-asset-address"
  | "invalid-recipient-address"
  | "invalid-amount"
  // Balance pre-flight (PR #101)
  | "pre-flight-insufficient-balance"
  // Submission
  | "chain-submit-failed"
  | "chain-confirmation-timeout"
  | "chain-tx-reverted"
  | "chain-id-mismatch"
  // Configuration
  | "solver-disposed"
  | "signer-mismatch";

export class TransferSolverError extends Error {
  readonly code: TransferSolverErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: TransferSolverErrorCode,
    message: string,
    options?: { readonly details?: Readonly<Record<string, unknown>>; readonly cause?: unknown },
  ) {
    super(message);
    this.name = "TransferSolverError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}
