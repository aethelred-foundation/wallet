# Aethelred Wallet — Build Status Report

**Prepared:** 2026-06-24 · **For:** external advisory review · **Version:** `0.9.0-beta.1`
**Repository:** `aethelred-foundation/wallet` (private)

> **Purpose of this document.** A complete, honest snapshot of what the Aethelred
> Wallet is today — what is genuinely built and working, what is scaffolded, and
> what remains before it can ship. Written so an external consultant can form an
> independent opinion on how to move forward. Where something is *not* done, this
> report says so plainly.

---

## 1. Executive summary

The Aethelred Wallet is a **compliance-native, policy-driven Web3 wallet** aimed at
regulated enterprises, sovereign entities, and individual users. Over ~2 months
(first commit 2026-04-19) it has grown into a substantial, well-tested monorepo:
a production-grade Chrome extension, 32 TypeScript domain packages, an
"agent-native" feature set for AI/automated signers, iOS/Android scaffolding, an
optional Elixir control-plane, and reference smart contracts.

**Maturity: late-stage beta / pre-audit.** The engineering quality is high
(1,826 automated tests passing, strict TypeScript, deterministic builds, written
threat model and audit-scoping docs). However, the wallet is **not production-ready**
by its own definition, and three hard gates remain open:

1. **No external security/cryptography audit** has been performed.
2. **Smart contracts are not deployed** to any chain (reference-only).
3. **SOC-2 Type 1 is not complete.**

The README states the gating condition directly: *"Extension ships to Chrome Web
Store once SOC-2 Type 1 and Trail of Bits audit complete."*

This is the *right* posture for a wallet — the gaps are tracked, not hidden — but a
consultant should treat the headline as: **strong, broad engineering substrate;
the remaining work is assurance (audit, compliance, on-chain deployment) and
productization, not core feature build-out.**

---

## 2. What the product is

A wallet that treats **compliance and policy as first-class primitives**, not
bolt-ons, plus a differentiated bet on **AI-agent custody**.

- **Tiered custody** — Personal, Enterprise, and Sovereign modes with data
  continuity across tiers.
- **Composable compliance primitives** — KYC, travel rule, transaction screening,
  case management, filing tracker, and a jurisdiction engine, all as typed
  TypeScript modules.
- **Tamper-evident audit chain** — SHA-256 hash-linked event log with exportable
  evidence packages for SOC-2 / ISO 27001 / SOX §404.
- **Workflow / approvals engine** — five quorum types (any-one, majority,
  unanimous, threshold, sequential) with timeout escalation.
- **WebAuthn 2FA** — passkey enrollment with counter-regression clone detection.
- **Hardware wallets** — Ledger via WebHID (real). Trezor is *not* implemented.
- **Machine identity & delegation** — first-class custody model for AI agents and
  automated systems (the strategic differentiator; see §6).
- **Regulatory Passport** — portable compliance identity targeting VASP / MiCA /
  VARA / MAS jurisdictions.

---

## 3. Codebase at a glance

All figures are first-party source (vendored libraries, build output, and
`node_modules` excluded), measured 2026-06-24.

| Area | Scope | Size |
|---|---|---|
| TypeScript (logic) | 424 files | ~115,900 lines |
| React/TSX (UI) | 113 files | ~29,600 lines |
| iOS (Swift) | 147 files | ~15,000 lines |
| Android (Kotlin) | 161 files | ~14,200 lines |
| Elixir (control-plane) | 27 apps, 117 modules | ~9,300 lines |
| Solidity (first-party) | 2 contracts | 682 lines |
| **Domain packages** | `packages/*` | **32** |
| **Automated tests** | extension (vitest) | **1,826 passing / 111 files** |
| Commits / contributors | since 2026-04-19 | 153 / 2 |

**Surfaces delivered:**

| Surface | State |
|---|---|
| Chrome MV3 extension (Vite + React 18) | **Primary product — functional**, 267 source files |
| Mobile (Expo) | **WebView preview shell only** (2 files); native iOS/Android are scaffolds |
| iOS (native, Swift) | Scaffolded (147 files), not a shipping app |
| Android (native, Kotlin) | Scaffolded (161 files), not a shipping app |
| Elixir/Phoenix control-plane | Optional companion (27 umbrella apps) |
| Smart contracts | 2 reference contracts, **undeployed** |

---

## 4. Architecture

The wallet is a **layered TypeScript monorepo**. The extension composes ~32
single-responsibility packages; tests import package internals directly while the
app lazy-loads views as separate chunks.

**Core wallet layer**
`core` (key management, signing, EIP-712, RLP, custody) · `chain` (RPC, balances,
state) · `connect` (EIP-1193 provider/bridge) · `smart-account` (ERC-4337 v0.6 +
v0.7) · `simulation` (tx simulation, ABI decode) · `rpc-adapters`.

**Compliance & governance layer**
`compliance` (KYC, travel rule, screening, case mgmt, filings) · `policy` (engine,
templates, velocity) · `approval` (quorum workflow engine) · `audit`
(tamper-evident hash-chain + export) · `credentials` / `identity` (Regulatory
Passport, EAS attestations, VCs) · `deployment` (tenant profiles).

**Agent-native moat layer** (the differentiator — see §6)
`x402` · `custody-adapters` · `reputation` · `intent-router` · `agent-budget` ·
`invoice` · `paymaster-sponsor` · `sovereign-export` · `notarization` ·
`mcp-server` · `integration`.

**Execution / routing**
`swap-solver`, `transfer-solver`, `x402-solver`, `swap-venue-uniswap-v3`
(+ Redis cache variant), `intent-router`, `observability`.

**Tech stack:** TypeScript 5.9 strict · React 18.3 / Vite · `@noble/*` audited
crypto primitives · Ledger WebHID · Vitest + Testing Library · deterministic
extension builds for supply-chain verification.

---

## 5. Feature inventory (with honest status)

Legend: ✅ built & tested · 🟡 partial / preview-grade · 🟦 scaffolded · ❌ not started

| Capability | Status | Notes |
|---|---|---|
| Key management, signing, EIP-712 | ✅ | Built on audited `@noble` primitives |
| ERC-4337 smart accounts (v0.6 + v0.7) | ✅ | In `smart-account` |
| Multi-chain (EVM + BTC + Solana adapters) | ✅ | `chain`, `chain-btc`, `chain-solana` |
| Transaction simulation + ABI decode | ✅ | `simulation` |
| Compliance suite (KYC/travel rule/screening/cases) | ✅ | Typed modules; demo/fixture data in preview |
| Policy + approvals (5 quorum types) | ✅ | `policy`, `approval` |
| Tamper-evident audit chain + export | ✅ | SHA-256 hash-linked; SAR/CTR/GDPR/MiCA templates |
| WebAuthn / passkey 2FA | ✅ | Clone-detection via counter regression |
| Ledger hardware wallet (WebHID) | ✅ | Real integration |
| Trezor hardware wallet | ❌ | Explicitly throws "not implemented" (refuses to ship a stub) |
| Regulatory Passport (portable KYC) | 🟡 | Renders; fixture-backed in preview |
| Agent-native moat (x402, intent-router, budgets, etc.) | ✅ (code) / 🟡 (live) | Code complete + tested; on-chain pieces undeployed |
| On-chain spend caps / Merkle anchoring | 🟡 | Contracts written + forge-tested, **not deployed to any chain** |
| Native mobile (iOS/Android) | 🟦 | Q3 roadmap; today a WebView shell |
| MCP server (LLM tool surface) | ✅ | Policy-gated tool dispatch |

---

## 6. The strategic differentiator — "agent-native moat"

The most distinctive bet is treating **AI agents and automated systems as
first-class wallet principals**. Eleven packages form a coherent set:

- **`x402`** — HTTP-402 payments where a TEE attestation binds to each payment's
  struct hash.
- **`custody-adapters`** — one signer contract across Local / Shamir 2-of-2 /
  Ledger / AWS Nitro / Fireblocks.
- **`intent-router`** — EIP-712 typed intents + a solver marketplace.
- **`agent-budget`** — on-chain per-agent spend caps with atomic revocation +
  session keys.
- **`reputation`** — ERC-8004 + deterministic scoring + verifiable-credential gates.
- **`invoice` / `paymaster-sponsor`** — self-sovereign invoices and USDC-for-gas
  sponsorship (sponsor never custodies funds).
- **`sovereign-export` / `notarization`** — regulatory exports + Merkle roots
  intended to anchor to mainnet.
- **`mcp-server`** — policy-gated tool dispatch for LLMs.

**Consultant note:** this is genuine, tested code and a credible thesis (agentic
commerce + compliance). Its on-chain guarantees (atomic budget revocation,
mainnet anchoring) are **not yet live** because the contracts are undeployed and
unaudited. The differentiation is real at the design/IP level; the *trust* claims
depend on the assurance work in §8.

---

## 7. Engineering quality

Genuinely strong, and worth weighting positively:

- **1,826 automated tests passing** (111 files, Vitest) — verified on 2026-06-24.
- **Strict TypeScript** (`noUnusedLocals`, `noUnusedParameters`).
- **Deterministic production builds** for supply-chain verification (auditors can
  reproduce byte-identical ZIPs).
- **Honest engineering discipline** — the codebase *refuses to ship stubs*
  (e.g., the hardware-wallet module throws rather than fake a Trezor connection;
  it explicitly replaced an earlier stub that returned zeroed public keys).
- **Documentation depth** — written threat model (STRIDE), security model, audit
  scoping package, SOC-2 scope + control mapping, testing strategy, runbooks.
- **CI signals** present in repo (CI, Forge, CodeQL, license scan, OpenSSF
  Scorecard, SLSA L2 badges).

---

## 8. Security & compliance posture — the gating work

This is where the remaining risk concentrates. For a product that custodies keys
and funds, these are the items a consultant should focus on.

| Gate | Status | Detail |
|---|---|---|
| **External security/crypto audit** | ❌ Not done | `AUDIT_SCOPE.md` is a *draft ready for firm outreach*; target engagement Q3 2026; indicative budget **$80k–$250k**. Hand-rolled EIP-712 encoders, Shamir 2-of-2, and TEE attestation-binding have **never had external cryptographic review**. |
| **Smart-contract deployment** | ❌ Not done | `deployments.json` shows every chain (`base/ethereum/arbitrum/polygon`) **empty** — only predicted CREATE2 addresses exist. On-chain spend caps + mainnet anchoring are not live anywhere. |
| **SOC-2 Type 1** | ❌ Not complete | Scope + control-mapping docs exist; attestation does not. The audit report (above) is a prerequisite evidence artifact. |
| **Dependency vulnerabilities** | ⚠️ Open | GitHub Dependabot reports **32 vulnerabilities on the default branch — 1 critical, 17 high, 10 moderate, 4 low**. Several remediation PRs are open but unmerged. |
| **Trezor / native mobile** | 🟦 Marketed-ahead | README lists features that are scaffolded; worth aligning marketing with shipped reality. |
| **Licensing** | ❌ Undecided | License is `UNLICENSED` / TBD; must be resolved before any public/source release. |

**Documents available to share with auditors/buyers** (already written): threat
model, security model, audit-scoping package, SOC-2 scope + moat control mapping,
observability scope, supply-chain + commit-signing policies, sales one-pager and
competitor matrix (vs MoltPe / Privy / Dynamic / Turnkey).

---

## 9. Recent work (this session, 2026-06-23 → 24)

Stabilization of the preview build + UI fixes, shipped on branch
`fix/popup-i18n-and-header` (PR **#184**):

1. **i18n bug fixed** — locale catalogs were registered without a namespace, so
   every `t()` call rendered the raw key (e.g. `nav.home`) across all views. One
   fix resolved every view at once.
2. **Header "LIVE" indicator removed** per request.
3. **Lazy chunk-load retry** added — a transient network fetch failure of a view
   chunk no longer renders the page as an error (matters for the WebView/LAN
   preview).
4. **Preview cache-busting** — non-production builds now emit content-hashed
   filenames (production/CWS builds stay deterministic); added a reproducible
   `build:preview` script.

All 1,826 tests pass; a full 17-view audit across Chromium and WebKit shows no
runtime errors and no leaked i18n keys.

---

## 10. Open decisions for the consultant

Where outside opinion would be most valuable:

1. **Audit sequencing & budget** — engage a firm (Trail of Bits / Spearbit /
   Zellic) now vs. after more productization? The $80k–250k spend is the single
   biggest gate to credibility.
2. **On-chain deployment strategy** — which chain(s) first for AgentBudget +
   Notary; testnet pilot before mainnet; who funds/operates the anchoring.
3. **Mobile strategy** — invest in native iOS/Android now, or ship the extension
   + Web4 preview and defer native to post-revenue?
4. **Go-to-market** — lead with the *compliance* story or the *agent-native*
   story? They target different buyers (regulated enterprises vs. agentic-commerce
   builders).
5. **Dependency & licensing hygiene** — clear the 32 Dependabot findings and
   settle the license before any external code exposure.
6. **Positioning vs. incumbents** — independent read on the moat vs. MoltPe /
   Privy / Dynamic / Turnkey.

---

## 11. Bottom line

A **technically credible, broad, well-tested wallet platform** with a
differentiated agent-native thesis — roughly "feature-complete beta, assurance-
incomplete." The path to production is now dominated by **assurance and
deployment** (third-party audit, contract deployment, SOC-2, dependency
remediation) and **productization** (native mobile, store submission, licensing),
rather than core engineering. The honesty of the codebase (no shipped stubs,
written threat models, undeployed contracts clearly marked "reference-only") is a
positive signal for diligence.

---

*Figures verified against the repository on 2026-06-24. Status claims cross-checked
against `README.md`, `docs/security/AUDIT_SCOPE.md`, `contracts/deployments.json`,
and a live test run.*
