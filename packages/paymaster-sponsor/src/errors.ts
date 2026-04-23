/**
 * Paymaster-sponsor error taxonomy.
 *
 * Every failure mode the sponsor service can produce gets a stable
 * code. The JSON-RPC layer maps codes to HTTP status. Callers and
 * audit pipelines branch on `code`, never on `message`.
 */

export type PaymasterSponsorErrorCode =
  // Request validation
  | "request-malformed"
  | "userop-malformed"
  | "userop-hash-mismatch"
  | "chain-id-unsupported"
  // Pricing / oracle
  | "price-unavailable"
  | "price-too-stale"
  | "gas-overflow"
  // Policy
  | "policy-denied"
  | "rate-limit-exceeded"
  | "agent-blocked"
  | "kill-switch-engaged"
  | "insufficient-prepayment"
  // Settlement ledger
  | "request-id-reused"
  | "settlement-not-found"
  | "settlement-double-reconcile"
  // Signing
  | "paymaster-signer-error"
  | "paymaster-address-mismatch"
  // Service lifecycle
  | "service-disposed";

export class PaymasterSponsorError extends Error {
  readonly code: PaymasterSponsorErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: PaymasterSponsorErrorCode,
    message: string,
    options?: {
      readonly details?: Readonly<Record<string, unknown>>;
      readonly cause?: unknown;
    },
  ) {
    super(message);
    this.name = "PaymasterSponsorError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}
