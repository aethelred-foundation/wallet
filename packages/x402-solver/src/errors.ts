/**
 * x402-solver error taxonomy.
 *
 * The intent-router's `Solver.quote()` is expected to return `null`
 * for "I can't quote this intent" — NOT throw. Throwing during quote
 * declines the solver for the intent. Throwing during `settle()` is
 * expected for actual settlement failures and routes through the
 * intent-router's `settlement-failed` outcome.
 *
 * Codes here are stable — the intent-router's audit trail surfaces
 * them verbatim when a solver settle throws.
 */

export type X402SolverErrorCode =
  // Pre-flight validation
  | "unsupported-intent-kind"
  | "missing-resource-url"
  | "invalid-resource-url"
  // Balance pre-flight (PR #105)
  | "pre-flight-insufficient-balance"
  // Settlement
  | "no-matching-requirement"
  | "payment-authorization-rejected"
  | "facilitator-http-error"
  | "missing-receipt"
  | "receipt-amount-exceeds-commitment"
  // Configuration
  | "solver-disposed"
  | "signer-mismatch";

export class X402SolverError extends Error {
  readonly code: X402SolverErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: X402SolverErrorCode,
    message: string,
    options?: { readonly details?: Readonly<Record<string, unknown>>; readonly cause?: unknown },
  ) {
    super(message);
    this.name = "X402SolverError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}
