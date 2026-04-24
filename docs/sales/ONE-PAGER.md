# Aethelred Wallet — Agent-native payments with a cryptographic trust root

> **For enterprise procurement, regulated fintech, and agent-native platforms evaluating AI-wallet vendors.**

---

## The problem

AI agents are moving money. The existing wallet-as-a-service market
(Privy, Dynamic, MoltPe, Magic, Turnkey) puts the platform itself in
the trust root: when a regulator asks "prove this agent was
authorized to spend," the answer is "trust our database."

For regulated buyers — fintech, payments, enterprise ops teams —
that trust root is a non-starter. They need cryptographic proof, not
procedural assurance.

## The Aethelred answer

Eleven composable packages that push the trust root **out of the
operator** and into Ethereum consensus + TEE attestation.

**The operator can disappear, pivot, or get acquired — the guarantees
stand.**

## What's verifiable without trusting us

| Claim | How a regulator verifies |
|-------|--------------------------|
| "This agent's signing code was the vetted code." | TEE attestation quote binds to payment struct hash — verified against silicon root CA. |
| "This payment was authorized under spend caps." | On-chain `AgentBudget.canSpend` reads match the `Spent` event. |
| "This merchant is who they claim to be." | Merchant-signed EIP-712 profile verifies independently. |
| "This invoice was issued at this time." | Merchant signature + Merkle-anchored audit event. |
| "This audit event existed at time T, unaltered." | Merkle inclusion proof against a mainnet-anchored root. |
| "This agent satisfies our acceptance policy." | VC gate evaluates deterministically; audit trail records every signal. |

Compare: MoltPe's answer to each row is "check our logs." Ours is
"check the chain."

## Feature comparison

| Dimension | MoltPe / Privy / Dynamic | Aethelred |
|-----------|--------------------------|-----------|
| Custody | Managed + 2-of-2 Shamir | Local + Shamir + Ledger + **Nitro TEE** + Fireblocks |
| TEE attestation per payment | ❌ | ✅ Quote binds to struct hash |
| Agent spend caps | Off-chain policy | On-chain contract; atomic revocation |
| Session key revocation race | Possible | Eliminated (contract reads on every spend) |
| VC-gated merchants | ❌ | Serialized gate in x402 `extra` |
| Merchant identity | Platform-issued | Self-sovereign EIP-712 profiles |
| Intent routing | ❌ | EIP-712 intents + solver marketplace |
| USDC gas (paymaster) | Platform-deducts | Sponsor never custodies funds |
| Audit trail | Platform DB | Merkle-anchored to mainnet every 15 min |
| Sovereign export formats | Custom per regulator | SAR / CTR / GDPR / MiCA templates shipped |
| Trust root | Platform ops + DB | Ethereum consensus + TEE attestation |

## What we ship

- **11 composable TypeScript packages** — 1196/1196 tests passing.
- **End-to-end demo CLI** — watch every layer run in ~50ms:
  ```bash
  git clone <repo> && cd wallet && npm install && npm run demo
  ```
- **Architecture doc** — 5-minute exec read at `ARCHITECTURE.md`.
- **Per-package READMEs** — 10+ minute deep dives for engineers.
- **Reference Solidity contracts** — `AgentBudget.sol`, `Notary.sol`
  at deterministic CREATE2 addresses (deployment imminent).

## Security posture

- TypeScript strict mode, zero `any` in the moat set.
- `@noble/secp256k1` + `@noble/hashes` — audited, zero-dep crypto.
- No viem / ethers / web3 hard deps — minimal transitive-dep surface.
- External security review: **scoped, awaiting engagement** (Trail
  of Bits / Zellic / Spearbit on the candidate list).
- SOC-2 Type 2 **in progress**.

## Integration surface

All 11 packages are chain-agnostic. Customers plug their preferred
RPC library (viem / ethers / custom) behind small provider interfaces.
Works with:

- Any EVM chain (Base, Arbitrum, Ethereum mainnet, Polygon).
- Any custody provider (Ledger, Fireblocks, Nitro, Intel TDX, GCP
  Confidential Space).
- Any KYC issuer (merchants pin their own trusted-issuer set).
- Any bundler (ERC-4337 v0.6 + v0.7).
- Any audit store (Postgres, DynamoDB, chain-indexed).

Drop-in replaces specific layers — use our TEE-signed x402 with
existing MoltPe custody, or use our invoice layer with a different
sponsor. No lock-in beyond the interface contracts.

## Commercial model

**Open-source core + enterprise deployment.** The packages are
independently licensable; customers take only the layers they need.
Commercial engagements cover:

- Deployment + hosting of the on-chain contracts (Notary, AgentBudget,
  VerifyingPaymaster) at deterministic addresses per chain.
- SLA-backed sponsor service operation.
- Compliance integration (pinning your trusted-issuer set, wiring
  your SAR / CTR / MiCA export templates).
- Custom TEE enclave deployment (parent image build + attestation
  chain management).
- On-site security + integration engineering.

## Pilot path

Typical 90-day pilot:

**Weeks 1–2: Scoping.** Identify one agent flow with a cryptographic-
proof requirement (fraud liability, regulator attestation, per-session
audit). Map Aethelred layers to the flow.

**Weeks 3–6: Integration.** Wire the chosen packages. Customer's
engineering team owns integration; we provide reference
implementations + pair-programming support.

**Weeks 7–10: Mainnet + enclave.** Deploy contracts. Provision
Nitro parent image. Run the CLI demo against the live deployment.
Pilot traffic at volume-matched shadow load.

**Weeks 11–12: Review + production decision.** External security
audit of the integration. SOC-2 evidence collection. Go/no-go.

## Next actions

- **Engineer**: `npm run demo` after cloning. Read `packages/integration/README.md`.
- **Procurement**: read `ARCHITECTURE.md` (5 min). Request access to the SOC-2 data room.
- **Regulator**: the Merkle-anchored audit trail is the verifiable substrate. Inclusion proofs + on-chain batch lookups are the evidence format.
- **Investor / partner**: introductions via `rameshtamilselvan@gmail.com`.

---

*Aethelred Foundation. Source: [github.com/aethelred-foundation/wallet](https://github.com/aethelred-foundation/wallet).*
