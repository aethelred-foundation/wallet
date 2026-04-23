/**
 * In-memory store implementations.
 *
 * Both suitable for tests, local dev, and small self-hosted
 * deployments. Production callers swap these for DB / KV / on-chain
 * implementations behind the `MerchantStore` / `InvoiceStore`
 * interfaces. The API contract — not the backing store — is what the
 * pay-surface resolver consumes.
 */

import type {
  Invoice,
  InvoiceReceipt,
  InvoiceStatus,
  InvoiceStore,
  MerchantProfile,
  MerchantStore,
} from "./types";
import { INVOICE_TRANSITIONS } from "./types";
import { InvoiceError } from "./errors";
import { normalizeSlug } from "./slug";

// ─── Merchant store ──────────────────────────────────────────

export class InMemoryMerchantStore implements MerchantStore {
  private readonly byId = new Map<string, MerchantProfile>();

  constructor(seed: ReadonlyArray<MerchantProfile> = []) {
    for (const m of seed) this.put(m);
  }

  put(merchant: MerchantProfile): void {
    this.byId.set(merchant.id, merchant);
  }

  async getById(id: string): Promise<MerchantProfile | null> {
    return this.byId.get(id) ?? null;
  }

  async list(): Promise<ReadonlyArray<MerchantProfile>> {
    return [...this.byId.values()];
  }
}

// ─── Invoice store ──────────────────────────────────────────

export class InMemoryInvoiceStore implements InvoiceStore {
  private readonly byId = new Map<string, Invoice>();
  private readonly bySlug = new Map<string, Invoice>();
  /** Receipts keyed by invoice id. */
  private readonly receipts = new Map<string, InvoiceReceipt>();

  constructor(seed: ReadonlyArray<Invoice> = []) {
    for (const inv of seed) {
      this.byId.set(inv.id.toLowerCase(), inv);
      this.bySlug.set(normalizeSlug(inv.slug), inv);
    }
  }

  async getBySlug(slug: string): Promise<Invoice | null> {
    return this.bySlug.get(normalizeSlug(slug)) ?? null;
  }

  async getById(id: `0x${string}`): Promise<Invoice | null> {
    return this.byId.get(id.toLowerCase()) ?? null;
  }

  async put(invoice: Invoice): Promise<void> {
    const key = invoice.id.toLowerCase();
    if (this.byId.has(key)) {
      throw new InvoiceError(
        "invoice-malformed",
        `invoice ${invoice.id} already stored — use updateStatus to transition`,
      );
    }
    const slug = normalizeSlug(invoice.slug);
    if (this.bySlug.has(slug)) {
      throw new InvoiceError(
        "slug-collision",
        `slug "${slug}" already in use by invoice ${this.bySlug.get(slug)?.id}`,
      );
    }
    this.byId.set(key, invoice);
    this.bySlug.set(slug, invoice);
  }

  async updateStatus(
    id: `0x${string}`,
    from: InvoiceStatus,
    to: InvoiceStatus,
    receipt?: InvoiceReceipt,
  ): Promise<void> {
    const key = id.toLowerCase();
    const current = this.byId.get(key);
    if (!current) throw new InvoiceError("invoice-not-found", `invoice ${id} not found`);
    if (current.status !== from) {
      throw new InvoiceError(
        "invoice-state-transition-invalid",
        `invoice ${id} is ${current.status}, cannot transition from ${from}`,
      );
    }
    const allowed = INVOICE_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new InvoiceError(
        "invoice-state-transition-invalid",
        `transition ${from} → ${to} is not permitted`,
      );
    }

    if (to === "paid" && !receipt) {
      throw new InvoiceError(
        "invoice-state-transition-invalid",
        `transition to "paid" requires a receipt`,
      );
    }

    const next: Invoice = { ...current, status: to };
    this.byId.set(key, next);
    this.bySlug.set(normalizeSlug(next.slug), next);
    if (receipt) this.receipts.set(key, receipt);
  }

  /** Test / ops helper — not part of `InvoiceStore`. */
  getReceipt(id: `0x${string}`): InvoiceReceipt | undefined {
    return this.receipts.get(id.toLowerCase());
  }

  async listByMerchant(merchantId: string): Promise<ReadonlyArray<Invoice>> {
    const out: Invoice[] = [];
    for (const inv of this.byId.values()) {
      if (inv.merchantId === merchantId) out.push(inv);
    }
    return out;
  }
}
