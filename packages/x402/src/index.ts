/**
 * `@aethelred/wallet-x402` — x402 (HTTP 402 Payment Required) protocol
 * client + facilitator, bound to TEE-attested agent identity.
 *
 * Public API:
 *
 *   Client (agents paying for resources):
 *     - `x402Fetch(url, options)` — one-shot fetch-and-pay.
 *     - `signPaymentAuthorization(input)` — build + sign the
 *       EIP-3009 authorization by hand, when you need more
 *       control than `x402Fetch` gives you.
 *     - `TypedDataSigner` — plug your custody backend in here.
 *     - `AttestationProvider` — plug your TEE quote fetcher.
 *
 *   Facilitator (receivers verifying + broadcasting):
 *     - `verifyPayment(req)` — verify signature + attestation.
 *     - `broadcastVerifiedPayment(input)` — broadcast + build receipt.
 *     - `PaymentBroadcaster` — plug your chain-broadcast strategy.
 *     - `AttestationVerifier` — plug in `@aethelred/wallet-compliance`.
 *
 *   Protocol primitives (both sides):
 *     - `parsePaymentRequirements(raw)` — validate 402 body JSON.
 *     - `computeBindingHash(structHash, quote)` — the moat hash.
 *     - `verifyBindingHash(input)` — constant-time compare.
 *     - `encodeAttestationHeader` / `decodeAttestationHeader`.
 *     - `encodeReceiptHeader` (facilitator) — serialize receipts.
 *
 *   Types:
 *     - `PaymentRequirement`, `PaymentPayload`, `PaymentReceipt`,
 *       `PaymentAttestationPayload`, `AttestationRequirement`,
 *       `PaymentScheme`, `PaymentNetwork`, `Address`,
 *       `Eip3009Authorization`, `TypedDataDomain`, `TypedDataField`.
 *
 *   Errors:
 *     - `X402Error` (base) + `PaymentRequirementError`, `SignerError`,
 *       `FacilitatorError` (typed subclasses).
 *     - `X402ErrorCode` — the canonical string-union taxonomy.
 *
 * @packageDocumentation
 */

// Types
export type {
  Address,
  PaymentScheme,
  PaymentNetwork,
  AttestationRequirement,
  PaymentRequirement,
  PaymentRequirementsResponse,
  Eip3009Authorization,
  PaymentPayload,
  PaymentAttestationPayload,
  PaymentReceipt,
  TypedDataSigner,
  TypedDataDomain,
  TypedDataField,
} from "./types";

// Errors
export {
  X402Error,
  PaymentRequirementError,
  SignerError,
  FacilitatorError,
  type X402ErrorCode,
} from "./errors";

// Address
export { asAddress, isAddress } from "./address";

// Chain config
export {
  chainIdForNetwork,
  usdcAddressForNetwork,
  labelForNetwork,
  parsePaymentNetwork,
} from "./chain-config";

// EIP-3009
export {
  signPaymentAuthorization,
  computeTransferAuthStructHash,
  MAX_VALIDITY_WINDOW_SECONDS,
} from "./eip3009";

// Payment requirements
export { parsePaymentRequirements } from "./payment-requirements";

// Attestation binding (moat cornerstone)
export {
  canonicalQuoteBytes,
  computeBindingHash,
  encodeAttestationHeader,
  decodeAttestationHeader,
  verifyBindingHash,
} from "./attestation-binding";

// Client
export {
  x402Fetch,
  type X402FetchOptions,
  type X402FetchResult,
  type PaymentPolicyHook,
  type PaymentPolicyDecision,
  type AttestationProvider,
  type AuditHook,
} from "./client";

// Facilitator
export {
  verifyPayment,
  broadcastVerifiedPayment,
  encodeReceiptHeader,
  type VerifyPaymentRequest,
  type VerifyPaymentResult,
  type PaymentBroadcaster,
  type AttestationVerifier,
  type SignerRecovery,
} from "./facilitator";
