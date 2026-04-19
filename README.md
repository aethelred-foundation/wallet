# Aethelred Wallet

A compliance-native, policy-driven Web3 wallet for regulated enterprise clients, sovereign entities, and individual users. The wallet combines:

- **Tiered custody** — Personal, Enterprise, and Sovereign modes with data continuity across tiers
- **Composable compliance primitives** — KYC, travel rule, transaction screening, case management, filing tracker, and jurisdiction engine as typed TypeScript modules
- **Tamper-evident audit chain** — SHA-256 hash-linked event log with exportable evidence packages for SOC-2 / ISO 27001 / SOX §404 attestation
- **Workflow engine** — five quorum types (any-one, majority, unanimous, threshold, sequential) with timeout-based escalation
- **WebAuthn 2FA** — passkey enrollment with §6.1.1 counter-regression clone detection
- **Hardware wallet integration** — Ledger via WebHID; Trezor scaffolded
- **Machine identity & delegation** — first-class custody model for AI agents and automated systems
- **Regulatory Passport** — portable compliance identity for VASP / MiCA / VARA / MAS jurisdictions

## Status

Active development. Extension ships to Chrome Web Store once SOC-2 Type 1 and Trail of Bits audit complete. Mobile app currently ships as an Expo-backed WebView shell for cross-platform preview; native iOS/Android implementation on the Q3 roadmap.

## Workspace layout

```
wallet/
├── apps/
│   ├── extension/      Chrome MV3 extension (Vite + React 18)
│   └── mobile/         Expo React Native shell (WebView preview)
├── packages/
│   ├── approval/       Workflow engine, quorum, approval templates
│   ├── audit/          Tamper-evident event capture + export
│   ├── chain/          RPC client, balance fetcher, state persistence
│   ├── compliance/     KYC, travel rule, screening, case mgmt, filings
│   ├── connect/        EIP-1193 provider, bridge types, request validator
│   ├── core/           Key management, signing, EIP-712, RLP, custody
│   ├── deployment/     Tenant deployment profiles
│   ├── identity/       Subjects, workspaces, credentials, validators
│   ├── policy/         Policy engine, templates, velocity tracker
│   └── simulation/     Transaction simulation, ABI decoder, analyzer
└── elixir/             Phoenix/Elixir control-plane companion (optional)
```

## Quick start

```bash
npm install
npm run dev:extension        # Vite dev server on :3301
npm run build:extension      # Production build to apps/extension/dist
npm run type-check           # Full workspace typecheck
cd apps/extension && npx vitest run    # 83 unit + integration tests
```

For mobile preview via Expo Go:

```bash
cd apps/mobile
npx expo start --tunnel
```

Then scan the QR with Expo Go on iOS/Android. The mobile shell wraps the extension popup in a WebView.

## Architecture

See the design documents at the repo root:

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
