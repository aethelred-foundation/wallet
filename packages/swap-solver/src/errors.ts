/**
 * swap-solver error taxonomy.
 *
 * Convention (same as transfer-solver + x402-solver):
 *   - `quote()` declines via `null` return, not throw.
 *   - `settle()` throws `SwapSolverError` on any failure; the
 *     intent-router translates the throw into `settlement-failed`.
 *
 * Codes here are stable — audit pipelines + the intent-router's
 * event stream surface them verbatim.
 */

export type SwapSolverErrorCode =
  // Pre-flight validation
  | "unsupported-intent-kind"
  | "invalid-sell-asset-address"
  | "invalid-buy-asset-address"
  | "invalid-recipient-address"
  | "invalid-amount"
  | "same-sell-and-buy-asset"
  // Venue / routing
  | "venue-no-liquidity"
  | "venue-quote-below-min-buy-amount"
  | "venue-quote-failed"
  | "venue-build-failed"
  | "venue-decode-failed"
  // Submission / on-chain
  | "chain-submit-failed"
  | "chain-confirmation-timeout"
  | "chain-tx-reverted"
  | "chain-id-mismatch"
  | "fill-below-commitment"
  // Configuration
  | "solver-disposed"
  | "signer-mismatch";

export class SwapSolverError extends Error {
  readonly code: SwapSolverErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: SwapSolverErrorCode,
    message: string,
    options?: { readonly details?: Readonly<Record<string, unknown>>; readonly cause?: unknown },
  ) {
    super(message);
    this.name = "SwapSolverError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}
