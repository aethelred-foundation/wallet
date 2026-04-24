/**
 * Notarization error taxonomy. Stable codes: audit dashboards pivot
 * on them; callers branch on them.
 */

export type NotarizationErrorCode =
  // Input validation
  | "batch-malformed"
  | "batch-empty"
  | "root-zero"
  | "event-count-zero"
  | "chain-id-mismatch"
  // Anchor submission
  | "anchor-submit-failed"
  | "anchor-receipt-missing"
  | "anchor-receipt-malformed"
  | "anchor-tx-reverted"
  | "anchor-confirmation-timeout"
  // Proof verification
  | "proof-merkle-invalid"
  | "proof-root-mismatch"
  | "proof-record-mismatch"
  // Scheduler
  | "scheduler-already-running"
  | "scheduler-stopped"
  // Generic lifecycle
  | "service-disposed";

export class NotarizationError extends Error {
  readonly code: NotarizationErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: NotarizationErrorCode,
    message: string,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message);
    this.name = "NotarizationError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}
