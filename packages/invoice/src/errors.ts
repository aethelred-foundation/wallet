/**
 * Invoice package error taxonomy.
 *
 * Callers (HTTP handlers for `/pay/:slug`, MCP tools, x402 clients)
 * branch on `code` — never on `message`. Keep the vocabulary stable.
 */

export type InvoiceErrorCode =
  // Lifecycle
  | "invoice-not-found"
  | "invoice-expired"
  | "invoice-revoked"
  | "invoice-already-paid"
  | "invoice-malformed"
  | "invoice-signature-invalid"
  | "invoice-signer-mismatch"
  | "invoice-state-transition-invalid"
  // Merchant
  | "merchant-not-found"
  | "merchant-profile-invalid"
  | "merchant-not-active"
  | "merchant-signature-invalid"
  // Slug
  | "slug-invalid"
  | "slug-collision"
  | "slug-not-resolvable"
  // Projection
  | "x402-projection-failed"
  | "unsupported-network";

export class InvoiceError extends Error {
  readonly code: InvoiceErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;

  constructor(
    code: InvoiceErrorCode,
    message: string,
    options?: { readonly details?: Readonly<Record<string, unknown>>; readonly cause?: unknown },
  ) {
    super(message);
    this.name = "InvoiceError";
    this.code = code;
    this.details = options?.details;
    this.cause = options?.cause;
  }
}
