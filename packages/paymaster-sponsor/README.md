# `@aethelred/wallet-paymaster-sponsor`

USDC gas sponsorship for ERC-4337 UserOperations.

Agents pay gas in USDC; the sponsor service prices the ETH gas,
evaluates policy (rate-limits, blocklists, VC gates), and signs a
`VerifyingPaymaster`-compatible approval. The paymaster contract
settles both sides **atomically** at UserOp execution time — the
sponsor service **never custodies user funds.**

## Why this package exists

Agents don't want to hold ETH. They want to hold USDC and spend it.
Every path in the agent-native stack (x402 receipts, intent router
settlements, smart-account transactions) bottoms out in an
ERC-4337 UserOp — which needs ETH for gas.

MoltPe solves this by custodying your USDC and deducting at will.
That's the wrong shape:

- It puts funds in their control.
- Policy decisions live inside their stack.
- Operators can't self-host.

Our sponsor holds **nothing.** The agent pre-authorises USDC (via
EIP-3009 / Permit), we price the gas, sign an approval, and the
paymaster contract atomically pulls USDC + pays ETH gas at UserOp
execution time. Self-hostable by anyone: merchant, agent operator,
neutral third party, or all three in parallel.

## Quick start

```ts
import {
  FixedPriceOracle,
  GasPricer,
  InMemorySettlementLedger,
  PaymasterSigner,
  SponsorService,
  CompositeSponsorPolicy,
  RateLimitPolicy,
  MaxPerRequestPolicy,
} from "@aethelred/wallet-paymaster-sponsor";
import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";

const sponsorKey = new LocalKeyAdapter({ privateKey: process.env.SPONSOR_PK! });

const service = new SponsorService({
  oracle: new FixedPriceOracle({
    chainId: 8453,
    stable: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    nativePerStable: 2500,  // 1 USDC ~ 1/2500 ETH
  }),
  stable: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  pricer: new GasPricer({ markupBps: 500 }),   // 5% operator margin
  policy: new CompositeSponsorPolicy([
    new RateLimitPolicy({ maxUsdcPerWindow: 10_000_000_000n }), // $10k/day
    new MaxPerRequestPolicy(1_000_000_000n),                    // $1k max/tx
  ]),
  ledger: new InMemorySettlementLedger(),
  paymasterSigner: new PaymasterSigner({
    paymasterAddress: PAYMASTER_ADDRESS,
    signer: sponsorKey.asTypedDataSigner(),
  }),
  supportedChainIds: [8453],
});

// Per sponsorship request:
const approval = await service.sponsor({
  userOp,                                 // from the wallet
  chainId: 8453,
  entryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  agentId: agentControlAddress,
  expectedUserOpHash: clientComputedHash,
  validUntil: Math.floor(Date.now() / 1000) + 600,
});

// The caller splats approval.paymasterData into the UserOp and submits.
// When the bundler lands the tx on-chain, the reconciliation worker
// calls service.reconcile(approval.requestId, txHash).
```

## Pipeline

```
sponsor(request)
   │
   ├─ validate request shape + re-compute userOp hash
   ├─ oracle.fetchQuote(chainId, stable)
   ├─ assertQuoteFresh(quote, maxAgeMs)
   ├─ pricer.price(userOp, quote) → usdcCost
   ├─ policy.evaluate({ request, quote, usdcCost, ledgerState, now })
   ├─ ledger.record({ requestId, status: "approved", ... })
   ├─ paymasterSigner.sign({ userOpHash, validUntil, validAfter, ... })
   └─ return SponsorshipApproval with paymasterData
```

Every failure mode throws `PaymasterSponsorError` with a stable
`code` the HTTP / JSON-RPC layer maps to status:

| Code category         | Example                |
| --------------------- | ---------------------- |
| Request validation    | `userop-hash-mismatch`, `chain-id-unsupported`, `request-malformed` |
| Pricing               | `price-unavailable`, `price-too-stale`, `gas-overflow` |
| Policy                | `policy-denied`, `rate-limit-exceeded`, `agent-blocked`, `kill-switch-engaged` |
| Settlement            | `request-id-reused`, `settlement-not-found`, `settlement-double-reconcile` |
| Signing               | `paymaster-signer-error`, `paymaster-address-mismatch` |

## Built-in policies

Compose via `CompositeSponsorPolicy` (first-denial short-circuits,
attaches `deniedBy: <policy.id>` to the result):

- `KillSwitchPolicy` — global off-switch. Ops flips this to halt all
  sponsorship without a redeploy.
- `AgentBlocklistPolicy` — hard-block a set of agent ids.
- `RateLimitPolicy({ maxUsdcPerWindow, windowMs })` — per-agent
  rolling window ceiling.
- `MaxPerRequestPolicy(maxUsdc)` — single-request cap; protects
  against oracle bugs.
- `CustomPredicatePolicy(id, predicate, reasonBuilder)` — escape hatch.

Write your own by implementing `SponsorPolicy` — the composite
accepts any.

## Price oracles

- `FixedPriceOracle` — for tests + local dev.
- `CachingPriceOracle` — wraps any inner oracle with a TTL so every
  request doesn't hit the RPC.

Production: implement `PriceOracle` against Chainlink, Pyth, an
in-house feed. The package is dep-free — bring your own RPC
library.

## The signing scheme

`PaymasterSigner` produces an EIP-712 signature on the
`PaymasterApproval` struct:

```
AethelredPaymasterApproval v1 @ chain.id @ paymasterAddress

Approval(
  bytes32 userOpHash,
  uint256 validUntil,
  uint256 validAfter
)
```

and assembles the 129-byte `paymasterData` layout:

```
paymaster (20) || verifGas (16) || postOpGas (16)
   || validUntil (6) || validAfter (6) || signature (65)
```

Works with any `TypedDataSigner` — including Nitro-enclave-sealed
custody adapters. That's the moat: regulated operators prove (via
TEE attestation) that their sponsor service is running approved
code, with the signing key never leaving the enclave.

## Settlement ledger

`SponsorshipRecord` fields:

```
requestId, userOpHash, agentId, chainId, usdcCost,
paymaster, priceQuoteId,
status: "approved" | "settled" | "expired" | "rejected",
approvedAt, settledAt?, settlementTxHash?, rejectedReason?
```

State machine:

- `approved` — signed, awaiting on-chain settlement.
- `settled` — reconciler observed the tx, called `markSettled`.
- `expired` — `validUntil` elapsed with no settlement.
- `rejected` — policy denial surfaced before record.

`markSettled` / `markExpired` are idempotent on terminal states
(markSettled rejects a double-reconcile; markExpired silently
no-ops).

## What this package DOES NOT do

- Ship an HTTP server. `SponsorService.sponsor()` is a pure async
  function. Wire it into your RPC / REST layer.
- Submit the UserOp. That's the bundler's job; we only sign the
  paymaster approval.
- Observe on-chain settlement events. A reconciliation worker
  watches the paymaster contract's `Spent` events and calls
  `service.reconcile(requestId, txHash)`.
- Persist durably. `InMemorySettlementLedger` is for tests + small
  deployments. Implement `SettlementLedger` against Postgres /
  DynamoDB / a KV store.

## Integration with the rest of the stack

- **x402**: any x402 flow that produces a UserOp (intent-router
  settlement, agent-budget spend) can ask the sponsor to cover gas.
- **Reputation + VC gates**: write a `CustomPredicatePolicy` that
  calls the reputation package's `evaluatePayment` — gate
  sponsorship on agent KYC + reputation in one line.
- **AgentBudget**: a sponsor-side `CustomPredicatePolicy` can call
  `budgetClient.canSpend(sessionKey, usdcCost)` before signing so
  the agent can't exceed their on-chain budget even through
  sponsorship.
- **MCP server / tools**: `policy-denied` with a human-readable
  reason flows up the stack verbatim — tools show the user "your
  sponsorship quota is 85% consumed."

## Testing

```bash
npx vitest run paymaster-sponsor
```

37 tests covering: FixedPriceOracle + CachingPriceOracle hit/miss/
clear semantics, GasPricer summation math + markup + stableDecimals
conversion + overflow sanity, InMemorySettlementLedger record +
transition + double-reconcile rejection + listByAgent filtering,
every built-in policy pass/fail path, CompositeSponsorPolicy
short-circuit + deniedBy attribution, PaymasterSigner sign +
decode round-trip + validAfter-validation, SponsorService happy path
+ every failure mode (hash-mismatch, chain-unsupported,
past-deadline, policy-denied, replay-detection, unsupported chain)
+ reconcile / expire lifecycle.
