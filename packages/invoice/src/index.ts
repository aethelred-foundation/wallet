/**
 * `@aethelred/wallet-invoice` — self-sovereign merchant invoices +
 * public /pay/:slug surface.
 *
 * Merchants sign their own profile + invoices with any
 * `CustodyAdapter` (EOA / Shamir / Ledger / Nitro / Fireblocks);
 * payers verify the full chain (merchant profile → signed invoice
 * → payment) without trusting a platform. `PaySurfaceResolver`
 * answers `/pay/:slug` as a pure function — HTTP wiring is the
 * consumer's concern.
 *
 * @packageDocumentation
 */

// ─── Types ────────────────────────────────────────────────────
export type {
  MerchantProfile,
  MerchantStore,
  Invoice,
  InvoiceStatus,
  InvoiceReceipt,
  InvoiceStore,
  PaySurfaceResolution,
  Address,
  PaymentNetwork,
  PaymentRequirement,
  Issuer,
  VerifiableCredential,
  SerializedVcGate,
  TeeAttestationBundle,
} from "./types";
export { INVOICE_TRANSITIONS } from "./types";

// ─── Errors ────────────────────────────────────────────────────
export { InvoiceError } from "./errors";
export type { InvoiceErrorCode } from "./errors";

// ─── Slugs ────────────────────────────────────────────────────
export {
  DEFAULT_SLUG_LENGTH,
  LONG_SLUG_LENGTH,
  generateSlug,
  generateUniqueSlug,
  isValidSlug,
  normalizeSlug,
} from "./slug";

// ─── EIP-712 layer ────────────────────────────────────────────
export {
  INVOICE_DOMAIN_NAME,
  INVOICE_DOMAIN_VERSION,
  invoiceDomain,
  canonicalJson,
  canonicalHash,
  buildMerchantProfileRequest,
  signMerchantProfile,
  verifyMerchantProfileSignature,
  buildInvoiceRequest,
  signInvoice,
  verifyInvoiceSignature,
  computeInvoiceId,
} from "./eip712-invoice";

// ─── In-memory stores ─────────────────────────────────────────
export {
  InMemoryMerchantStore,
  InMemoryInvoiceStore,
} from "./stores";

// ─── Pay surface ──────────────────────────────────────────────
export {
  PaySurfaceResolver,
  toPaymentRequirement,
} from "./pay-surface";
export type { PaySurfaceResolverConfig } from "./pay-surface";
