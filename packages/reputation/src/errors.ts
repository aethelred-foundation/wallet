/**
 * Error taxonomy for the reputation package.
 *
 * The x402 facilitator, the MCP server, and the intent router all branch
 * on `code` (never on `message`) when they decide whether to surface a
 * gate failure as a 4xx to the agent vs. escalate to ops. Keep the code
 * set stable — downstream audit pivots rely on these strings.
 */

export type ReputationErrorCode =
  // Resolver failures
  | "agent-not-registered"
  | "agent-revoked"
  | "erc8004-network-error"
  | "erc8004-contract-error"
  // Scoring failures
  | "reputation-score-unavailable"
  | "reputation-input-invalid"
  // VC gate evaluation
  | "vc-gate-rule-unknown"
  | "vc-gate-denied"
  | "vc-gate-config-invalid"
  // x402 bridge
  | "x402-gate-malformed"
  | "x402-extra-missing";

export class ReputationError extends Error {
  readonly code: ReputationErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: ReputationErrorCode,
    message: string,
    options?: { readonly details?: Readonly<Record<string, unknown>>; readonly cause?: unknown },
  ) {
    super(message);
    this.name = "ReputationError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}

/** Thrown by `VcGate.evaluate` when one or more required rules fail. */
export class VcGateDeniedError extends ReputationError {
  readonly failedRuleIds: ReadonlyArray<string>;

  constructor(failedRuleIds: ReadonlyArray<string>, summary: string) {
    super("vc-gate-denied", summary, { details: { failedRuleIds } });
    this.name = "VcGateDeniedError";
    this.failedRuleIds = failedRuleIds;
  }
}
