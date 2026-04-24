# Aethelred Wallet

[![CI](https://img.shields.io/github/actions/workflow/status/aethelred/wallet/ci.yml?branch=main&label=CI&logo=github)](https://github.com/aethelred/wallet/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/aethelred/wallet/codeql.yml?branch=main&label=CodeQL&logo=github)](https://github.com/aethelred/wallet/actions/workflows/codeql.yml)
[![License scan](https://img.shields.io/github/actions/workflow/status/aethelred/wallet/license-scan.yml?branch=main&label=license%20scan&logo=github)](https://github.com/aethelred/wallet/actions/workflows/license-scan.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/aethelred/wallet/badge)](https://securityscorecards.dev/viewer/?uri=github.com/aethelred/wallet)
[![SLSA Level 2](https://slsa.dev/images/gh-badge-level2.svg)](https://slsa.dev/spec/v1.0/levels#build-l2)
[![Tests](https://img.shields.io/badge/tests-1196%20passing-brightgreen?logo=vitest)](#quick-start)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](./tsconfig.base.json)
[![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)](#licensing)

A compliance-native, policy-driven Web3 wallet for regulated enterprise clients, sovereign entities, and individual users. The wallet combines:

- **Tiered custody** — Personal, Enterprise, and Sovereign modes with data continuity across tiers
- **Composable compliance primitives** — KYC, travel rule, transaction screening, case management, filing tracker, and jurisdiction engine as typed TypeScript modules
- **Tamper-evident audit chain** — SHA-256 hash-linked event log with exportable evidence packages for SOC-2 / ISO 27001 / SOX §404 attestation
- **Workflow engine** — five quorum types (any-one, majority, unanimous, threshold, sequential) with timeout-based escalation
- **WebAuthn 2FA** — passkey enrollment with §6.1.1 counter-regression clone detection
- **Hardware wallet integration** — Ledger via WebHID; Trezor scaffolded
- **Machine identity & delegation** — first-class custody model for AI agents and automated systems
- **Regulatory Passport** — portable compliance identity for VASP / MiCA / VARA / MAS jurisdictions
- **Agent-native moat** — TEE-attested signing, pluggable custody, intent router, on-chain spend caps, self-sovereign invoices, paymaster sponsorship, and mainnet-anchored audit. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

### Agent-native moat (packages #51–#61)

Eleven packages shipped as a coherent set. One runnable CLI threads
all of them in ~50ms:

```bash
npm run demo          # coloured ASCII timeline in your terminal
npm run demo:json     # structured JSON output
npm run demo:quiet    # exit-code-only (CI smoke test)

cd apps/extension && npx vitest run integration    # full 14-test assertion
```

| Layer | Package | Core guarantee |
|-------|---------|----------------|
| Cornerstone | [`x402`](packages/x402) | TEE quote binds to every payment's struct hash |
| Custody | [`custody-adapters`](packages/custody-adapters) | One signer contract — Local / Shamir / Ledger / Nitro / Fireblocks |
| Identity | [`reputation`](packages/reputation) | ERC-8004 + deterministic scoring + VC gates |
| Routing | [`intent-router`](packages/intent-router) | EIP-712 typed intents + solver marketplace |
| Economics | [`agent-budget`](packages/agent-budget) | On-chain spend caps — revocation is atomic |
| Commerce | [`invoice`](packages/invoice) | Self-sovereign merchant invoices + `/pay/:slug` |
| Gas | [`paymaster-sponsor`](packages/paymaster-sponsor) | USDC-for-gas — sponsor never custodies funds |
| Compliance | [`sovereign-export`](packages/sovereign-export) | SAR / CTR / GDPR / MiCA templates |
| Audit | [`notarization`](packages/notarization) | Merkle roots anchored to mainnet every 15 min |
| LLM surface | [`mcp-server`](packages/mcp-server) | Policy-gated tool dispatch |
| Composition | [`integration`](packages/integration) | End-to-end demo + load-bearing adapters |

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the structural comparison vs MoltPe, the composition diagram, and the phased production rollout.

## Status

Active development. Extension ships to Chrome Web Store once SOC-2 Type 1 and Trail of Bits audit complete. Mobile app currently ships as an Expo-backed WebView shell for cross-platform preview; native iOS/Android implementation on the Q3 roadmap.

## Workspace layout

```
wallet/
├── apps/
│   ├── extension/      Chrome MV3 extension (Vite + React 18)
│   └── mobile/         Expo React Native shell (WebView preview)
├── packages/
│   ├── approval/             Workflow engine, quorum, approval templates
│   ├── audit/                Tamper-evident event capture + export
│   ├── chain/                RPC client, balance fetcher, state persistence
│   ├── compliance/           KYC, travel rule, screening, case mgmt, filings
│   ├── connect/              EIP-1193 provider, bridge types, request validator
│   ├── core/                 Key management, signing, EIP-712, RLP, custody
│   ├── credentials/          Regulatory Passport — EAS attestations + VCs
│   ├── deployment/           Tenant deployment profiles
│   ├── identity/             Subjects, workspaces, credentials, validators
│   ├── policy/               Policy engine, templates, velocity tracker
│   ├── simulation/           Transaction simulation, ABI decoder, analyzer
│   ├── smart-account/        ERC-4337 v0.6 + v0.7
│   │
│   │   # Agent-native moat (packages #51–#61)
│   ├── x402/                 HTTP 402 + TEE attestation binding
│   ├── mcp-server/           Policy-gated MCP tool dispatch
│   ├── custody-adapters/     Local / Shamir / Ledger / Nitro / Fireblocks
│   ├── reputation/           ERC-8004 + reputation + VC gate evaluator
│   ├── intent-router/        EIP-712 intents + solver marketplace
│   ├── agent-budget/         On-chain spend caps + session keys
│   ├── invoice/              Self-sovereign invoices + /pay/:slug
│   ├── paymaster-sponsor/    USDC gas sponsorship service
│   ├── sovereign-export/     SAR / CTR / GDPR / MiCA exports
│   ├── notarization/         Merkle roots anchored to mainnet
│   └── integration/          End-to-end moat demo
└── elixir/                   Phoenix/Elixir control-plane companion (optional)
```

## Quick start

```bash
npm install
npm run dev:extension        # Vite dev server on :3301
npm run build:extension      # Production build to apps/extension/dist
npm run type-check           # Full workspace typecheck
cd apps/extension && npx vitest run    # 1196 unit + integration tests
npm run package:extension    # Deterministic Chrome Web Store ZIP
```

For mobile preview via Expo Go:

```bash
cd apps/mobile
npx expo start --tunnel
```

Then scan the QR with Expo Go on iOS/Android. The mobile shell wraps the extension popup in a WebView.

## Architecture

Start here:

- **[`ARCHITECTURE.md`](ARCHITECTURE.md)** — 5-minute exec read. The moat
  thesis, composition diagram, MoltPe comparison, and production rollout.
- **[`packages/integration/README.md`](packages/integration/README.md)** —
  the composition story + the end-to-end demo.

For regulated buyers + auditors + security firms:

- [`docs/sales/ONE-PAGER.md`](docs/sales/ONE-PAGER.md) — data-room one-pager for procurement.
- [`docs/sales/COMPARISON-MATRIX.md`](docs/sales/COMPARISON-MATRIX.md) — competitive matrix vs MoltPe / Privy / Dynamic / Turnkey.
- [`docs/compliance/SOC2_SCOPE.md`](docs/compliance/SOC2_SCOPE.md) + [`SOC2_MOAT_CONTROL_MAPPING.md`](docs/compliance/SOC2_MOAT_CONTROL_MAPPING.md) — auditor engagement package.
- [`docs/security/THREAT_MODEL.md`](docs/security/THREAT_MODEL.md) + [`AUDIT_SCOPE.md`](docs/security/AUDIT_SCOPE.md) — security-firm quoting package.

Deep dives (engineering RFCs, phased plans, decision memos):

- `AETHELRED_WALLET_ARCHITECTURE_RFC_2026-04-10.md` — high-level architecture
- `AETHELRED_WALLET_PRD_2026-04-10.md` — product requirements
- `AETHELRED_WALLET_DECISION_MEMO_2026-04-10.md` — key decisions
- `AETHELRED_WALLET_MASTER_INDEX_2026-04-11.md` — documentation map
- `AETHELRED_WALLET_PHASE0_EPICS_2026-04-10.md` through `PHASE3_*` — phased delivery plan

## Tech stack

| Area | Tooling |
|------|---------|
| Language | TypeScript 5.9 strict mode (`noUnusedLocals`, `noUnusedParameters`) |
| Frontend | React 18.3, Vite 8, Chrome MV3 service worker |
| Mobile | React Native 0.81, Expo SDK 54 |
| Crypto | `@noble/secp256k1`, `@noble/hashes` (audited, zero-dep) |
| Hardware wallets | `@ledgerhq/hw-transport-webhid`, `@ledgerhq/hw-app-eth` |
| Testing | Vitest + `@testing-library/react` (jsdom) |
| Build output | `popup.js` 459 KB / gzip 114 KB · `background.js` 181 KB / gzip 62 KB |

## Licensing

TBD. Source currently private; license decision tied to public launch plan.

## Ownership

Ramesh Tamilselvan — `rameshtamilselvan@gmail.com`

---

Made with love from the Aethelred Foundation.
