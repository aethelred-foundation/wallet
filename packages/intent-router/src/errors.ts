/**
 * Error taxonomy for the intent router.
 *
 * Every stage of the pipeline (submit → solicit → pick → settle →
 * verify) has its own failure mode. Callers branch on `code`; audit
 * dashboards pivot on it too. Keep the vocabulary stable.
 */

export type IntentRouterErrorCode =
  // Envelope / validation
  | "intent-malformed"
  | "intent-expired"
  | "intent-signature-invalid"
  | "intent-signer-mismatch"
  | "intent-nonce-reused"
  | "intent-unsupported-kind"
  // Solver phase
  | "no-solvers-available"
  | "all-solvers-declined"
  | "solver-quote-malformed"
  | "solver-quote-expired"
  | "solver-not-registered"
  | "solver-timeout"
  // Settlement phase
  | "settlement-failed"
  | "settlement-fill-mismatch"
  | "settlement-replay-detected"
  // Gating (from reputation package)
  | "payment-gated"
  // Router-internal
  | "router-disposed"
  | "audit-sink-failed";

export class IntentRouterError extends Error {
  readonly code: IntentRouterErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: IntentRouterErrorCode,
    message: string,
    options?: { readonly details?: Readonly<Record<string, unknown>>; readonly cause?: unknown },
  ) {
    super(message);
    this.name = "IntentRouterError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}

/** Thrown when no solver returned a quote. */
export class NoQuotesError extends IntentRouterError {
  constructor(intentId: `0x${string}`, solversTried: number) {
    super(
      "all-solvers-declined",
      `No solver produced a quote for intent ${intentId} (${solversTried} solver(s) tried)`,
      { details: { intentId, solversTried } },
    );
    this.name = "NoQuotesError";
  }
}

/** Thrown when a solver's advertised fill does not match the quote commitment. */
export class FillMismatchError extends IntentRouterError {
  constructor(intentId: `0x${string}`, expected: string, actual: string) {
    super(
      "settlement-fill-mismatch",
      `Solver fill for intent ${intentId} did not match quote commitment (expected=${expected}, actual=${actual})`,
      { details: { intentId, expected, actual } },
    );
    this.name = "FillMismatchError";
  }
}
