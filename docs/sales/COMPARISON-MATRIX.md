# Aethelred vs. agent-wallet competitors — structural comparison

> **For competitive analysis decks. Each row is a guarantee customers
> can cryptographically verify, not a feature operators claim.**

## Custody

| Capability | MoltPe | Privy | Dynamic | Turnkey | **Aethelred** |
|------------|--------|-------|---------|---------|---------------|
| Local key (dev) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Shamir 2-of-2 MPC | ✅ | ❌ | ❌ | ✅ | ✅ |
| Ledger HSM bridge | ❌ | ✅ | ✅ | ✅ | ✅ |
| **Nitro enclave (TEE)** | ❌ | ❌ | ❌ | ❌ | ✅ |
| Fireblocks passthrough | ❌ | ❌ | ❌ | ❌ | ✅ stub |
| **TEE quote per payment** | ❌ | ❌ | ❌ | ❌ | ✅ |

## Agent economics

| Capability | MoltPe | Privy | Dynamic | Turnkey | **Aethelred** |
|------------|--------|-------|---------|---------|---------------|
| Off-chain spend limit | ✅ | ✅ | ❌ | ✅ | ✅ |
| **On-chain spend cap** | ❌ | ❌ | ❌ | ❌ | ✅ |
| Scoped session keys | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Atomic session revocation** | ❌ | ❌ | ❌ | ❌ | ✅ |
| Per-call + daily cap | off-chain | off-chain | ❌ | off-chain | **on-chain** |
| USDC gas sponsorship | custodial | ❌ | ❌ | custodial | **non-custodial** |

## Trust + policy

| Capability | MoltPe | Privy | Dynamic | Turnkey | **Aethelred** |
|------------|--------|-------|---------|---------|---------------|
| ERC-8004 agent identity | ❌ | ❌ | ❌ | ❌ | ✅ pluggable |
| Deterministic reputation scoring | ❌ | ❌ | ❌ | ❌ | ✅ |
| VC-gated receivers | ❌ | ❌ | ❌ | ❌ | ✅ |
| Self-sovereign merchant profiles | ❌ | ❌ | ❌ | ❌ | ✅ EIP-712 |
| Intent router | ❌ | ❌ | ❌ | ❌ | ✅ EIP-712 |
| x402 HTTP 402 protocol | ❌ | ❌ | ❌ | ❌ | ✅ |
| **x402 + TEE attestation binding** | ❌ | ❌ | ❌ | ❌ | ✅ cornerstone |

## Audit + compliance

| Capability | MoltPe | Privy | Dynamic | Turnkey | **Aethelred** |
|------------|--------|-------|---------|---------|---------------|
| Tamper-evident audit log | platform DB | platform DB | platform DB | platform DB | **Merkle-anchored** |
| Merkle root on mainnet | ❌ | ❌ | ❌ | ❌ | **every 15 min** |
| Inclusion proofs for regulators | ❌ | ❌ | ❌ | ❌ | ✅ |
| SAR / CTR export | ❌ | ❌ | ❌ | ❌ | ✅ templates |
| GDPR DSAR export | ❌ | ❌ | ❌ | ❌ | ✅ templates |
| MiCA transaction receipt | ❌ | ❌ | ❌ | ❌ | ✅ templates |
| Signed export envelopes | ❌ | ❌ | ❌ | ❌ | ✅ EIP-712 |

## Platform surface

| Capability | MoltPe | Privy | Dynamic | Turnkey | **Aethelred** |
|------------|--------|-------|---------|---------|---------------|
| Chrome extension | ❌ | ✅ | ✅ | ❌ | ✅ |
| Policy-gated MCP server | ❌ | ❌ | ❌ | ❌ | ✅ |
| Invoice `/pay/:slug` surface | ❌ | ❌ | ❌ | ❌ | ✅ pure function |
| Composable packages | ❌ | monolith | monolith | monolith | ✅ 11 packages |
| Zero viem/ethers hard dep | ❌ | ❌ | ❌ | ❌ | ✅ |

## Where we're weaker (honest)

| Capability | MoltPe | Privy | Dynamic | Turnkey | **Aethelred** |
|------------|--------|-------|---------|---------|---------------|
| Contracts deployed to mainnet | ✅ | ✅ | ✅ | ✅ | **reference-only** (deploying) |
| External security audit complete | ✅ | ✅ | ✅ | ✅ | **commissioning** |
| SOC-2 Type 2 | ✅ | ✅ | ✅ | ✅ | **in progress** |
| Production customer references | ✅ | ✅ | ✅ | ✅ | **pilot-stage** |
| Native iOS / Android | partial | partial | partial | ❌ | Expo shell only |
| Fiat on-ramp | ✅ | ✅ | ✅ | ❌ | ❌ (partner integrations only) |

## Bottom line

**Aethelred delivers every moat capability the existing AI-wallet
market doesn't ship AT ALL.** The trade-off is production maturity —
we're pilot-stage, deploying contracts, commissioning audits — where
the incumbents have been shipping for 18+ months.

The architectural differentiation is structural and immovable. The
production gap closes in 90–120 days. The structural gap never
closes for the incumbents without a full stack rewrite.

## Selling strategy

1. **Lead with the cryptographic verifiability story** to regulated
   buyers (fintech, payments, institutional). The trust-root
   argument wins on its own — the procurement officer's compliance
   partner makes the buy decision.
2. **Lead with composability** to agent-native platforms (AI
   companies building on MCP, solver networks, autonomous operations
   tooling). They take what they need; we don't lock them in.
3. **Lead with the end-to-end demo** for technical audiences. `npm
   run demo` is the pitch. Every layer visible, ~50ms, zero infra.
4. **Acknowledge the gap honestly.** We're pilot-stage. For
   prospects who need "deployed to mainnet, audit complete, 50 logo
   customers" today, the answer is "come back in 120 days." For
   prospects who'd rather architect around the moat now than rebuild
   later, the answer is "we can be live in your environment in 90
   days."
