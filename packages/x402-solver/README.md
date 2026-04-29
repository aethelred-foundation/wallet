# `@aethelred/wallet-x402-solver`

First production-shape solver implementation for the intent-router's
marketplace. Accepts `PaymentIntent`, signs an EIP-3009 authorization
with your custody backend, submits via `x402Fetch`, and translates
the receipt into an intent-router `Fill`.

## Why this package exists

Before this package, the intent-router had:

- A framework (`Solver` / `Quote` / `Fill` contracts).
- An in-memory stub solver in the integration demo.
- Zero real-world solvers customers could drop in.

This package is the **pattern** every subsequent solver follows.
Uniswap v3, CoW batch, and bespoke liquidity solvers implement the
same `Solver` interface with the same shape:

1. `quote()` — fast, optimistic, decline with `null` if unserveable.
2. `settle()` — do the real work, throw `*SolverError` with a stable
   code on failure.
3. Config + signer at construction, not per-call.

## Quick start

```ts
import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  InMemorySolverRegistry,
  IntentRouter,
  createSignedIntent,
} from "@aethelred/wallet-intent-router";
import { X402FacilitatorSolver } from "@aethelred/wallet-x402-solver";

// 1. Configure signer (any CustodyAdapter works — this is LocalKey
//    for illustration; production uses Nitro / Ledger / Shamir).
const custody = new LocalKeyAdapter({ privateKey: process.env.PK! });

// 2. Instantiate the solver.
const solver = new X402FacilitatorSolver({
  id: "x402-facilitator-base-mainnet",
  name: "Aethelred x402 facilitator (Base mainnet)",
  signer: custody.asTypedDataSigner(),
  supportedNetworks: ["base-mainnet"], // optional — narrows routing
  attestation: myTeeAttestationProvider, // optional — enables gated paths
  audit: myAuditHook, // optional
});

// 3. Register with the router.
const router = new IntentRouter({
  registry: new InMemorySolverRegistry([solver]),
});

// 4. Submit a payment intent.
const intent = await createSignedIntent({
  body: {
    kind: "payment",
    asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
    maxAmount: "1000000", // 1 USDC
    merchant: MERCHANT_ADDR,
    resource: "https://api.example.com/premium-data",
  },
  creator: custody.address,
  chainId: 8453,
  deadlineMs: Date.now() + 5 * 60_000,
  signer: custody.asTypedDataSigner(),
});

const result = await router.execute(intent);
if (result.outcome.kind === "fulfilled") {
  console.log("Paid:", result.outcome.fill.actualAmount);
  console.log("Receipt:", result.outcome.fill.metadata);
}
```

## Design

### Optimistic quoting

`quote()` does NOT HTTP-preflight the resource. The intent-router is
designed to fan out quotes to many solvers in parallel; HTTP per
solver doesn't scale.

Instead, `quote()` commits optimistically to `intent.body.maxAmount`.
The intent-router's `verifyFillAgainstQuote` rule for payment is
`actualAmount <= commitment`, so paying the ceiling is always sound.
The `settle()` path does the real negotiation with the facilitator.

**Future extension:** a `preflight: true` config flag can add a HEAD
request during quote to check the resource is reachable and rejects
unknown networks earlier. Not in v0.1 to keep the scaling profile
clean.

### Declines as null, failures as throw

Follows the intent-router's `Solver` contract:

| Condition | Return |
|-----------|--------|
| Non-payment intent | `quote → null` |
| Creator ≠ signer address | `quote → null` |
| Missing / malformed resource | `quote → null` |
| Facilitator HTTP error | `settle → throws X402SolverError` |
| No receipt returned | `settle → throws` |
| Receipt exceeds commitment | `settle → throws` |

`null` lets the router try other solvers for this intent. Throw
routes through the `settlement-failed` outcome.

### Fill metadata carries the full receipt

`Fill.metadata` is typed as `X402SolverFillMetadata`:

```ts
{
  solverClass: "x402-facilitator";
  paymentReceipt: PaymentReceipt;  // txHash, paymentId, etc.
  httpStatus: number;
}
```

Consumers wanting the on-chain tx hash for reconciliation read
`fill.metadata.paymentReceipt.txHash`. The router's audit pipeline
persists the whole metadata blob.

### Signer enforcement

`quote()` and `settle()` both check `intent.envelope.creator ==
config.signer.address`. Quote returns null (fast decline); settle
throws `signer-mismatch`. The double-check is belt-and-braces —
the intent-router already validates the EIP-712 signature before
reaching here, but a wrong-signer config is a deploy mistake we
catch at runtime anyway.

### Balance pre-flight (PR #105, opt-in)

By default the solver submits the EIP-3009 authorization to the
facilitator without checking balance. Setting `balancePreflight`
adds a fail-fast check at `settle()` time:

```ts
import {
  encodeErc20BalanceOf,
  decodeErc20BalanceOfResult,
} from "@aethelred/wallet-transfer-solver"; // ABI helpers (PR #101)
import { X402FacilitatorSolver } from "@aethelred/wallet-x402-solver";

const solver = new X402FacilitatorSolver({
  // ...
  balancePreflight: async (owner, asset) => {
    const result = await rpc.call<string>("eth_call", [
      { to: asset, data: encodeErc20BalanceOf(owner) },
      "latest",
    ]);
    return decodeErc20BalanceOfResult(result);
  },
});
```

When configured, the solver queries the agent's balance BEFORE
calling `x402Fetch`. If the balance is less than the intent's
`maxAmount`, it throws `pre-flight-insufficient-balance`
immediately — saving the round-trip of HTTP request + EIP-712
sign + facilitator on-chain submission and surfacing a clear
error rather than an opaque `transferWithAuthorization` revert.

**Three subtle behaviors:**

1. **Check is against `maxAmount`, not the actual paid amount.**
   The facilitator returns `paidAgainst.maxAmountRequired` only
   AFTER the HTTP roundtrip; to fail-fast we have to commit to
   a check before `x402Fetch`. `intent.body.maxAmount` is the
   ceiling agents authorize — strictly a superset of what could
   actually be paid. If pre-flight passes, every payment ≤
   maxAmount succeeds too.

2. **Fail-OPEN on callback errors.** If the operator's RPC
   throws (network flake, transient), the solver swallows and
   proceeds with `x402Fetch` — the chain has the final say on
   sufficiency. Only a definitive `balance < maxAmount` answer
   triggers the throw.

3. **`balance >= maxAmount` (≥, not strict `>`).** Exact-
   balance payments succeed. Operators wanting a buffer for
   gas wrap the callback to subtract a reserve.

**Symmetric to:**

- PR #97's swap-allowance pre-flight in
  `@aethelred/wallet-swap-venue-uniswap-v3`
  (`skipApproveWhenSufficient`)
- PR #101's transfer-balance pre-flight in
  `@aethelred/wallet-transfer-solver` (`balancePreflight`)

Closes the trilogy: every solver kind in v0.1 now has an
opt-in fail-fast precondition check.

## Errors

All failures throw `X402SolverError` with a stable `code`:

| Code | When |
|------|------|
| `unsupported-intent-kind` | `settle()` called with non-payment intent |
| `missing-resource-url` | Resource field empty |
| `invalid-resource-url` | Resource parses, but isn't HTTP(S) |
| `no-matching-requirement` | *(reserved for preflight mode)* |
| `payment-authorization-rejected` | *(reserved for richer facilitator handshake)* |
| `facilitator-http-error` | `x402Fetch` threw OR returned ≥400 |
| `missing-receipt` | 2xx without a receipt |
| `receipt-amount-exceeds-commitment` | Facilitator over-charged |
| `pre-flight-insufficient-balance` | (PR #105) `balancePreflight` returned a balance less than `intent.body.maxAmount` |
| `solver-disposed` | Solver used after `dispose()` |
| `signer-mismatch` | Intent creator ≠ configured signer address |

Consumers branch on `code`, never on `message`.

## Testing

```bash
npx vitest run x402-solver
```

26 tests covering: identity, quote declines (4 conditions), quote
happy path + attestation config reflection, settle declines (2
conditions), settle happy path (actualAmount = paidAgainst), settle
failure modes (4: throw / non-2xx / no-receipt / over-charge),
dispose semantics + error class export, plus balance pre-flight
(PR #105 — 9 tests covering: default unconfigured behavior,
sufficient/exact/insufficient balance, x402Fetch never called on
insufficient, fail-OPEN on RPC throw, fail-OPEN doesn't swallow
downstream HTTP errors, zero-balance throws, signer-mismatch
short-circuits before pre-flight, malformed maxAmount surfaces
as typed error).

## What this package DOES NOT do

- Host a facilitator. It's a **client** that talks to a facilitator
  via x402Fetch. Production deployments run the facilitator
  separately (using `verifyPayment` + `broadcastVerifiedPayment`
  from `@aethelred/wallet-x402`).
- Implement non-payment intent kinds. Swap intents need a different
  solver backed by DEX liquidity (Uniswap / CoW / 1inch). Transfer
  intents need a solver that submits a direct on-chain transfer.
  Both are separate packages.
- Handle retries. If `x402Fetch` throws on the first attempt, the
  solver throws — the intent-router's `settlement-failed` path is
  the recovery vector. Retries at the solver level would hide
  signal from the router's observability.

## Composition with the rest of the stack

- **Custody adapters** provide the `TypedDataSigner` — LocalKey for
  dev, Nitro for production.
- **Intent-router** hosts the solver in its `SolverRegistry`.
- **Reputation bridge** (via `ReputationPaymentGate`) evaluates VC
  gates before the router calls this solver.
- **AgentBudget** (via `AgentBudgetGate`) enforces on-chain spend
  caps before the router calls this solver.
- **Paymaster-sponsor** signs the gas-cover approval separately;
  this solver doesn't interact with it.
- **Notarization** picks up the audit trail downstream.

The fact that this solver composes cleanly with all of the above
without any bespoke integration is the proof that the moat's
composability story holds past the framework.
