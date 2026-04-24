# `@aethelred/wallet-reputation`

ERC-8004 agent identity bridge + deterministic reputation aggregator
+ VC-gated receiver policy.

Given a payment request from an autonomous agent, this package:

1. **Resolves** the agent's on-chain identity via an `ERC8004Resolver`.
2. **Aggregates** reputation signals (VCs, payment history, TEE-
   attestation health, revocations, fraud reports) into a single
   deterministic score + tier label.
3. **Evaluates** receiver-declared `VcGateRule`s against the result
   and emits a structured evaluation record.

## Why this package exists

MoltPe's receivers trust MoltPe — they have to, because MoltPe
controls the full stack on the payment side. Regulated merchants
(payment processors, brokerage platforms, compliance-driven SaaS)
need to run their own acceptance policy: "accept payments only from
agents with a valid KYC VC from an approved issuer and a reputation
score above 600." This package gives them a pluggable, auditable way
to express and enforce exactly that — without rebuilding the x402
facilitator.

## Quick start

```ts
import {
  InMemoryERC8004Resolver,
  VcGate,
  requireRegisteredAgent,
  requireNotRevoked,
  requireVcOfSchema,
  requireMinReputation,
  evaluatePayment,
} from "@aethelred/wallet-reputation";
import { SCHEMA_KYC_STATUS } from "@aethelred/wallet-credentials";

// Option A: build the gate in TS and evaluate directly.
const gate = VcGate.all([
  requireRegisteredAgent(),
  requireNotRevoked(),
  requireVcOfSchema(SCHEMA_KYC_STATUS, { issuerRole: "kyc-provider" }),
  requireMinReputation(600),
]);

// Option B: embed the gate in an x402 PaymentRequirement and let the
// bridge parse + evaluate. This is the flow x402 facilitators use.
const requirement = {
  /* ...standard x402 fields... */
  extra: {
    vcGate: {
      combinator: "all",
      directives: [
        { type: "require-registered-agent" },
        { type: "require-not-revoked" },
        {
          type: "require-vc",
          schemaId: SCHEMA_KYC_STATUS,
          issuerRole: "kyc-provider",
        },
        { type: "require-min-reputation", minScore: 600 },
      ],
    },
  },
};

const result = await evaluatePayment({
  requirement,
  agentControlAddress: "0x...", // from the signed authorization
  resolver,
  credentialSource,
});

if (!result.allowed) {
  return 402Response({ failedRules: result.evaluation!.failedRuleIds });
}
```

### Generic gate evaluation via `evaluateAgent`

`evaluatePayment` is the x402-shaped convenience wrapper. The
underlying primitive — for any caller that wants to evaluate an
agent against a pre-built gate without going through an x402
requirement — is `evaluateAgent`:

```ts
import {
  evaluateAgent,
  gateFromSerialized,
} from "@aethelred/wallet-reputation";

const gate = gateFromSerialized(operatorPolicy); // VcGate instance
const result = await evaluateAgent({
  gate,
  agentControlAddress: "0x...",
  resolver,
  credentialSource,
});

if (!result.allowed) {
  // result.evaluation.failedRuleIds lists the rules that tripped.
}
```

This is what the intent-router's `ReputationTransferGate` and
`ReputationSwapGate` delegate to; `evaluatePayment` itself is a thin
wrapper that extracts the gate from `requirement.extra.vcGate` and
calls `evaluateAgent` when one is present. One primitive, three call
sites, identical fail-closed semantics for unregistered agents.

## Three layers, three responsibilities

### 1. ERC-8004 resolver

Resolves `agentControlAddress → AgentIdentity`. Ships two
implementations:

- `InMemoryERC8004Resolver` — seed-populated; for tests and dev.
- `CachingERC8004Resolver` — bounded LRU + TTL wrapper around any
  inner resolver. Production callers wrap a viem/ethers-backed
  on-chain resolver with this to keep gate latency low.

The resolver interface is chain-agnostic so the same reputation
engine drives Base, Ethereum, Arbitrum, Polygon, etc. without
branching. When the on-chain ERC-8004 standard finalises, the only
change is swapping `resolver.resolveByControlAddress()` to call the
real contract.

### 2. Reputation aggregator

Deterministic, transparent scoring:

- **Inputs**: `ReputationSignal[]` — VC attestations, payment
  successes, fraud reports, revocations, TEE-drift events.
- **Output**: `ReputationScore` with a `transparency` trace
  enumerating every signal applied, its weight, and the running
  cumulative score.
- **Guarantees**: same inputs → same score; canonical signal
  ordering; floor/ceiling clamping; integer rounding.

Default weights (`DEFAULT_REPUTATION_WEIGHTS`):

| Signal                           | Weight |
| -------------------------------- | -----: |
| Baseline                         |   +500 |
| VASP licence VC                  |   +200 |
| KYC VC                           |   +120 |
| AML / sanctions-clear VC         |    +80 |
| Accredited-investor VC           |    +60 |
| Payment success (per, capped)    |   +2/+100 |
| TEE attestation drift            |   -250 |
| Attestation revocation           |   -150 |
| Fraud report                     |   -300 |

Operators with different economics (growth-weighted, KYC-only, etc.)
override the weights at aggregator construction — no code changes
required.

### 3. VC gate + rule factories

Rules are pure functions; the gate (`VcGate.all` / `VcGate.any`)
manages ordering, short-circuit, and result aggregation.

Built-in factories:

- `requireRegisteredAgent()` — agent exists in ERC-8004.
- `requireNotRevoked()` — agent identity active.
- `requireVcOfSchema(schema, { issuerRole?, issuerIds? })` — VC
  present and valid.
- `requireFreshVc(schema, maxAgeMs)` — VC issued recently.
- `requireMinReputation(minScore)` / `requireMinTier(tier)` —
  reputation threshold.
- `customRule(id, desc, predicate, failureMsg)` — escape hatch for
  receiver-specific policies.

Write your own rules by implementing `VcGateRule` — the gate
accepts any rule regardless of origin.

## Serialised gate format

Receivers embed gates in `PaymentRequirement.extra.vcGate` using the
`SerializedVcGate` shape — a small JSON DSL that the bridge layer
translates into rules:

```json
{
  "combinator": "all",
  "directives": [
    { "type": "require-registered-agent" },
    { "type": "require-not-revoked" },
    {
      "type": "require-vc",
      "schemaId": "aethel/kyc-status/v1",
      "issuerRole": "kyc-provider",
      "issuerIds": ["sumsub-global", "onfido"]
    },
    { "type": "require-min-tier", "minTier": "trusted" },
    {
      "type": "require-fresh-vc",
      "schemaId": "aethel/kyc-status/v1",
      "maxAgeMs": 7776000000
    }
  ]
}
```

## Testing

```bash
npx vitest run reputation-bridge
```

46 tests cover: resolver hit/miss/TTL/LRU/revocation-bypass,
aggregator determinism + caps + clamping + transparency trace, every
built-in gate rule against pass/fail scenarios, combinator short-
circuit semantics, rule-throws-exception handling, duplicate-rule-id
detection, x402 bridge end-to-end (unregistered agent, implicit
accept, VC-boosted reputation, tier-based denial), `evaluateAgent`
primitive (direct allow/deny/VC-signal auto-derivation paths).
