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

### 3. `runEndToEndDemo()` — the proof-of-moat executable (compliance DEPTH)

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

### 4. `runSolverTrioDemo()` — the proof-of-dispatch executable (composition BREADTH)

Sibling artifact to `runEndToEndDemo`. Where the moat demo shows
compliance DEPTH (one intent, every gate), the solver-trio demo
shows composition BREADTH — THREE solvers, THREE reputation gates,
THREE commitment rules, all through one router:

```
┌──────────────────────────── IntentRouter ───────────────────────────────┐
│                                                                         │
│   ┌──────────── composed paymentGate ────────────┐                       │
│   │ ReputationTransferGate  (config policy)      │                       │
│   │ ReputationSwapGate      (config policy)      │                       │
│   │ ReputationPaymentGate   (intent.extra.vcGate)│                       │
│   └──────────────────────────────────────────────┘                       │
│                           │                                             │
│   ┌──────── InMemorySolverRegistry ─────────┐                            │
│   │ TransferSolver                          │                            │
│   │ SwapSolver + StubSwapVenue              │                            │
│   │ X402FacilitatorSolver                   │                            │
│   └─────────────────────────────────────────┘                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
             │                     │                    │
             ▼                     ▼                    ▼
   transfer intent         swap intent          payment intent
   (===  commitment)       (>=  commitment)     (<=  commitment)
```

One `router.execute()` call per intent. For each: the router
invokes the composed `paymentGate` (kind-dispatched to the right
reputation gate), then the registry picks the right solver by kind.
Every intent goes through both a gate evaluation AND a commitment-
rule check. Zero bespoke glue.

The matrix from `runSolverTrioDemo()`:

| kind | solver id | rule | commitment | actual | held? | gate |
|------|-----------|------|------------|--------|-------|------|
| transfer | `transfer:base-mainnet` | `=== commitment` | `1000000` | `1000000` | ✓ | ✓ allowed |
| swap | `swap:stub:base-mainnet` | `>= commitment` | `268650000000000` | `270000000000000` | ✓ | ✓ allowed |
| payment | `x402-facilitator:base-mainnet` | `<= commitment` | `1000000` | `950000` | ✓ | ✓ allowed |

The operator policy applied to all three gates (shown in the CLI
header):

```
combinator: all
directive:  require-registered-agent
directive:  require-not-revoked
```

### Per-solver gas telemetry + histogram

The commitment-rule matrix includes a `gas` column, the demo prints
a dedicated "Per-solver gas telemetry" section for the first run,
and `--samples N` runs each intent kind N times to populate a
`SolverGasHistogram` with meaningful percentile spread:

```bash
npm run demo:solvers -- --samples 10
# Per-solver gas histogram (across 10 samples × 3 kinds = 30 fills)
#   solver id              | count | min  | p50 | p95 | p99 | max | mean
#   transfer:base-mainnet  | 10    | 54k  | 60k | 66k | 66k | 66k | 60k
#   swap:stub:base-mainnet | 10    | 162k | 180k| 198k| 198k| 198k| 180k
```

The first-run section is the per-intent breakdown:

```
Per-solver gas telemetry
  transfer   60k
  swap       180k   (180k)
  payment    facilitator pays gas — not attributed to agent
            ────────────────────────────────────────
  total      240k   (120000000000 wei, on-chain only)
```

- **transfer**: single ERC-20 tx, gas lifted from the receipt.
- **swap**: aggregate across multi-tx sequences (approve → swap);
  per-tx breakdown shown in parentheses.
- **payment**: x402 facilitator pays gas — not attributed to the
  agent. The solver metadata deliberately omits `gasUsed` for
  this kind.

The totals line is the foundation for per-solver histograms an
observability pipeline would aggregate across thousands of fills.

## Quick start — moat demo CLI (compliance depth)

Fastest way to see the moat: one command, coloured timeline, ~50ms
wall-clock.

```bash
npm run demo            # coloured ASCII timeline
npm run demo:json       # structured JSON output (for deck generators, CI)
npm run demo:quiet      # exit-code-only (CI smoke test)
```

## Quick start — solver-trio CLI (composition breadth)

**Allow path** — agent is ERC-8004-registered, all three gates allow, all three solvers settle:

```bash
npm run demo:solvers          # commitment-rule matrix + gate column + audit events
npm run demo:solvers:json     # structured JSON for CI
npm run demo:solvers:quiet    # exit-code-only
```

**Deny path** — agent is NOT registered, all three gates reject, every intent
surfaces `payment-gated` outcome. Inverted success: exit 0 iff all three denied as expected.

```bash
npm run demo:solvers:deny         # same matrix, denied rows + router outcomes
npm run demo:solvers:deny:json    # JSON with mode: "deny"
npm run demo:solvers:deny:quiet   # exit-code-only CI guard on rejection path
```

**Prometheus path** — bridge the live `SolverGasHistogram` into an `InMemoryMeter`
and dump scrape format. Combine with `--samples N` for non-trivial percentile spread.

```bash
npm run demo:solvers:prom -- --samples 10   # text/plain Prometheus output
# # HELP solver_gas_p95 p95 gas used per solver across the window
# # TYPE solver_gas_p95 gauge
# solver_gas_p95{solver_id="transfer:base-mainnet"} 66000
# solver_gas_p95{solver_id="swap:stub:base-mainnet"} 198000
# ...
```

This is what an SRE sees scraping the wallet's `/metrics` endpoint
in production.

The deny variant is the narrative counterpoint: where allow-mode answers
"does the composition succeed?", deny-mode answers "does the compliance
spine reject cleanly?" Both are scripted into CI.

Deny-mode CLI output:

```
╔═════════════════════════════════════════════════════════╗
║  Aethelred solver trio — proof of dispatch (DENY MODE)  ║
╚═════════════════════════════════════════════════════════╝

Completed in 38ms  ·  agent NOT registered  ·  3 gates evaluated  ·  6 audit events

Operator policy (applied to all three gates)
  combinator: all
  directive:  require-registered-agent
  directive:  require-not-revoked

Commitment-rule matrix (with gate evaluations)
  transfer  Send 1 USDC to merchant        …  === commitment  —  —  n/a  ✗ denied: require-not-revoked
  swap      Swap 1 USDC for WETH           …  >= commitment   —  —  n/a  ✗ denied: require-not-revoked
  payment   Pay 1 USDC (x402 facilitator)  …  <= commitment   —  —  n/a  ✗ denied: require-not-revoked

Router outcomes
  transfer   payment-gated
  swap       payment-gated
  payment    payment-gated

Intent-router audit events
  intent-submitted   × 3
  payment-gated      × 3

✓ three gates rejected three intents — denial path verified
```

Audit events drop from 15 → 6 (the router short-circuits at the gate;
no quote/settle events fire). That's itself a visible correctness signal.

Example output:

```
╔═════════════════════════════════════════════════╗
║  Aethelred agent-native moat — end-to-end demo  ║
╚═════════════════════════════════════════════════╝

Completed in 47ms  ·  11 packages exercised  ·  11 audit stages

Timeline
────────────────────────────────────────────────────────────────────────
  merchant       setting up merchant identity
  merchant       profile signed  merchantId=demo-merchant  address=0x19e7…
  merchant       invoice signed + published  slug=C9N3D3T1S8  amount=1000000
  payer          resolved /pay/:slug  activeGate=present
  agent          custody + identity provisioned  (Nitro-attested)
  agent          budget granted  perCallCap=10000000  dailyCap=100000000
  agent          intent signed
  router         intent outcome: fulfilled
  sponsor        paymaster approval signed  usdcCost=2
  audit          batch prepared  eventCount=9
  notarization   batch anchored on-chain  batchId=0  blockNumber=1000

Key outputs
────────────────────────────────────────────────────────────────────────
  Invoice        C9N3D3T1S8  (1000000 units of 0x8335…2913)
  Agent          0x1563…5508  (Nitro-attested)
  Intent         outcome=fulfilled
  Sponsored USDC 2  (paymaster 0xeeee…eeee)
  Merkle root    0x482a4e4…0dc5292b  anchored in block 1000
  Anchor tx      0xabababa…abab0000

✓ moat stack verified end-to-end
```

## Quick start — programmatic

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
npx vitest run solver-trio-demo
```

**14 integration tests** covering: `AgentBudgetGate` pass-through +
session-not-found + cap-exceeded + happy path; `BudgetSponsorPolicy`
denial + allow; `ReputationSponsorPolicy` unregistered denial +
gate-denied + happy path; `runEndToEndDemo` complete success +
paymaster data layout + anchored Merkle root + audit trail ordering
+ intent-router audit-event sequence.

**33 solver-trio tests** covering:

- **Allow path (14):** completes without throwing; returns 3 results in
  `[transfer, swap, payment]` order; every intent fulfilled; every
  commitment rule holds; each rule checked explicitly (=== / >= / <=);
  dispatch correctness (each kind routed to the expected solver id);
  15 audit events fire (5 stages × 3 intents) with expected type
  distribution; every fill has a settlementRef; every intent has a
  captured gate evaluation (universal spine — not payment-only);
  operator policy surfaces on the result; payment gate evaluates the
  intent-body-carried policy; commitment values stable across runs
  under pinned clock.
- **Gas telemetry (4):** transfer fill carries `gasUsed` + `gasCostWei`
  lifted from receipt; swap fill carries aggregate gas + `perTxGasUsed`;
  payment fill omits gas fields (x402 facilitator pays separately);
  deny mode has no fills → no gas telemetry (observability pipelines
  skip denied intents naturally).
- **Histogram (samples > 1, 6):** default `samples=1` yields single-
  sample stats; `samples=10` produces meaningful percentile spread
  (p50 < p95 < p99); 30 fills emit 150 audit events; x402 correctly
  EXCLUDED from the histogram (no on-chain gas attributed); deny
  mode produces an empty histogram; invalid `samples` (0, negative,
  fractional) clamped to 1.
- **Deny path (7):** `denyModeExpected` set correctly; every intent
  hits `payment-gated` (no fills); every gate denies with
  `require-not-revoked` (the synthesised-revoked placeholder
  semantics match the existing `evaluatePayment` convention); audit
  events drop from 15 → 6 (2 stages × 3 intents: submit + gated);
  `commitmentRuleHeld` is false for denied intents (no fill ≠ bug);
  solver dispatch still records the expected `solverId` for
  operator diagnostics (who WOULD have served the intent);
  omitting the flag defaults to allow-mode.

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
