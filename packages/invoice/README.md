# `@aethelred/wallet-invoice`

Self-sovereign merchant invoices + public `/pay/:slug` surface.

Merchants sign their own profile + invoices with any `CustodyAdapter`
(EOA, Shamir, Ledger, Nitro, Fireblocks). Payers verify the full
chain — **merchant profile → signed invoice → payment** — without
trusting a platform. `PaySurfaceResolver` answers `/pay/:slug` as a
pure function; HTTP wiring is the consumer's concern.

## Why this package exists

MoltPe has merchant accounts but they're tied to MoltPe's custody.
The merchant trusts MoltPe to hold funds and to issue invoices on
their behalf. That works for traditional commerce; it's the wrong
shape for agent-native payments where:

- The merchant might be an autonomous service issuing thousands of
  micro-invoices per minute.
- The payer is an agent that doesn't trust any specific platform —
  it verifies signatures independently before spending.
- Settlement happens over x402, not through a proprietary rail.

This package gives the merchant a self-sovereign identity and a
portable invoice format. Any deployment can host `/pay/:slug`. Any
x402 client can consume the projected `PaymentRequirement`. Nobody
is in the middle.

## Quick start

```ts
import {
  signMerchantProfile,
  signInvoice,
  computeInvoiceId,
  generateSlug,
  InMemoryInvoiceStore,
  InMemoryMerchantStore,
  PaySurfaceResolver,
} from "@aethelred/wallet-invoice";
import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";

// 1. Merchant creates and signs a profile.
const merchantSigner = new LocalKeyAdapter({ privateKey: process.env.MERCHANT_PK! });
const merchant = await signMerchantProfile(
  {
    id: "acme-corp",
    displayName: "Acme Corp",
    address: merchantSigner.address,
    publicKey: "0x...compressed secp256k1...",
    acceptedNetworks: ["base-mainnet", "ethereum-mainnet"],
    createdAt: Date.now(),
  },
  merchantSigner.asTypedDataSigner(),
);

// 2. Merchant creates + signs an invoice.
const body = {
  merchantId: merchant.id,
  title: "Monthly API access — November 2025",
  amount: "25000000",                               // 25 USDC
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  network: "base-mainnet" as const,
  recipient: merchant.address,
  deadline: Date.now() + 24 * 60 * 60_000,
  createdAt: Date.now(),
};
const invoice = await signInvoice(
  {
    ...body,
    id: computeInvoiceId(body),
    slug: generateSlug(),
    status: "open",
  },
  merchantSigner.asTypedDataSigner(),
  merchant,
);

// 3. Save.
const merchants = new InMemoryMerchantStore([merchant]);
const invoices = new InMemoryInvoiceStore();
await invoices.put(invoice);

// 4. Public `/pay/:slug` surface — plug into your HTTP framework.
const resolver = new PaySurfaceResolver({ merchants, invoices });
// Inside an Express / Hono / Worker handler:
const resolution = await resolver.resolve(slug);
// resolution.paymentRequirement is ready for the x402 client.
```

## The signing chain

```
 ┌───────────────┐  EIP-712  ┌─────────────┐  EIP-712  ┌──────────┐
 │ Merchant key  │ ───────► │   Profile   │ ────────► │ Invoice  │
 └───────────────┘           └─────────────┘           └──────────┘
                                   │                        │
                                   ▼                        ▼
                             verify at                 verify at
                            pay-surface              pay-surface
                              resolve                 resolve
```

- `signMerchantProfile` — produces the signed profile once.
- `signInvoice` — produces a signed invoice per bill.
- `verifyMerchantProfileSignature` / `verifyInvoiceSignature` —
  run on every `PaySurfaceResolver.resolve()`. Payers don't trust
  the backing store; they re-verify every time.

## Invoice lifecycle

```
 draft ── open ── paid
     │      │
     │      └──── expired
     │
     └──── void
```

`updateStatus(id, from, to, receipt?)` on `InvoiceStore` enforces
valid transitions. Transition to `paid` requires a receipt; any
other combination throws `invoice-state-transition-invalid`. A
paid or expired invoice is terminal.

## VC gate composition

A merchant can declare a `defaultGate` in their profile ("every
invoice requires KYC from Sumsub") AND each invoice can declare its
own `gate` override ("this particular invoice requires elite tier").
The resolver's rule: **invoice gate > merchant default > none**. The
active gate is surfaced on `PaySurfaceResolution.activeGate` AND
embedded in `paymentRequirement.extra.vcGate` so the x402
facilitator runs it unchanged.

## Slug format

Crockford base32 (0-9, A-Z minus I, L, O, U), 10 chars default = 50
bits of entropy. Case-insensitive; the store normalises uppercase.
Collisions are checked at `put` time; `generateUniqueSlug` wraps the
retry loop. NOT signed — the canonical cryptographic identifier is
`id = keccak256(body)`; slugs are routing handles only.

## Error codes

All errors throw `InvoiceError` with a stable `code`. Consumers
branch on `code` — never on `message`.

| Category | Codes |
| -------- | ----- |
| Invoice lifecycle | `invoice-not-found`, `invoice-expired`, `invoice-revoked`, `invoice-already-paid`, `invoice-malformed`, `invoice-signature-invalid`, `invoice-signer-mismatch`, `invoice-state-transition-invalid` |
| Merchant | `merchant-not-found`, `merchant-profile-invalid`, `merchant-not-active`, `merchant-signature-invalid` |
| Slug | `slug-invalid`, `slug-collision`, `slug-not-resolvable` |
| Projection | `x402-projection-failed`, `unsupported-network` |

## What this package DOES NOT do

- Ship an HTTP server. `PaySurfaceResolver.resolve()` is a pure
  function. Wire it into Express / Hono / Cloudflare Workers / a
  CLI — whatever fits your deployment.
- Persist durably. `InMemoryInvoiceStore` and `InMemoryMerchantStore`
  are for tests + small deployments. Implement `InvoiceStore` /
  `MerchantStore` against Postgres / DynamoDB / a KV store / an
  on-chain registry for production.
- Handle on-chain settlement. The resolver projects to an x402
  `PaymentRequirement`; actual settlement happens through the x402
  facilitator.

## Integration with the rest of the stack

- **x402**: `paymentRequirement` is ready for `x402Fetch`.
- **Reputation**: the `activeGate` plugs directly into the reputation
  package's `evaluatePayment`.
- **Intent router**: a `PaymentIntent` can carry the invoice slug in
  `extra`; the router resolves the slug before quoting.
- **Custody adapters**: every signing operation — profile, invoice,
  payment authorisation — uses the same `TypedDataSigner` interface.

## Testing

```bash
npx vitest run invoice
```

36 tests covering: slug generate + normalise + validate + uniqueness
retry, EIP-712 profile sign + verify + tamper detection + signer
mismatch, invoice id determinism + change detection, invoice sign +
verify + fabricated-id detection + wrong-merchant rejection, store
round-trip + duplicate rejection + state machine enforcement +
paid-requires-receipt, `PaySurfaceResolver` happy path + every
failure mode (not found, expired, paid, void, merchant not found,
merchant revoked, merchant profile expired, network not accepted),
gate composition (invoice > default > none), `toPaymentRequirement`
pure projection.
