/**
 * Typed error taxonomy for the x402 package.
 *
 * The rule every module in this repo follows: **never throw a raw
 * `Error` across a package boundary**. Consumers should be able to
 * narrow on an `error.code` string and react deterministically
 * (retry, surface to user, log for SRE, etc.) without parsing
 * English messages.
 *
 * The codes are kebab-case to match the rest of the wallet's error
 * catalog (see `@aethelred/wallet-observability/error-codes.ts`).
 * New variants MUST be added to the `X402ErrorCode` union BEFORE
 * being thrown — the exhaustiveness checker in downstream reducers
 * will catch missing handlers at compile time.
 */

export type X402ErrorCode =
  // Client-side, pre-signature
  | "unsupported-scheme"
  | "unsupported-network"
  | "no-acceptable-requirement"
  | "amount-over-cap"
  | "invalid-payment-requirement"
  // Signing / attestation
  | "signer-rejected"
  | "attestation-unavailable"
  | "attestation-binding-failed"
  // Facilitator-side / wire
  | "facilitator-rejected"
  | "facilitator-network-error"
  | "payment-receipt-invalid"
  | "attestation-verification-failed"
  | "replay-detected"
  // Client-side, post-receipt
  | "receipt-binding-mismatch"
  | "unexpected-response-shape";

/**
 * Base error class carrying a structured code + optional cause.
 *
 * Concrete subclasses per category (below) exist only to give
 * `instanceof` discrimination a cheap path; consumers should still
 * branch on `code`, not `instanceof`, because code-checking is
 * symmetric across realms (jsdom test vs. extension runtime vs.
 * service worker) while `instanceof` is not.
 */
export class X402Error extends Error {
  readonly code: X402ErrorCode;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: X402ErrorCode,
    message: string,
    options?: { readonly cause?: unknown; readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(message);
    this.name = "X402Error";
    this.code = code;
    this.cause = options?.cause;
    this.details = options?.details;
  }
}

/** Thrown when parsing / validating a server-supplied 402 body fails. */
export class PaymentRequirementError extends X402Error {
  constructor(code: X402ErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(code, message, { details });
    this.name = "PaymentRequirementError";
  }
}

/** Thrown by signers + attestation providers in the `client.ts` path. */
export class SignerError extends X402Error {
  constructor(code: X402ErrorCode, message: string, options?: { cause?: unknown }) {
    super(code, message, options);
    this.name = "SignerError";
  }
}

/** Thrown when the facilitator rejects or the wire fails. */
export class FacilitatorError extends X402Error {
  readonly httpStatus?: number;
  readonly facilitatorMessage?: string;

  constructor(
    code: X402ErrorCode,
    message: string,
    options?: {
      readonly httpStatus?: number;
      readonly facilitatorMessage?: string;
      readonly cause?: unknown;
    },
  ) {
    super(code, message, { cause: options?.cause });
    this.name = "FacilitatorError";
    this.httpStatus = options?.httpStatus;
    this.facilitatorMessage = options?.facilitatorMessage;
  }
}
