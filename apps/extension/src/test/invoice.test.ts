/**
 * Invoice + merchant + pay-surface tests.
 *
 * Coverage:
 *
 *   1. Slug: generate valid chars only, normalize upper-cases,
 *      invalid chars rejected, uniqueness retry loop.
 *   2. EIP-712 MerchantProfile: signMerchantProfile returns a valid
 *      signature; verifyMerchantProfileSignature accepts it;
 *      tampering any field breaks verification; signer-mismatch at
 *      sign time rejected.
 *   3. EIP-712 Invoice: computeInvoiceId is deterministic for same
 *      body; id changes when any field changes; signInvoice
 *      populates signature; verifyInvoiceSignature accepts valid
 *      invoice; tampering breaks verification; wrong-merchant-key
 *      rejected.
 *   4. Stores: put + getBySlug / getById round-trip; duplicate put
 *      rejected; updateStatus enforces the state machine; paid
 *      transition requires a receipt; listByMerchant filters.
 *   5. PaySurfaceResolver:
 *        - Happy path: resolve(slug) → full resolution with x402
 *          projection and merchant verification.
 *        - Invoice not found → invoice-not-found.
 *        - Invoice expired → invoice-expired.
 *        - Invoice already paid → invoice-already-paid.
 *        - Invoice void → invoice-revoked.
 *        - Merchant not found → merchant-not-found.
 *        - Merchant revoked → merchant-not-active.
 *        - Merchant profile expired → merchant-not-active.
 *        - Network not accepted → unsupported-network.
 *        - activeGate picks invoice gate over merchant default.
 *        - toPaymentRequirement produces x402 extra.vcGate when gate
 *          is present and omits it when null.
 */

import { describe, expect, it } from "vitest";

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  // slug
  DEFAULT_SLUG_LENGTH,
  generateSlug,
  generateUniqueSlug,
  isValidSlug,
  normalizeSlug,
  // EIP-712
  signMerchantProfile,
  verifyMerchantProfileSignature,
  signInvoice,
  verifyInvoiceSignature,
  computeInvoiceId,
  // stores
  InMemoryInvoiceStore,
  InMemoryMerchantStore,
  // pay surface
  PaySurfaceResolver,
  toPaymentRequirement,
  // errors
  InvoiceError,
  // types
  type Invoice,
  type InvoiceReceipt,
  type MerchantProfile,
  type SerializedVcGate,
} from "@aethelred/wallet-invoice";

// ─── Fixtures ────────────────────────────────────────────────

const PK_A = "0x" + "01".repeat(32);
const PK_B = "0x" + "02".repeat(32);

const adapterA = () => new LocalKeyAdapter({ privateKey: PK_A });
const adapterB = () => new LocalKeyAdapter({ privateKey: PK_B });

async function makeMerchant(
  overrides: Partial<MerchantProfile> = {},
  signerOverride?: LocalKeyAdapter,
): Promise<MerchantProfile> {
  const signer = signerOverride ?? adapterA();
  return signMerchantProfile(
    {
      id: overrides.id ?? "test-merchant",
      displayName: overrides.displayName ?? "Test Merchant",
      logoUrl: overrides.logoUrl,
      address: signer.address,
      publicKey: ("0x" + "02" + "00".repeat(32)) as `0x${string}`,
      acceptedNetworks: overrides.acceptedNetworks ?? ["base-mainnet"],
      vcIssuers: overrides.vcIssuers,
      defaultGate: overrides.defaultGate,
      attestation: overrides.attestation,
      createdAt: overrides.createdAt ?? 1_700_000_000_000,
      expiresAt: overrides.expiresAt,
    },
    signer.asTypedDataSigner(),
  );
}

async function makeInvoice(
  merchant: MerchantProfile,
  overrides: Partial<Invoice> = {},
  signerOverride?: LocalKeyAdapter,
): Promise<Invoice> {
  const signer = signerOverride ?? adapterA();
  const body = {
    merchantId: merchant.id,
    title: overrides.title ?? "Example Invoice",
    description: overrides.description ?? "Test description",
    amount: overrides.amount ?? "1000000", // 1 USDC
    asset: overrides.asset ?? ("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`),
    network: overrides.network ?? ("base-mainnet" as const),
    recipient: overrides.recipient ?? merchant.address,
    deadline: overrides.deadline ?? Date.now() + 60_000,
    gate: overrides.gate,
    createdAt: overrides.createdAt ?? 1_700_000_000_000,
    lineItems: overrides.lineItems,
  };
  const id = computeInvoiceId(body);
  const slug = overrides.slug ?? generateSlug();
  const draft: Omit<Invoice, "signature"> = {
    ...body,
    id,
    slug,
    status: overrides.status ?? "open",
    merchantCredentials: overrides.merchantCredentials,
  };
  return signInvoice(draft, signer.asTypedDataSigner(), merchant);
}

// ─── Slug ──────────────────────────────────────────────────

describe("slug", () => {
  it("generateSlug produces default-length Crockford base32", () => {
    const slug = generateSlug();
    expect(slug.length).toBe(DEFAULT_SLUG_LENGTH);
    expect(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/.test(slug)).toBe(true);
  });

  it("normalizeSlug upper-cases and validates", () => {
    expect(normalizeSlug("abc123xyz0")).toBe("ABC123XYZ0");
  });

  it("rejects invalid chars", () => {
    expect(() => normalizeSlug("contains-dashes")).toThrow(InvoiceError);
    expect(() => normalizeSlug("I_IS_EXCLUDED")).toThrow(InvoiceError); // I not in alphabet
  });

  it("rejects too-short or too-long slugs", () => {
    expect(() => normalizeSlug("ABC")).toThrow(/length/);
    expect(() => normalizeSlug("A".repeat(40))).toThrow(/length/);
  });

  it("isValidSlug predicate form", () => {
    expect(isValidSlug("ABCDEF1234")).toBe(true);
    expect(isValidSlug("@@@")).toBe(false);
  });

  it("generateUniqueSlug retries past collisions", async () => {
    let call = 0;
    const slug = await generateUniqueSlug(async () => {
      call += 1;
      return call <= 2; // first two "taken"
    });
    expect(slug.length).toBe(DEFAULT_SLUG_LENGTH);
    expect(call).toBe(3);
  });

  it("generateUniqueSlug throws after maxAttempts", async () => {
    await expect(
      generateUniqueSlug(async () => true, { maxAttempts: 3 }),
    ).rejects.toMatchObject({ code: "slug-collision" });
  });
});

// ─── EIP-712 merchant profile ─────────────────────────────

describe("signMerchantProfile / verifyMerchantProfileSignature", () => {
  it("signs and verifies", async () => {
    const merchant = await makeMerchant();
    expect(() => verifyMerchantProfileSignature(merchant)).not.toThrow();
  });

  it("rejects signer that does not match profile.address", async () => {
    const a = adapterA();
    const b = adapterB();
    await expect(
      signMerchantProfile(
        {
          id: "m",
          displayName: "M",
          address: a.address, // profile claims A
          publicKey: ("0x" + "02" + "00".repeat(32)) as `0x${string}`,
          acceptedNetworks: ["base-mainnet"],
          createdAt: 0,
        },
        b.asTypedDataSigner(), // but signer is B
      ),
    ).rejects.toMatchObject({ code: "merchant-signature-invalid" });
  });

  it("detects field tampering", async () => {
    const merchant = await makeMerchant();
    const tampered: MerchantProfile = { ...merchant, displayName: "Injected Name" };
    expect(() => verifyMerchantProfileSignature(tampered)).toThrow(InvoiceError);
  });
});

// ─── EIP-712 invoice ───────────────────────────────────────

describe("computeInvoiceId + signInvoice + verifyInvoiceSignature", () => {
  it("id is deterministic for the same body", async () => {
    const body = {
      merchantId: "m",
      title: "T",
      amount: "1",
      asset: ("0x" + "a0".repeat(20)) as `0x${string}`,
      network: "base-mainnet" as const,
      recipient: ("0x" + "b0".repeat(20)) as `0x${string}`,
      deadline: 42,
      createdAt: 0,
    };
    expect(computeInvoiceId(body)).toBe(computeInvoiceId(body));
  });

  it("id changes when any field changes", async () => {
    const body = {
      merchantId: "m",
      title: "T",
      amount: "1",
      asset: ("0x" + "a0".repeat(20)) as `0x${string}`,
      network: "base-mainnet" as const,
      recipient: ("0x" + "b0".repeat(20)) as `0x${string}`,
      deadline: 42,
      createdAt: 0,
    };
    const a = computeInvoiceId(body);
    const b = computeInvoiceId({ ...body, amount: "2" });
    expect(a).not.toBe(b);
  });

  it("sign + verify happy path", async () => {
    const merchant = await makeMerchant();
    const inv = await makeInvoice(merchant);
    expect(() => verifyInvoiceSignature(inv, merchant)).not.toThrow();
  });

  it("rejects tampered field", async () => {
    const merchant = await makeMerchant();
    const inv = await makeInvoice(merchant);
    expect(() =>
      verifyInvoiceSignature({ ...inv, amount: "999999" }, merchant),
    ).toThrow(InvoiceError);
  });

  it("rejects signer mismatch with merchant", async () => {
    const merchantA = await makeMerchant();
    // Try to sign merchantA's invoice with B's key
    await expect(
      (async () => {
        const body = {
          merchantId: merchantA.id,
          title: "T",
          amount: "1",
          asset: ("0x" + "aa".repeat(20)) as `0x${string}`,
          network: "base-mainnet" as const,
          recipient: merchantA.address,
          deadline: Date.now() + 60_000,
          createdAt: Date.now(),
        };
        const id = computeInvoiceId(body);
        const draft: Omit<Invoice, "signature"> = {
          ...body,
          id,
          slug: generateSlug(),
          status: "open",
        };
        return signInvoice(draft, adapterB().asTypedDataSigner(), merchantA);
      })(),
    ).rejects.toMatchObject({ code: "invoice-signer-mismatch" });
  });

  it("rejects invoice whose id was fabricated", async () => {
    const merchant = await makeMerchant();
    const body = {
      merchantId: merchant.id,
      title: "T",
      amount: "1",
      asset: ("0x" + "aa".repeat(20)) as `0x${string}`,
      network: "base-mainnet" as const,
      recipient: merchant.address,
      deadline: Date.now() + 60_000,
      createdAt: Date.now(),
    };
    const fabricatedId = ("0x" + "ff".repeat(32)) as `0x${string}`;
    const draft: Omit<Invoice, "signature"> = {
      ...body,
      id: fabricatedId,
      slug: generateSlug(),
      status: "open",
    };
    await expect(
      signInvoice(draft, adapterA().asTypedDataSigner(), merchant),
    ).rejects.toMatchObject({ code: "invoice-malformed" });
  });
});

// ─── Stores ────────────────────────────────────────────────

describe("InMemoryInvoiceStore", () => {
  it("put + getBySlug / getById round-trip", async () => {
    const merchant = await makeMerchant();
    const inv = await makeInvoice(merchant, { slug: "ABC123DEF4" });
    const store = new InMemoryInvoiceStore();
    await store.put(inv);
    expect((await store.getBySlug("abc123def4"))?.id).toBe(inv.id);
    expect((await store.getById(inv.id))?.slug).toBe("ABC123DEF4");
  });

  it("rejects duplicate id", async () => {
    const merchant = await makeMerchant();
    const inv = await makeInvoice(merchant);
    const store = new InMemoryInvoiceStore();
    await store.put(inv);
    await expect(store.put(inv)).rejects.toMatchObject({ code: "invoice-malformed" });
  });

  it("rejects duplicate slug", async () => {
    const merchant = await makeMerchant();
    const inv = await makeInvoice(merchant, { slug: "AAAAAA1234" });
    // Different content → different id, but same slug
    const inv2 = await makeInvoice(merchant, {
      slug: "AAAAAA1234",
      amount: "999",
    });
    const store = new InMemoryInvoiceStore();
    await store.put(inv);
    await expect(store.put(inv2)).rejects.toMatchObject({ code: "slug-collision" });
  });

  it("updateStatus enforces the state machine", async () => {
    const merchant = await makeMerchant();
    const inv = await makeInvoice(merchant);
    const store = new InMemoryInvoiceStore();
    await store.put(inv);

    // open → paid requires receipt
    await expect(store.updateStatus(inv.id, "open", "paid")).rejects.toMatchObject({
      code: "invoice-state-transition-invalid",
    });

    const receipt: InvoiceReceipt = {
      invoiceId: inv.id,
      payer: ("0x" + "f0".repeat(20)) as `0x${string}`,
      paidAmount: inv.amount,
      paidAt: Date.now(),
    };
    await store.updateStatus(inv.id, "open", "paid", receipt);

    // paid has no valid transitions
    await expect(store.updateStatus(inv.id, "paid", "void")).rejects.toMatchObject({
      code: "invoice-state-transition-invalid",
    });
  });

  it("rejects invalid from-state", async () => {
    const merchant = await makeMerchant();
    const inv = await makeInvoice(merchant);
    const store = new InMemoryInvoiceStore();
    await store.put(inv);
    // inv.status is "open", but caller claims "draft"
    await expect(store.updateStatus(inv.id, "draft", "open")).rejects.toMatchObject({
      code: "invoice-state-transition-invalid",
    });
  });

  it("listByMerchant filters by merchantId", async () => {
    const mA = await makeMerchant({ id: "merchant-a" });
    const mB = await makeMerchant({ id: "merchant-b" }, adapterB());
    const store = new InMemoryInvoiceStore();
    await store.put(await makeInvoice(mA, { slug: "XXX123YYY4" }));
    await store.put(await makeInvoice(mA, { slug: "XXX123YYY5", amount: "2" }));
    await store.put(await makeInvoice(mB, { slug: "XXX123YYY6" }, adapterB()));
    expect((await store.listByMerchant("merchant-a")).length).toBe(2);
    expect((await store.listByMerchant("merchant-b")).length).toBe(1);
  });
});

// ─── PaySurfaceResolver ────────────────────────────────────

describe("PaySurfaceResolver", () => {
  async function scaffoldResolver(
    merchantOverrides: Partial<MerchantProfile> = {},
    invoiceOverrides: Partial<Invoice> = {},
  ) {
    const merchant = await makeMerchant(merchantOverrides);
    const invoice = await makeInvoice(merchant, invoiceOverrides);
    const invoices = new InMemoryInvoiceStore();
    await invoices.put(invoice);
    const merchants = new InMemoryMerchantStore([merchant]);
    const resolver = new PaySurfaceResolver({ merchants, invoices });
    return { merchant, invoice, invoices, merchants, resolver };
  }

  it("happy path resolves slug → full resolution + x402 projection", async () => {
    const { merchant, invoice, resolver } = await scaffoldResolver();
    const result = await resolver.resolve(invoice.slug);
    expect(result.merchant.id).toBe(merchant.id);
    expect(result.invoice.id).toBe(invoice.id);
    expect(result.paymentRequirement.scheme).toBe("exact");
    expect(result.paymentRequirement.maxAmountRequired).toBe(invoice.amount);
    expect(result.paymentRequirement.asset).toBe(invoice.asset);
    expect(result.paymentRequirement.extra?.invoiceSlug).toBe(invoice.slug);
  });

  it("invoice-not-found for unknown slug", async () => {
    const { resolver } = await scaffoldResolver();
    await expect(resolver.resolve("ZZZZZZZZZZ")).rejects.toMatchObject({
      code: "invoice-not-found",
    });
  });

  it("invoice-expired when deadline passed", async () => {
    const { resolver, invoice } = await scaffoldResolver({}, { deadline: Date.now() - 1000 });
    await expect(resolver.resolve(invoice.slug)).rejects.toMatchObject({
      code: "invoice-expired",
    });
  });

  it("invoice-already-paid when status is paid", async () => {
    const { resolver, invoice, invoices } = await scaffoldResolver();
    const receipt: InvoiceReceipt = {
      invoiceId: invoice.id,
      payer: ("0x" + "f0".repeat(20)) as `0x${string}`,
      paidAmount: invoice.amount,
      paidAt: Date.now(),
    };
    await invoices.updateStatus(invoice.id, "open", "paid", receipt);
    await expect(resolver.resolve(invoice.slug)).rejects.toMatchObject({
      code: "invoice-already-paid",
    });
  });

  it("invoice-revoked when status is void", async () => {
    const { resolver, invoice, invoices } = await scaffoldResolver();
    await invoices.updateStatus(invoice.id, "open", "void");
    await expect(resolver.resolve(invoice.slug)).rejects.toMatchObject({
      code: "invoice-revoked",
    });
  });

  it("merchant-not-found when store omits merchant", async () => {
    const merchant = await makeMerchant();
    const invoice = await makeInvoice(merchant);
    const invoices = new InMemoryInvoiceStore();
    await invoices.put(invoice);
    const merchants = new InMemoryMerchantStore([]); // empty
    const resolver = new PaySurfaceResolver({ merchants, invoices });
    await expect(resolver.resolve(invoice.slug)).rejects.toMatchObject({
      code: "merchant-not-found",
    });
  });

  it("merchant-not-active when revoked", async () => {
    const merchant = await makeMerchant();
    const invoice = await makeInvoice(merchant);
    const invoices = new InMemoryInvoiceStore();
    await invoices.put(invoice);
    const revokedMerchant: MerchantProfile = {
      ...merchant,
      revoked: true,
      revocationReason: "policy-violation",
    };
    const merchants = new InMemoryMerchantStore([revokedMerchant]);
    const resolver = new PaySurfaceResolver({ merchants, invoices });
    await expect(resolver.resolve(invoice.slug)).rejects.toMatchObject({
      code: "merchant-not-active",
    });
  });

  it("merchant-not-active when profile expired", async () => {
    const { resolver, invoice, merchants } = await scaffoldResolver({
      expiresAt: Date.now() - 1000,
    });
    void merchants;
    await expect(resolver.resolve(invoice.slug)).rejects.toMatchObject({
      code: "merchant-not-active",
    });
  });

  it("unsupported-network when invoice network not in merchant.acceptedNetworks", async () => {
    const merchant = await makeMerchant({ acceptedNetworks: ["ethereum-mainnet"] });
    const invoice = await makeInvoice(merchant, { network: "base-mainnet" });
    const invoices = new InMemoryInvoiceStore();
    await invoices.put(invoice);
    const merchants = new InMemoryMerchantStore([merchant]);
    const resolver = new PaySurfaceResolver({ merchants, invoices });
    await expect(resolver.resolve(invoice.slug)).rejects.toMatchObject({
      code: "unsupported-network",
    });
  });

  it("activeGate prefers invoice gate over merchant default", async () => {
    const defaultGate: SerializedVcGate = {
      directives: [{ type: "require-registered-agent" }],
    };
    const invoiceGate: SerializedVcGate = {
      directives: [{ type: "require-min-tier", minTier: "elite" }],
    };
    const merchant = await makeMerchant({ defaultGate });
    const invoice = await makeInvoice(merchant, { gate: invoiceGate });
    const invoices = new InMemoryInvoiceStore();
    await invoices.put(invoice);
    const merchants = new InMemoryMerchantStore([merchant]);
    const resolver = new PaySurfaceResolver({ merchants, invoices });
    const result = await resolver.resolve(invoice.slug);
    expect(result.activeGate).toEqual(invoiceGate);
    expect(result.paymentRequirement.extra?.vcGate).toEqual(invoiceGate);
  });

  it("activeGate falls back to merchant default when invoice has no gate", async () => {
    const defaultGate: SerializedVcGate = {
      directives: [{ type: "require-registered-agent" }],
    };
    const { resolver, invoice } = await scaffoldResolver({ defaultGate });
    const result = await resolver.resolve(invoice.slug);
    expect(result.activeGate).toEqual(defaultGate);
  });

  it("no gate anywhere → extra omits vcGate", async () => {
    const { resolver, invoice } = await scaffoldResolver();
    const result = await resolver.resolve(invoice.slug);
    expect(result.activeGate).toBeNull();
    expect(result.paymentRequirement.extra?.vcGate).toBeUndefined();
  });

  it("resolveById takes the canonical id path", async () => {
    const { resolver, invoice } = await scaffoldResolver();
    const result = await resolver.resolveById(invoice.id);
    expect(result.invoice.id).toBe(invoice.id);
  });

  it("toPaymentRequirement is a pure projection", async () => {
    const merchant = await makeMerchant();
    const invoice = await makeInvoice(merchant);
    const req = toPaymentRequirement(invoice, merchant, null, Date.now());
    expect(req.payTo).toBe(invoice.recipient);
    expect(req.maxAmountRequired).toBe(invoice.amount);
    expect(req.extra?.merchantId).toBe(merchant.id);
  });
});
