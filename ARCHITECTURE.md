# Aethelred Wallet — Architecture

> **Tier-1 exec read.** Five minutes to understand the moat, one command
> to watch it run.

## The thesis

Agent-native payments need five things that traditional wallets don't
deliver:

1. **Attested execution**: proof that the signing code is the code that
   was vetted — not "trust the platform."
2. **Pluggable custody**: one signing contract across local keys,
   hardware, MPC, and TEE enclaves.
3. **Verifiable policy**: agents declare outcomes; receivers declare
   acceptance rules; both are cryptographically checked before any
   transaction lands.
4. **Economically-scoped delegation**: short-lived session keys with
   on-chain spend caps that survive operator compromise.
5. **Tamper-evident audit**: every action anchored to mainnet so
   regulators verify the trail against Ethereum consensus, not our
   database.

MoltPe (and every wallet-as-a-service competitor) delivers a subset by
putting themselves in the trust root. We deliver the full set by
putting cryptography in the trust root. The operator can disappear,
pivot, or get acquired — the guarantees stand.

## The moat layer — 11 composable packages

Each package is independently versioned, typed, tested, and has zero
runtime dependency on a specific chain library (viem / ethers / web3).
Packages use chain-agnostic `*Provider` / `*Client` interfaces;
production consumers inject their preferred RPC substrate.

| # | Package | What it delivers | Moat material |
|---|---------|------------------|---------------|
| 1 | [`x402`](packages/x402) | HTTP 402 payment protocol + TEE-attestation binding | **Cornerstone** — every payment carries a fresh TEE quote bound to the struct hash |
| 2 | [`custody-adapters`](packages/custody-adapters) | One signer contract, five backends (Local / Shamir / Ledger / Nitro / Fireblocks) | Nitro adapter is the piece MoltPe structurally cannot replicate |
| 3 | [`reputation`](packages/reputation) | ERC-8004 agent identity + deterministic scoring + VC gate evaluator | Receivers pin their own issuer sets, not ours |
| 4 | [`intent-router`](packages/intent-router) | EIP-712 typed intents + solver marketplace | Network-effect layer above the rail |
| 5 | [`agent-budget`](packages/agent-budget) | On-chain rolling-window caps + scoped session keys | Revocation is atomic; pre-signed user-ops can't outrun it |
| 6 | [`invoice`](packages/invoice) | Self-sovereign merchant invoices + `/pay/:slug` surface | Merchants sign their own invoices; no platform in the middle |
| 7 | [`paymaster-sponsor`](packages/paymaster-sponsor) | USDC gas sponsorship for ERC-4337 UserOps | Service never custodies user funds |
| 8 | [`sovereign-export`](packages/sovereign-export) | SAR / CTR / GDPR / MiCA regulator-format exports with signed envelopes | Same API surface for every jurisdiction |
| 9 | [`notarization`](packages/notarization) | Merkle roots anchored to mainnet every 15 min | Audit trail verified against Ethereum consensus |
| 10 | [`mcp-server`](packages/mcp-server) | Policy-gated MCP tool dispatch | LLMs can only run the tools policy permits |
| 11 | [`integration`](packages/integration) | Composition adapters + end-to-end demo | **Proof-of-moat executable** |

## How they compose

```
┌─────────────────────────────────────────────────────────────────┐
│ agent                                                           │
│                                                                 │
│   custody-adapters ── TypedDataSigner ───┐                      │
│   (Nitro-sealed)                         │                      │
│                                          ▼                      │
│                              intent-router ── payment intent    │
│                                  ▲            │                 │
│                                  │            ▼                 │
│                    ┌─────────────┘      solver marketplace      │
│                    │                         │                  │
│ reputation ◄───────┤                         │                  │
│  (VC gate)         │                         │                  │
│                    │                         ▼                  │
│ agent-budget ◄─────┘                  x402 payment auth         │
│  (canSpend)                                  │                  │
│                                              ▼                  │
│                                       paymaster-sponsor         │
│                                       (RateLimit + VC + Budget) │
│                                              │                  │
│                                              ▼                  │
│                                       VerifyingPaymaster        │
│                                              │                  │
│                                              ▼                  │
│                                       on-chain settlement       │
│                                                                 │
│  every stage emits audit events ─┐                              │
│                                  ▼                              │
│                             MerkleBatch                         │
│                                  │                              │
│                                  ▼                              │
│                         every 15 min: notarization              │
│                                  │                              │
│                                  ▼                              │
│                             Notary contract (L1)                │
│                                                                 │
│  sovereign-export packages audit + Merkle proofs into           │
│  regulator-format envelopes on demand                           │
└─────────────────────────────────────────────────────────────────┘
```

**The load-bearing glue** lives in the [`integration`](packages/integration)
package — three small adapters (`AgentBudgetGate`, `ReputationSponsorPolicy`,
`BudgetSponsorPolicy`) bridge every package without mutual dependencies.
That's what makes the composition pattern scale: each package sees its
neighbours through an interface it owns, never through a concrete type.

## Watch it run

```bash
# Option A — runnable CLI (coloured timeline, ~50ms wall-clock):
npm run demo

# Option B — structured JSON for deck generators / CI:
npm run demo:json

# Option C — full 14-test integration assertion:
cd apps/extension && npx vitest run integration
```

The `runEndToEndDemo()` call threads:

1. Merchant signs profile + invoice (EIP-712, Nitro-sealed custody)
2. Agent resolves `/pay/:slug` → PaymentRequirement with VC gate
3. Agent signs payment intent with Nitro-attested session key
4. Intent router evaluates **composed gate**: VC gate + on-chain budget
5. Solver quotes, router picks best, solver settles via x402
6. Paymaster-sponsor evaluates **composed policy**: rate limit + budget + reputation, signs USDC-for-gas approval
7. Audit captures every stage → Merkle batch
8. Notarization anchors the root to the simulated Notary contract
9. Test asserts the full state at every stage

Swap the four simulator classes (`SimulatedEnclave`, `SimulatedAnchorChain`,
`SimulatedBudgetClient`, `SimulatedFireblocksClient`) for viem-backed
implementations and the same demo runs against Base mainnet + a real
Nitro enclave.

## Aethelred vs MoltPe — structural comparison

| Dimension | MoltPe | Aethelred |
|-----------|--------|-----------|
| Custody | Managed + 2-of-2 Shamir | Local + Shamir + Ledger + **Nitro (TEE)** + Fireblocks |
| TEE attestation per payment | ❌ | ✅ TEE quote binds to struct hash |
| Agent spend caps | Off-chain policy | On-chain `AgentBudget` contract |
| Session key revocation | Config update | On-chain atomic — pre-signed ops can't outrun |
| VC-gated merchants | ❌ | Serialized `vcGate` in `PaymentRequirement.extra` |
| Merchant identity | Platform-issued | Self-sovereign EIP-712 profiles |
| Intent routing | ❌ | EIP-712 intents + solver marketplace |
| USDC gas | Platform-deducts | Paymaster-sponsor signs approval; contract settles atomically |
| Audit trail | MoltPe's DB | Merkle-anchored to mainnet every 15 min |
| Sovereign export | Custom per regulator | SAR / CTR / GDPR / MiCA templates with signed envelopes |
| Trust root | MoltPe's ops + DB | Ethereum consensus + TEE attestation |

MoltPe sits in the trust root. We sit outside it. The operator can
disappear; the guarantees stand.

## Current state vs production state

| Component | Current | Production path |
|-----------|---------|-----------------|
| TypeScript packages | ✅ Shipped, 1196/1196 tests | — |
| End-to-end demo | ✅ Runs in-memory | Swap 4 simulators for viem-backed versions |
| `AgentBudget.sol` | ✅ Foundry-compiled, 16 tests pass | Deploy via `script/Deploy.s.sol` + CREATE2 |
| `Notary.sol` | ✅ Foundry-compiled, 7 tests + 256-run fuzz pass | Deploy via `script/Deploy.s.sol` + CREATE2 |
| `VerifyingPaymaster.sol` | Referenced | Deploy existing EF implementation |
| ERC-8004 registry | Pluggable | Deploy when spec finalises |
| Solver implementations | x402 stub in demo | Uniswap v3, CoW, bespoke — separate packages |
| Chainlink / Pyth oracle | `FixedPriceOracle` | Implement `PriceOracle` against chain |
| Ledger transport | Existing `HardwareWalletBackend` | Bridge already shipped (`LedgerHsmAdapter`) |
| Nitro transport | `SimulatedEnclave` | vsock / HTTPS-mTLS adapter against sealed parent |
| RPC layer | ✅ `@aethelred/wallet-rpc-adapters` | Drop-in JSON-RPC impls of every chain provider |
| Security review | ✅ Scoped, ready for firm outreach | See [`docs/security/AUDIT_SCOPE.md`](docs/security/AUDIT_SCOPE.md) |
| SOC-2 Type 1 | ✅ Scope + control mapping complete | See [`SOC2_SCOPE.md`](docs/compliance/SOC2_SCOPE.md) + [`SOC2_MOAT_CONTROL_MAPPING.md`](docs/compliance/SOC2_MOAT_CONTROL_MAPPING.md) |

## Phased rollout

**Phase 1 — now:** demo runs; contracts are reference-only. Use case:
pitch the moat to enterprise buyers, regulators, investors.

**Phase 2 — contracts deployed:** `AgentBudget`, `Notary`, `VerifyingPaymaster`
at deterministic addresses on Base + Arbitrum + Ethereum mainnet.
Simulator → viem adapter swap makes the demo run against live chains.

**Phase 3 — security-reviewed:** external audit of the full stack. SOC-2
Type 2. First regulated enterprise customer in production.

**Phase 4 — network effects:** solver marketplace grows. Sponsor
services proliferate. Merchants migrate from platform-custodied invoice
systems. ERC-8004 finalises; we implement against the real spec.

## Reading order for the full picture

1. This document (5 min)
2. [`packages/integration/README.md`](packages/integration/README.md)
   — the composition story (10 min)
3. Individual package READMEs (pick the layer you care about, 5 min each)
4. `AETHELRED_WALLET_ARCHITECTURE_RFC_2026-04-10.md` — the deeper
   engineering RFC (30 min)
5. Run the demo: `npm run demo` (~50ms wall-clock) or
   `npx vitest run integration` (< 1 second)

For regulated buyers + auditors:

- [`docs/sales/ONE-PAGER.md`](docs/sales/ONE-PAGER.md) — procurement-ready data-room one-pager.
- [`docs/sales/COMPARISON-MATRIX.md`](docs/sales/COMPARISON-MATRIX.md) — vs MoltPe / Privy / Dynamic / Turnkey.
- [`docs/compliance/SOC2_SCOPE.md`](docs/compliance/SOC2_SCOPE.md) + [`SOC2_MOAT_CONTROL_MAPPING.md`](docs/compliance/SOC2_MOAT_CONTROL_MAPPING.md) — auditor package.
- [`docs/security/THREAT_MODEL.md`](docs/security/THREAT_MODEL.md) + [`AUDIT_SCOPE.md`](docs/security/AUDIT_SCOPE.md) — security-firm engagement package.

## Ownership

Ramesh Tamilselvan — `rameshtamilselvan@gmail.com`
