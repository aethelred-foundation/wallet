# `@aethelred/wallet-intent-router`

EIP-712 typed intents + solver marketplace.

Agents declare outcomes (**transfer** X to Y, **swap** A for ≥B,
**pay** merchant M for resource R); solvers compete on price, speed,
and reputation; the router picks a winner and verifies the fill.

This is the layer that flips the wallet from "payment rail" to
"agent operating system."

## Why this package exists

MoltPe is structurally a payment rail: one wallet, one stack, one
settlement path. That's appropriate for vanilla A2A payments, but
agent workloads increasingly look like:

- "Swap my 100 USDC for at least 0.031 WETH by 5pm, delivered to 0xMe."
- "Pay any of these three merchants ≤$10 for the best latency."
- "Move 250 USDC from my Nitro-rooted treasury to my ops wallet."

Intent-centric architecture (ERC-7683, UniswapX, CoW Protocol) is
how modern agent systems express those. This package is Aethelred's
intent layer, designed to plug into the custody adapters (#54) and
VC-gated reputation bridge (#56) that already shipped.

Solver marketplaces create network effects: every new solver makes
every agent better off, every new agent makes every solver richer.
That's a moat shape MoltPe can't replicate by bolting on a
competitor — they'd need to re-architect the rail.

## Quick start

```ts
import {
  createSignedIntent,
  IntentRouter,
  InMemorySolverRegistry,
  bestPrice,
} from "@aethelred/wallet-intent-router";
import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";

// 1. Agent signs an intent with any CustodyAdapter.
const adapter = new LocalKeyAdapter({ privateKey: process.env.PK! });
const intent = await createSignedIntent({
  body: {
    kind: "swap",
    sellAsset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
    sellAmount: "100000000",                                // 100 USDC
    buyAsset:  "0x4200000000000000000000000000000000000006", // WETH
    minBuyAmount: "30000000000000000",                       // ≥0.03 WETH
    recipient: adapter.address,
  },
  creator: adapter.address,
  chainId: 8453,
  deadlineMs: Date.now() + 10 * 60_000,
  signer: adapter.asTypedDataSigner(),
});

// 2. Register solvers and start the router.
const registry = new InMemorySolverRegistry([uniswapSolver, cowSolver, kyberSolver]);
const router = new IntentRouter({ registry, comparator: bestPrice });

// 3. Execute.
const result = await router.execute(intent);
if (result.outcome.kind === "fulfilled") {
  console.log("Settled at", result.outcome.fill.settlementRef);
}
```

## Pipeline

```
createSignedIntent() ──┐
                       ├──> router.execute()
                       │     │
                       │     ├─ verifyIntentSignature()
                       │     ├─ assertIntentFresh()  // deadline check
                       │     ├─ nonceStore.claim()   // replay guard
                       │     ├─ paymentGate.evaluate()  (any kind — gate dispatches)
                       │     ├─ registry.listFor(kind)
                       │     ├─ solvers.quote() in parallel
                       │     ├─ pickBest(quotes, intent, comparator)
                       │     ├─ winner.settle()
                       │     └─ verifyFillAgainstQuote()
                       │
                       └──> AuditSink (every stage)
```

Every stage emits a structured `IntentRouterAuditEvent` — audit
pipelines subscribe once and get the full history for any intent.

## Intent kinds

**Transfer** — exact amount of an asset to a recipient.

```ts
{ kind: "transfer", asset, amount, recipient }
```

**Swap** — sell X of A for at least Y of B.

```ts
{ kind: "swap", sellAsset, sellAmount, buyAsset, minBuyAmount, recipient, slippageBps? }
```

**Payment** — pay up to X to a merchant for a resource (shaped so it
maps 1:1 onto x402 `PaymentRequirement`).

```ts
{ kind: "payment", asset, maxAmount, merchant, resource, description?, extra? }
```

All three share the `IntentEnvelope` header:

```ts
{ id, creator, chainId, nonce, deadline, attestationBinding?, signature }
```

## Fill verification

The router cross-checks every solver fill against the quote:

| Kind     | Rule                         |
| -------- | ---------------------------- |
| transfer | `actualAmount == commitment` |
| swap     | `actualAmount >= commitment` |
| payment  | `actualAmount <= commitment` |

Solver tries to short-change you? `FillMismatchError`.

## Comparators

Built-in:

- `bestPrice` — lowest cost for transfer/payment, highest output
  for swap.
- `fastestFill` — lowest `estimatedFillTimeMs`, ties broken on price.
- `composite({ price, speed, trust })` — weighted blend of ranks.
  Takes a `trustForSolver` resolver so operators can wire reputation
  from `@aethelred/wallet-reputation` into the comparator directly.

Write your own: `QuoteComparator = (a, b, intent) => number`.

## VC-gated intents (one gate per intent kind)

Three adapters ship — one per intent kind — because the VC gate
spec comes from different places depending on the kind:

| Gate | Intent kind | Spec source | Semantic |
|------|-------------|-------------|----------|
| `ReputationPaymentGate` | `payment` | `intent.body.extra.vcGate` | Counterparty-declared (merchant's x402 policy) |
| `ReputationTransferGate` | `transfer` | gate config | Operator-declared (wallet's "who can transfer") |
| `ReputationSwapGate` | `swap` | gate config | Operator-declared (wallet's "who can swap") |

Payment carries receiver-declared policy because x402's whole model
is receiver-declared access control. Transfer + swap are sovereign-
wallet operations with no counterparty-policy channel, so the gate
spec is config-time.

### One kind at a time

```ts
import { ReputationPaymentGate } from "@aethelred/wallet-intent-router";
import { InMemoryERC8004Resolver } from "@aethelred/wallet-reputation";

const gate = new ReputationPaymentGate({
  resolver: new InMemoryERC8004Resolver([...]),
  credentialSource: myCredStore,
});
const router = new IntentRouter({ registry, paymentGate: gate });
```

### Operator policy for transfer + swap

```ts
import {
  ReputationSwapGate,
  ReputationTransferGate,
} from "@aethelred/wallet-intent-router";
import type { SerializedVcGate } from "@aethelred/wallet-reputation";

const operatorPolicy: SerializedVcGate = {
  combinator: "all",
  directives: [
    { type: "require-registered-agent" },
    { type: "require-not-revoked" },
    { type: "require-min-reputation", minScore: 600 },
  ],
};

const transferGate = new ReputationTransferGate({
  gate: operatorPolicy,
  resolver, credentialSource,
});
const swapGate = new ReputationSwapGate({
  gate: operatorPolicy,
  resolver, credentialSource,
});
```

### Wire all three behind one router

The router exposes a single `paymentGate` slot; use
`composeGatesByIntentKind` to dispatch per-kind:

```ts
import { composeGatesByIntentKind } from "@aethelred/wallet-intent-router";

const paymentGate = composeGatesByIntentKind({
  payment: new ReputationPaymentGate({ ... }),
  transfer: new ReputationTransferGate({ gate: operatorPolicy, ... }),
  swap: new ReputationSwapGate({ gate: operatorPolicy, ... }),
});
new IntentRouter({ registry, paymentGate });
```

Intent kinds without a registered gate pass through (`allowed: true`
with `evaluation: null`).

Any gate denial returns `outcome.kind === "payment-gated"` with the
`failedRuleIds` — structured input for the UI. Audit logs see the
full `VcGateEvaluation`.

All three adapters delegate through the reputation package's
`evaluateAgent` primitive. The payment gate wraps it inside
`evaluatePayment` (which first extracts the VC gate from
`intent.body.extra.vcGate`); the transfer and swap gates wrap it
directly against a `SerializedVcGate` from their config. One
primitive, three wrappers, identical fail-closed semantics.

> **Note on the `paymentGate` slot name.** Historically the router
> invoked the gate only for `kind: "payment"`. As of the three-gate
> trio landing, the router invokes it for ALL intent kinds — the
> slot is kind-agnostic despite the name. The name is kept for
> backward compatibility with existing configs. Gates that don't
> handle a given kind should return `{ allowed: true, evaluation:
> null }`; `composeGatesByIntentKind` does this automatically for
> unregistered kinds.

## Replay guard

`NonceStore.claim()` records `(creator, nonce, chainId)` atomically.
Ship `InMemoryNonceStore` for dev; swap in a Redis-backed or DB-
backed implementation for production. The router throws
`intent-nonce-reused` on a second-use attempt regardless of whether
the intent's signature still verifies — replay protection is
mandatory.

## What's NOT in this package

- **Solver implementations**. Real solvers (Uniswap v3, CoW batch,
  x402 facilitator, bespoke credit providers) live in separate
  packages / services. This package is the framework.
- **On-chain settlement primitives**. Solvers own their settlement
  path — the router is settlement-engine-agnostic.
- **Network-level solver discovery** (ERC-7683-style registries).
  Plug a `SolverRegistry` that talks to your discovery service.

## Testing

```bash
npx vitest run intent-router
```

29 tests: envelope determinism + tampering detection, cross-chain
replay defence, registry filtering, every comparator against a
stable fixture, fill-verification rules per intent kind, router
happy path + every failure mode (no solvers, all decline,
settlement failure, expired intent, reused nonce, malformed solver
response, pre-expired quote, timeout), payment-gate allow + deny
flows, audit trail sequencing.
