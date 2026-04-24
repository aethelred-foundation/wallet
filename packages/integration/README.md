# `@aethelred/wallet-integration`

**The composition layer that threads the Aethelred moat stack into one
executable story.**

This is the package that turns 10 atomic primitives (x402, custody
adapters, reputation, intent router, AgentBudget, invoice, paymaster-
sponsor, sovereign export, notarization, MCP server) into a single
flow an enterprise procurement officer can watch run in under one
second.

## What ships

### 1. Composition adapters — the load-bearing glue

Three small adapters that let every package consume every other
package without bespoke integration code:

- **`AgentBudgetGate`** — exposes the on-chain
  `AgentBudget.canSpend` predicate as an intent-router `PaymentGate`.
  The intent router now asks "can this agent afford this payment
  under its own on-chain budget?" in the same preflight that
  checks the merchant's VC gate.
- **`ReputationSponsorPolicy`** — wraps a `VcGate` and evaluates
  it against the requesting agent's reputation. The paymaster
  denies gas sponsorship to agents that fail the receiver's (or
  the sponsor's own) VC policy.
- **`BudgetSponsorPolicy`** — runs `BudgetClient.canSpend` for the
  sponsor-computed USDC amount. Prevents an agent from using
  paymaster sponsorship as a side-channel around its own on-chain
  spending cap.

### 2. Demo fixtures — production-shape simulators

In-memory stand-ins that behave byte-identically to their real
counterparts so the demo runs in `vitest`:

- **`SimulatedEnclave`** — in-process Nitro enclave with a real
  secp256k1 key + mock TEE attestation bundle.
- **`SimulatedAnchorChain`** — the Notary contract + its RPC
  provider, emits real `BatchAnchored` events the `OnChainAnchorAdapter`
  parses.
- **`SimulatedBudgetClient`** — accepts `grant` / `recordSpend` /
  `canSpend`, enforces per-call + daily caps.
- **`SimulatedFireblocksClient`** — Fireblocks-shaped stub for
  deployments that swap custody.

Each is a drop-in replacement for a real implementation. Swap the
simulator for the viem/ethers-backed version when you're ready to
run against mainnet.

### 3. `runEndToEndDemo()` — the proof-of-moat executable

One function. Threads every moat layer. Returns a structured
`EndToEndDemoResult` that tests assert against.

```
merchant signs profile + invoice (EIP-712)
        │
        ▼
agent resolves /pay/:slug → PaymentRequirement with VC gate
        │
        ▼
agent (Nitro-sealed custody) signs payment intent
        │
        ▼
intent router evaluates composed gate:
    VC gate (reputation)  +  AgentBudget.canSpend
        │
        ▼
solver quotes + settles (x402-shaped)
        │
        ▼
paymaster-sponsor evaluates composed policy:
    RateLimit + BudgetSponsorPolicy + ReputationSponsorPolicy
        │
        ▼
sponsor signs VerifyingPaymaster approval
        │
        ▼
audit captures every stage → MerkleBatch
        │
        ▼
notarization anchors root to simulated Notary contract
        │
        ▼
DemoResult: merchant, invoice, intent, execution,
            approval, anchored receipt, audit trail,
            intent-router events
```

## Quick start

```ts
import { runEndToEndDemo } from "@aethelred/wallet-integration";

const result = await runEndToEndDemo();

console.log("Intent outcome:", result.intentExecution.outcome.kind);
console.log("Sponsored USDC:", result.sponsorshipApproval.usdcCost.toString());
console.log("Anchored batch:", result.anchoredReceipt.record.batchId.toString());
console.log("Audit stages:", result.auditTrail.map((s) => s.stage).join(" → "));
```

Expected output (condensed):

```
Intent outcome: fulfilled
Sponsored USDC: 91
Anchored batch: 0
Audit stages: merchant → merchant → payer → agent → agent → router → sponsor → audit → notarization
```

## Why this package matters (exec view)

- **Shortens the moat pitch from 10 packages to one demo.** Before
  this package, demonstrating the moat required explaining 10
  independent systems. Now: one command, one story.
- **Proves composability isn't theoretical.** The fact that three
  tiny adapters (~150 LOC each) glue every package together
  validates the "one shape, many implementations" thesis.
- **Unlocks the enterprise demo.** A Fortune 500 procurement officer
  wants to watch a payment land with TEE attestation, VC gating,
  rate limits, sponsored gas, and on-chain audit anchoring — all
  happening in real time. This is that demo.

## Testing

```bash
npx vitest run integration
```

14 tests covering: `AgentBudgetGate` pass-through + session-not-found
+ cap-exceeded + happy path; `BudgetSponsorPolicy` denial + allow;
`ReputationSponsorPolicy` unregistered denial + gate-denied +
happy path; `runEndToEndDemo` complete success + paymaster data
layout + anchored Merkle root + audit trail ordering + intent-
router audit-event sequence.

## What this package DOES NOT do

- Ship concrete solvers (Uniswap v3 / CoW) — the demo uses a
  minimal x402-shaped stub. Real solvers are separate follow-ups.
- Ship a viem / ethers adapter — the simulator classes are the
  substrate. Production consumers swap them for RPC-backed
  implementations with matching shape.
- Handle long-running cadence — the demo runs one notarization
  tick explicitly. Production stands up a `NotarizationScheduler`
  with `SystemClock` and lets it run in the background.

## Next steps (when the demo becomes the sales artifact)

1. **Visual trace UI**: render the `auditTrail` + `intentAuditEvents`
   as a live timeline during the demo.
2. **Real chain + real Nitro**: swap `SimulatedEnclave` for a
   `NitroEnclaveAdapter` pointed at a sealed parent image; swap
   `SimulatedAnchorChain` for a viem adapter pointed at Base mainnet.
3. **Deploy the Solidity contracts**: `AgentBudget.sol` +
   `Notary.sol` + a `VerifyingPaymaster.sol` to deterministic
   addresses, pin those into the demo config.
4. **Security review**: commission an external review (Trail of
   Bits / Zellic / Spearbit) — the demo is the best artifact to
   scope it against.
