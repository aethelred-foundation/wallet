/**
 * Error taxonomy for the AgentBudget TS client.
 *
 * Codes mirror the on-chain custom errors so callers branch on the same
 * vocabulary whether a check fails in the client simulation or on-chain.
 * Audit dashboards and UIs pivot on `code`; keep it stable.
 */

export type AgentBudgetErrorCode =
  // Lifecycle / config
  | "budget-not-found"
  | "budget-revoked"
  | "session-not-found"
  | "session-already-exists"
  | "session-expired"
  | "session-revoked"
  | "not-owner"
  | "invalid-window"
  | "zero-amount"
  // Cap enforcement
  | "per-call-cap-exceeded"
  | "per-tx-cap-exceeded"
  | "daily-cap-exceeded"
  // Client-side
  | "calldata-encode-failed"
  | "provider-call-failed"
  | "chain-id-mismatch"
  | "session-key-invalid"
  | "session-key-disposed";

export class AgentBudgetError extends Error {
  readonly code: AgentBudgetErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: AgentBudgetErrorCode,
    message: string,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message);
    this.name = "AgentBudgetError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}

/**
 * Map the on-chain `canSpend` reason byte onto an AgentBudgetErrorCode.
 * Used by the client when it surfaces the result of a dry-run.
 */
export const CAN_SPEND_REASONS: Readonly<Record<number, AgentBudgetErrorCode | "ok">> = Object.freeze({
  0: "ok",
  1: "session-not-found",
  2: "session-revoked",
  3: "session-expired",
  4: "budget-revoked",
  5: "per-call-cap-exceeded",
  6: "per-tx-cap-exceeded",
  7: "daily-cap-exceeded",
  8: "zero-amount",
});
