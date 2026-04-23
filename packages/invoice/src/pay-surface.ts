/**
 * `PaySurfaceResolver` — the pure function behind `/pay/:slug`.
 *
 * Given a slug:
 *
 *   1. Look up the invoice in the store.
 *   2. Validate its state (not revoked, not expired, signature OK).
 *   3. Look up the merchant.
 *   4. Validate the merchant's profile signature + freshness.
 *   5. Project to an x402 `PaymentRequirement` ready for the payer.
 *   6. Determine the "active gate" (invoice gate if present, else
 *      merchant profile default gate, else null).
 *
 * Returns a `PaySurfaceResolution` that the HTTP handler serialises
 * to JSON. No HTTP-specific code here — the resolver is equally
 * usable from an Express handler, a Cloudflare Worker, a CLI, or a
 * test.
 */

import type {
  Invoice,
  InvoiceStore,
  MerchantProfile,
  MerchantStore,
  PaySurfaceResolution,
} from "./types";
import type { PaymentRequirement, SerializedVcGate } from "./types";
import { InvoiceError } from "./errors";
import { normalizeSlug } from "./slug";
import {
  verifyInvoiceSignature,
  verifyMerchantProfileSignature,
} from "./eip712-invoice";

export interface PaySurfaceResolverConfig {
  readonly merchants: MerchantStore;
  readonly invoices: InvoiceStore;
  /**
   * Clock override for deterministic tests. Returns unix ms.
   */
  readonly now?: () => number;
  /**
   * Skip re-verification of signatures (trust the store). Default:
   * `false`. Production callers should leave this off — signature
   * check is cheap and defends against a compromised store.
   */
  readonly skipSignatureVerification?: boolean;
  /** Chain id + verifying contract for EIP-712 verification. */
  readonly chainId?: number;
  readonly verifyingContract?: `0x${string}`;
}

export class PaySurfaceResolver {
  private readonly merchants: MerchantStore;
  private readonly invoices: InvoiceStore;
  private readonly now: () => number;
  private readonly skipVerification: boolean;
  private readonly chainId?: number;
  private readonly verifyingContract?: `0x${string}`;

  constructor(config: PaySurfaceResolverConfig) {
    this.merchants = config.merchants;
    this.invoices = config.invoices;
    this.now = config.now ?? (() => Date.now());
    this.skipVerification = config.skipSignatureVerification ?? false;
    this.chainId = config.chainId;
    this.verifyingContract = config.verifyingContract;
  }

  /**
   * Resolve a slug into a `PaySurfaceResolution`.
   *
   * Throws `InvoiceError` on every failure mode — HTTP handlers map
   * the error `code` onto the appropriate status (404 for
   * `invoice-not-found` / `merchant-not-found`, 410 for
   * `invoice-expired`, 451 for `invoice-revoked`, etc.). Callers
   * that want a non-throwing form wrap the call with a try/catch.
   */
  async resolve(slugInput: string): Promise<PaySurfaceResolution> {
    const slug = normalizeSlug(slugInput);
    const invoice = await this.invoices.getBySlug(slug);
    if (!invoice) {
      throw new InvoiceError(
        "invoice-not-found",
        `no invoice for slug "${slug}"`,
        { details: { slug } },
      );
    }
    return this.resolveInvoice(invoice);
  }

  /** Resolve by canonical id rather than slug. */
  async resolveById(id: `0x${string}`): Promise<PaySurfaceResolution> {
    const invoice = await this.invoices.getById(id);
    if (!invoice) {
      throw new InvoiceError(
        "invoice-not-found",
        `no invoice for id ${id}`,
        { details: { invoiceId: id } },
      );
    }
    return this.resolveInvoice(invoice);
  }

  /**
   * Shared tail for the two entry points. Exposed for callers that
   * already hold a fetched Invoice and want the full resolution
   * pipeline run against it (e.g. an internal UI that listed a
   * merchant's invoices via `store.listByMerchant` and wants to
   * render one without a second lookup).
   */
  async resolveInvoice(invoice: Invoice): Promise<PaySurfaceResolution> {
    const now = this.now();

    if (invoice.status === "void") {
      throw new InvoiceError(
        "invoice-revoked",
        `invoice ${invoice.id} is void`,
        { details: { invoiceId: invoice.id } },
      );
    }
    if (invoice.status === "paid") {
      throw new InvoiceError(
        "invoice-already-paid",
        `invoice ${invoice.id} already paid`,
        { details: { invoiceId: invoice.id } },
      );
    }
    if (invoice.status === "expired" || invoice.deadline <= now) {
      throw new InvoiceError(
        "invoice-expired",
        `invoice ${invoice.id} expired at ${invoice.deadline}`,
        { details: { invoiceId: invoice.id, deadline: invoice.deadline, now } },
      );
    }

    const merchant = await this.merchants.getById(invoice.merchantId);
    if (!merchant) {
      throw new InvoiceError(
        "merchant-not-found",
        `no merchant ${invoice.merchantId} for invoice ${invoice.id}`,
        { details: { merchantId: invoice.merchantId } },
      );
    }
    if (merchant.revoked) {
      throw new InvoiceError(
        "merchant-not-active",
        `merchant ${merchant.id} revoked${
          merchant.revocationReason ? `: ${merchant.revocationReason}` : ""
        }`,
        { details: { merchantId: merchant.id } },
      );
    }
    if (merchant.expiresAt !== undefined && merchant.expiresAt <= now) {
      throw new InvoiceError(
        "merchant-not-active",
        `merchant ${merchant.id} profile expired at ${merchant.expiresAt}`,
        { details: { merchantId: merchant.id, expiresAt: merchant.expiresAt } },
      );
    }

    if (!this.skipVerification) {
      // Verify merchant profile signature against itself. Any tamper
      // to the stored profile (display-name swap, key rotation
      // without re-signing) trips this.
      verifyMerchantProfileSignature(merchant, {
        chainId: this.chainId,
        verifyingContract: this.verifyingContract,
      });
      // Verify the invoice's signature against the merchant's address.
      verifyInvoiceSignature(invoice, merchant, {
        chainId: this.chainId,
        verifyingContract: this.verifyingContract,
      });
    }

    // Must also be on a network the merchant accepts.
    if (!merchant.acceptedNetworks.includes(invoice.network)) {
      throw new InvoiceError(
        "unsupported-network",
        `merchant ${merchant.id} does not accept network "${invoice.network}"`,
        {
          details: {
            merchantId: merchant.id,
            invoiceNetwork: invoice.network,
            accepted: merchant.acceptedNetworks,
          },
        },
      );
    }

    const activeGate: SerializedVcGate | null =
      invoice.gate ?? merchant.defaultGate ?? null;

    const paymentRequirement = toPaymentRequirement(invoice, merchant, activeGate, now);

    return {
      merchant,
      invoice,
      paymentRequirement,
      activeGate,
      resolvedAt: now,
    };
  }
}

// ─── x402 projection ───────────────────────────────────────

/**
 * Project an `Invoice` into an x402 `PaymentRequirement`.
 *
 * Exported as a pure function so callers that pre-compute the
 * projection (batch export, invoice preview UIs) can do so without
 * running the full resolver.
 */
export function toPaymentRequirement(
  invoice: Invoice,
  merchant: MerchantProfile,
  activeGate: SerializedVcGate | null,
  now: number,
): PaymentRequirement {
  const timeoutSeconds = Math.max(1, Math.floor((invoice.deadline - now) / 1000));
  const extra: Record<string, unknown> = {
    invoiceId: invoice.id,
    invoiceSlug: invoice.slug,
    merchantId: merchant.id,
    merchantDisplayName: merchant.displayName,
  };
  if (activeGate) extra.vcGate = activeGate;

  return {
    scheme: "exact",
    network: invoice.network,
    maxAmountRequired: invoice.amount,
    resource: `invoice:${invoice.slug}`,
    description: invoice.title,
    payTo: invoice.recipient,
    maxTimeoutSeconds: timeoutSeconds,
    asset: invoice.asset,
    extra,
  };
}
