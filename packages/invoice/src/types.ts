/**
 * `@aethelred/wallet-invoice` — type surface.
 *
 * Three primary shapes:
 *
 *   1. **MerchantProfile** — self-sovereign merchant metadata,
 *      signed by the merchant's own key (any CustodyAdapter). Carries
 *      display info, accepted networks, trusted VC issuers, default
 *      VC gates, optional TEE attestation anchoring for high-trust
 *      merchants.
 *
 *   2. **Invoice** — a single bill. Signed by the merchant. Has a
 *      lifecycle (`draft → open → paid | expired | void`). Projects
 *      to an x402 `PaymentRequirement` via `toPaymentRequirement`.
 *
 *   3. **PaySurfaceResolution** — the thing a `/pay/:slug` HTTP
 *      handler returns. Contains the merchant, the invoice, the
 *      projected PaymentRequirement, and any attestation the
 *      merchant presented. Pure data — no HTTP bits.
 *
 * Every cryptographic signature is EIP-712. Merchants sign their
 * profile once; they sign each invoice when they publish it. Payers
 * verify both signatures before honoring the invoice.
 */

import type {
  PaymentNetwork,
  PaymentRequirement,
  Address,
} from "@aethelred/wallet-x402";
import type { Issuer, VerifiableCredential } from "@aethelred/wallet-credentials";
import type { SerializedVcGate } from "@aethelred/wallet-reputation";
import type { TeeAttestationBundle } from "@aethelred/wallet-custody-adapters";

// ─── Merchant profile ──────────────────────────────────────────

/**
 * Self-sovereign merchant identity.
 *
 * `publicKey` is the merchant's EIP-712 signing key (compressed
 * secp256k1 hex, 33 bytes). `address` is the derived Ethereum
 * address — payers verify every invoice signature against this
 * address.
 *
 * `vcIssuers` is a per-merchant override of the trusted-issuer set.
 * Payers MAY honour this (e.g. a merchant that ONLY accepts KYC
 * VCs from Sumsub declares Sumsub as its sole trusted issuer). If
 * the payer's deployment pins a stricter issuer set, that wins —
 * the merchant list only narrows, never widens.
 */
export interface MerchantProfile {
  /** Stable identifier — unique across the deployment. */
  readonly id: string;
  /** Human-readable display name (shown on `/pay/:slug` pages). */
  readonly displayName: string;
  /** Optional: URL to a logo asset. Consumers render at their own risk. */
  readonly logoUrl?: string;
  /** Merchant's EIP-712 signing address. */
  readonly address: Address;
  /** Compressed 33-byte secp256k1 public key, 0x-prefixed hex. */
  readonly publicKey: `0x${string}`;
  /** Networks + USDC variants the merchant accepts. */
  readonly acceptedNetworks: ReadonlyArray<PaymentNetwork>;
  /** Trusted VC issuers this merchant additionally honours. */
  readonly vcIssuers?: ReadonlyArray<Issuer>;
  /**
   * Default VC gate applied to EVERY invoice unless the invoice
   * overrides it. Models "every payment to this merchant requires
   * KYC" at the profile level, not per invoice.
   */
  readonly defaultGate?: SerializedVcGate;
  /**
   * Optional TEE attestation that the merchant's signing key is
   * controlled by an approved enclave. Present for merchants who
   * opted into enclave-rooted custody. Payers can verify the
   * attestation chain before honoring any invoice from this
   * merchant.
   */
  readonly attestation?: TeeAttestationBundle;
  /** Unix ms when the profile was minted. */
  readonly createdAt: number;
  /** Unix ms after which the profile must be re-signed. */
  readonly expiresAt?: number;
  /**
   * EIP-712 signature over the canonical profile encoding by the
   * merchant's `address`. Payers verify this before trusting any
   * other field.
   */
  readonly signature: `0x${string}`;
  /** True after the operator / merchant has revoked the profile. */
  readonly revoked: boolean;
  /** Optional operator-set revocation reason (for audit). */
  readonly revocationReason?: string;
}

// ─── Invoice ──────────────────────────────────────────────────

export type InvoiceStatus = "draft" | "open" | "paid" | "expired" | "void";

/**
 * Valid transitions. Exported so callers building bespoke status-
 * machine UIs can drive the same rules.
 */
export const INVOICE_TRANSITIONS: Readonly<Record<InvoiceStatus, ReadonlyArray<InvoiceStatus>>> =
  Object.freeze({
    draft: ["open", "void"],
    open: ["paid", "expired", "void"],
    paid: [],
    expired: [],
    void: [],
  });

/**
 * A single invoice.
 *
 * The `slug` is the short URL-safe identifier surfaced at
 * `/pay/:slug`. We don't sign slugs — they're opaque identifiers —
 * we sign the `id`, which is deterministic from the rest of the
 * body. Collisions on slugs are operator-side bugs; the canonical
 * uniqueness key is `id`.
 */
export interface Invoice {
  /** Deterministic id — `keccak256(canonicalJson(body || merchant.id))`. */
  readonly id: `0x${string}`;
  /** URL-safe short slug, 10-14 base32 chars. */
  readonly slug: string;
  /** Merchant id this invoice belongs to. */
  readonly merchantId: string;
  /** Status at last known snapshot. */
  readonly status: InvoiceStatus;
  /** Short human-readable title. */
  readonly title: string;
  /** Free-form description. */
  readonly description?: string;
  /** Amount in the smallest unit (e.g. 1 USDC = 1_000_000). */
  readonly amount: string;
  /** ERC-20 asset address. */
  readonly asset: Address;
  /** Settlement network. */
  readonly network: PaymentNetwork;
  /** Destination address — typically equal to merchant.address. */
  readonly recipient: Address;
  /** Unix ms when this invoice expires if unpaid. */
  readonly deadline: number;
  /**
   * Optional VC gate that OVERRIDES the merchant's `defaultGate`.
   * When set, payers evaluate this gate (not the profile default).
   */
  readonly gate?: SerializedVcGate;
  /** Unix ms when the merchant published this invoice. */
  readonly createdAt: number;
  /**
   * Optional structured line items. Purely informational — the
   * total charged is always `amount`. Consumers render these on
   * the pay surface.
   */
  readonly lineItems?: ReadonlyArray<{
    readonly description: string;
    readonly quantity: number;
    readonly unitPriceAmount: string;
  }>;
  /**
   * Credentials the merchant attaches to the invoice. Payers MAY
   * inspect these to prove the merchant's status at invoice time
   * (e.g. "this merchant was KYC'd when the invoice was issued").
   * The merchant's profile signature does NOT cover these — payers
   * verify each VC independently.
   */
  readonly merchantCredentials?: ReadonlyArray<VerifiableCredential>;
  /**
   * EIP-712 signature by the merchant's signing address. Covers
   * every field except `signature` itself. Payers verify this
   * against `merchant.address` (resolved via the merchant registry).
   */
  readonly signature: `0x${string}`;
}

/**
 * Receipt persisted after an invoice transitions to `paid`.
 *
 * Kept separate from `Invoice` so the status transition is a single
 * atomic store of (newStatus, receipt). Audit pipelines persist the
 * receipt verbatim.
 */
export interface InvoiceReceipt {
  readonly invoiceId: `0x${string}`;
  readonly txHash?: `0x${string}`;
  readonly settlementRef?: string;
  readonly payer: Address;
  readonly paidAmount: string;
  readonly paidAt: number;
  /** Optional x402 payment authorization bytes (for audit replay). */
  readonly paymentAuthorization?: `0x${string}`;
}

// ─── Pay surface ──────────────────────────────────────────────

/**
 * What the `/pay/:slug` endpoint returns.
 *
 * Designed so a single GET returns everything the payer needs:
 *   - Merchant identity (verify signature, inspect credentials).
 *   - Invoice body (verify signature, inspect line items).
 *   - PaymentRequirement (submit to x402 client).
 *   - Active gate (profile default or invoice override).
 *
 * Not HTTP-specific. HTTP handlers serialise this to JSON.
 */
export interface PaySurfaceResolution {
  readonly merchant: MerchantProfile;
  readonly invoice: Invoice;
  readonly paymentRequirement: PaymentRequirement;
  readonly activeGate: SerializedVcGate | null;
  /** Unix ms when the resolution was computed. */
  readonly resolvedAt: number;
}

// ─── Store surfaces ────────────────────────────────────────────

/**
 * Pluggable storage for merchant profiles. Implementations back
 * this with a DB, a KV store, an on-chain registry, or in-memory
 * (tests). Every method is async because production backs this
 * with a network fetch.
 */
export interface MerchantStore {
  getById(id: string): Promise<MerchantProfile | null>;
  /** List all merchants. Optional — registries that paginate return undefined. */
  list?(): Promise<ReadonlyArray<MerchantProfile>>;
}

/**
 * Pluggable storage for invoices.
 *
 * Lookups by slug and by canonical id are both first-class — slug
 * is the UI-facing handle, id is the cryptographic handle. Stores
 * are expected to index both.
 */
export interface InvoiceStore {
  getBySlug(slug: string): Promise<Invoice | null>;
  getById(id: `0x${string}`): Promise<Invoice | null>;
  put(invoice: Invoice): Promise<void>;
  updateStatus(
    id: `0x${string}`,
    from: InvoiceStatus,
    to: InvoiceStatus,
    receipt?: InvoiceReceipt,
  ): Promise<void>;
  /** Optional: list invoices for a merchant. */
  listByMerchant?(merchantId: string): Promise<ReadonlyArray<Invoice>>;
}

// ─── Re-exports ────────────────────────────────────────────────

export type { Address, PaymentNetwork, PaymentRequirement };
export type { Issuer, VerifiableCredential };
export type { SerializedVcGate };
export type { TeeAttestationBundle };
