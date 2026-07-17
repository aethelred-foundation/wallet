# Wallet Production Readiness

Status: **public-testnet candidate only; not yet approved for a public production release or browser-store submission**.

The completed controls below describe the current candidate artifact and its regression coverage. They do not mean the wallet is “100% complete,” independently security-approved, or accepted by any browser store.

This document is the release contract for turning the wallet into a dependable Aethelred product. A feature is production-ready only when every user-visible action is backed by an authoritative system, tested against failure paths, and produces no synthetic balance, quote, transaction hash, approval, credential, or success state. Features that do not meet that bar must be absent from production builds.

## Release principles

1. A success screen is shown only after the authoritative operation has succeeded.
2. Every signing or permission change requires an explicit, attributable user decision.
3. Amounts are handled as exact integers at chain precision; floating-point arithmetic is never used to construct transactions.
4. Keys and passkey grants fail closed when state is missing, corrupt, expired, or unverifiable.
5. Every visible control either completes its advertised action or is removed from the production build.
6. Development fixtures may exist only behind development-only reachability and must have regression tests proving they are absent in production.
7. A public release requires signed artifacts, reproducible release inputs, a security review, and end-to-end tests against the public testnet.

## Completed in the production-readiness tranche

- Vault creation and import validate BIP-39 input, prevent destructive overwrite, roll back failed initialization, and propagate storage failures.
- Key caches are zeroized and auto-lock activity is limited to real wallet interaction.
- WebAuthn enrollment and authentication use server-issued one-time challenges, validate origin and RP data, verify ES256 signatures, enforce user verification, and persist a fail-closed passkey-required policy.
- Passkey removal advances a durable per-wallet revocation generation and invalidates outstanding enrollment, authentication, and unlock grants; unlock grants are bound to the exact credential that issued them.
- Native transfers and ERC-20 transfers share one exact transaction-construction path. ERC-20 sends encode `transfer(address,uint256)`, target the token contract, and send zero native value.
- Transaction approvals are bound to the originating session, account, permission, and chain epoch, then revalidated immediately before signing and broadcast so revoke, reconnect, and network-switch races fail closed.
- dApp send requests freeze one validated EIP-1559 gas tuple before review and use those exact values for fee display, signing, and tracking; detached `eth_signTransaction` is explicitly unsupported so it cannot bypass the reviewed send pipeline.
- Popup sends pass the selected live gas tier into preparation and render only the background-returned draft tuple; editing, cancelling, or leaving review invalidates the draft and releases its pre-broadcast resources.
- Transaction approval cards consume background-authored spending facts instead of display summaries. ERC-20 review separates the recipient, exact token amount and base units, token contract, zero native value, immutable gas tuple, and maximum native fee; approval fails closed if those authoritative fields are absent.
- Approval resolution is successful only when the background explicitly returns `ok: true`. An expired, missing, or already-resolved approval returns a non-success result, remains visible with an error, and never triggers success feedback or navigation.
- Twenty-four-hour spend limits use persistent atomic reservations, and pre-broadcast nonce allocation can safely reuse released nonces without duplicating an in-flight nonce.
- Locking advances a custody epoch that invalidates in-flight key, storage, signing, and cache operations, including operations that were already awaiting asynchronous work.
- Connected-site revocation removes the persisted session, records the event, broadcasts state, and emits `accountsChanged([])` to the affected origin.
- Native Aethelred intents derive identity from the browser-authenticated origin, require explicit connection and message-signing approval, revalidate the exact session before signing, and reject unimplemented intent kinds instead of reporting false success.
- Connected pages can read only their approved accounts, active chain, and lock state; subjects, workspaces, other sessions, pending approvals, and transaction history remain extension-internal.
- Provider events and polling subscriptions are delivered only to the exact active session and browser origin; account payloads are intersected with that session's grants, and transaction activity is never globally broadcast.
- Pending approval summaries are intentionally rejected and cleared when the service worker is suspended or restarted; dead in-memory resolvers are never rehydrated as functional approvals.
- Fixture-only and unwired production routes are removed or gated, including Swap, WalletConnect, Token Approvals, Regulatory Passport, ID Verification, Digital Assets, Rewards, Machine Delegation, and Developer Tools.
- Unreleased credential bridge methods return an explicit unsupported-method error, and placeholder issuer/private-key presentation runtimes are rejected by the production bundle gate.
- Reserved tenant-migration bridge methods return the explicit EIP-1193 unsupported-method code `4200`; they cannot return an empty tenant list, `null` plan, or placeholder receipt, and the placeholder deployment manager is rejected by the production bundle gate.
- Production-visible no-op controls for notification, explorer, account removal, transaction speed-up, app launch, seeded market tabs, and preview-only DeFi actions are hidden.
- Fiat pricing fails closed when an authoritative feed is unavailable; synthetic token prices, TVL, APY, catalog, governance, and market metrics are not allowed in the production artifact.
- Payments uses live balances, the canonical send flow, and persisted contacts; synthetic settlement queues, batch schedules, compliance statuses, and volume analytics were removed.
- Saved-recipient CRUD is validated and serialized by the background as the sole persistence writer, preventing unrelated wallet-state saves from overwriting contact changes.
- The current send pipeline accepts only 20-byte `0x` EVM recipients. Native `aethel1…` recipients are rejected before review until a separately reviewed native-chain transaction pipeline exists.
- Activity maps the real transaction-manager schema defensively: native sends and contract calls are identified only from available value/calldata, while incomplete legacy records show neutral “Transaction” and “Amount unavailable” labels instead of crashing or inventing an asset/type.
- Clipboard-backed controls await the browser write before showing copied success. Rejected or unavailable clipboard writes preserve a failure state and do not emit success feedback; About exposes an explicit copy error.
- Audit status is supplied by the background after full stored-chain hash/link verification and lifecycle rehydration. A record count alone never produces a verified claim, and rehydration or integrity failures are shown explicitly.
- About reads the installed runtime manifest for version provenance. Build date, commit, release channel, and active deployment profile display as unavailable unless the runtime provides authoritative values; fabricated package counts and “What’s New” claims were removed.
- The extension packaging command fails if unreleased feature chunks, synthetic catalog/governance/market data, placeholder biometrics, or known no-op/stub markers reach the production artifact.

## Remaining release blockers

### P0 — custody and signing

- Decide whether resumable approval drafts are a release requirement and, if so, implement them as explicit unsigned drafts; the current candidate deliberately rejects and clears pending approvals on suspension or restart.
- Add deterministic service-worker suspension handling and evaluate an offscreen key keeper for the intended unlock duration.
- Complete encrypted persistence and migration tests for accounts, custom networks, and custom tokens.
- Validate fee estimation, replacement, cancellation, receipt tracking, nonce conflicts, and chain switching against the public testnet.
- Run an independent security review covering vault storage, message origin validation, WebAuthn, signing, and supply-chain integrity.

### P0 — connection compatibility

- Validate EIP-1193 and EIP-6963 behavior across Cruzible, ZeroID, Shiora, NoblePay, and TerraQura.
- Implement WalletConnect v2 with a maintained SDK, encrypted session persistence, expiry, namespace validation, chain/account updates, and disconnect propagation. Keep the feature absent until complete.
- Add automated connect, request, reject, revoke, lock, network-change, and account-change tests for every supported dApp.

### P0 — transaction safety

- Add public-testnet end-to-end coverage for native and ERC-20 sends, including insufficient funds, fee changes, reverts, dropped transactions, and replacement transactions.
- Add transaction simulation and human-readable calldata warnings before signing unknown contract calls.
- Replace the gated swap surface with live quotes, allowance handling, slippage bounds, calldata verification, submission, and receipt tracking before enabling it.
- Replace the gated approvals surface with a real indexed allowance source and verified revoke transactions before enabling it.

### P1 — identity, institutional, and ecosystem features

- Integrate real issuers, verification, revocation, encrypted persistence, and consent receipts for ZeroID and regulatory credentials.
- Connect rewards, digital assets, machine delegation, and protocol actions to authoritative services before exposing their routes.
- Complete Ledger and other intended hardware-wallet paths in packaged builds; document unsupported devices explicitly.
- Complete Android and iOS applications before claiming cross-platform parity.

### P1 — release engineering and product quality

- Produce signed Chrome/Chromium and Firefox artifacts, SBOMs, provenance, upgrade tests, and rollback instructions.
- Pass accessibility review at WCAG 2.2 AA, including keyboard-only use and screen-reader signing flows.
- Complete English and Arabic localization, including bidirectional layout and security wording review.
- Establish RPC failover, telemetry that excludes sensitive data, incident alerts, and public-testnet availability objectives.

## Public-testnet acceptance matrix

| Area | Minimum acceptance evidence |
| --- | --- |
| Onboarding | Create, import, invalid mnemonic, duplicate initialization, storage failure, recovery drill |
| Locking | Password unlock, passkey unlock, one-time challenge replay rejection, auto-lock, restart, corrupt state |
| Connections | Each dApp connect/reject/revoke/reconnect, origin isolation, account/chain change, locked wallet |
| Signing | Personal sign, typed data, transaction review, rejection, malicious/unknown calldata warning |
| Approval review | ERC-20 recipient/amount/base units/contract/native value/gas agreement, missing facts fail closed, stale response cannot show success |
| Transfers | Native and ERC-20 success, insufficient funds, fee change, revert, dropped/replaced transaction, `aethel1…` rejected by the EVM-only path |
| Activity and audit | Real transaction-manager records render safely; audit verified/failure/unavailable states match the background result |
| Product truthfulness | Runtime manifest version only, unavailable provenance labeled honestly, clipboard rejection never shows copied success |
| Permissions | Least-privilege account exposure, expiry, revocation, audit event, origin-targeted disconnect |
| Release | Production fixture scan, complete tests, packaged-artifact smoke test, signed artifact, security approval |

## Positioning

The defensible goal is **the best wallet for Aethelred**, with safer signing, private simulation, unified wallet/data permissions, reliable dApp interoperability, and first-class institutional controls. “Better than MetaMask” becomes supportable only after the parity and release blockers above are closed with measured evidence; it is not a release status by itself.
