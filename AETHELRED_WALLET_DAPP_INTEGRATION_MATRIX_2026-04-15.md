# Aethelred Wallet dApp Integration Matrix

Date: 2026-04-15
Status: Execution draft
Purpose: define the concrete integration order and integration model between `Aethelred Wallet` and the five flagship dApps using the architecture already present in this repo.

This document does not replace:

- `wallet/AETHELRED_WALLET_PRD_2026-04-10.md`
- `wallet/AETHELRED_WALLET_ARCHITECTURE_RFC_2026-04-10.md`
- `wallet/AETHELRED_WALLET_BUILD_PLAN_2026-04-10.md`
- the app-specific architecture and team plan documents

It turns those documents into one practical answer to:

- which app should integrate with the wallet first
- how each app should connect
- what signing and approval model each app needs
- where session ownership should live

## 1. Executive Decision

Run the wallet as the primary active program.

Use the dApps as integration targets, not as parallel full rewrites.

Recommended wallet integration order:

1. `Cruzible`
2. `TerraQura`
3. `ZeroID`
4. `NoblePay`
5. `Shiora`

This order is specifically for wallet integration.

It is not the same as:

- mobile app launch order
- Elixir workflow platform adoption order
- overall commercial launch order

## 2. Why This Order

### 2.1 Wallet Program Reality

The wallet build plan says the near-term goal is:

- one first-party EVM app can connect locally
- basic signing works
- policy and audit fire on every request
- two integrated first-party app paths are stable

That means the next move should optimize for:

- low-friction provider compatibility
- high signal for trust-kernel and approval UX
- fast validation of `Aethelred Connect`

### 2.2 Repo Reality

Current wallet integration shapes in the dApps break into two groups:

- EVM-first apps: `Cruzible`, `TerraQura`, `ZeroID`, `NoblePay`
- Aethelred/Cosmos-style app: `Shiora`

The wallet RFC already calls out that:

- `Cruzible`, `ZeroID`, and `TerraQura` are EVM-style provider flows
- `Shiora` introduces Cosmos-style signing and bech32-compatible flows

So the correct path is:

1. prove the EVM adapter path
2. stabilize sessions, approvals, and audit
3. then tackle the Cosmos-style adapter

## 3. Integration Principles

### 3.1 Wallet Owns Trust

The wallet should own:

- connection grants
- session grants
- signing
- approval UX
- policy enforcement
- audit and evidence

The dApps should not independently recreate those trust controls.

### 3.2 dApps Keep Product Semantics

Each dApp should keep ownership of:

- its own business rules
- its own product UX
- its own backend workflows
- its own compliance-specific behavior

The wallet should not absorb product-specific domain logic.

### 3.3 Session Ownership Is Split

There are two valid session layers:

- `wallet session`: origin-scoped connection and signing grant
- `app session`: product-owned authenticated session for business workflows

Do not force all dApps into one session model.

### 3.4 Wallet Integration Order Is Not Platform Adoption Order

If the Elixir control-plane track runs in parallel, follow the platform strategy separately:

1. `NoblePay`
2. `TerraQura`
3. `Wallet control plane`
4. `ZeroID`
5. `Cruzible`
6. `Shiora`

That order is for orchestration and operations, not for the first wallet connection slice.

## 4. Shared Wallet Capability Baseline

The current wallet connect package already points to the intended baseline:

- EIP-1193 request handling
- EIP-6963 discovery
- origin-scoped session grants
- rich approval payloads for tx, personal sign, typed data, connect, add-chain, and watch-asset flows

This means the first integrations should target standard wallet behavior first, not bespoke app protocols.

## 5. App-by-App Integration Matrix

| App | Current connect shape | Target wallet path | Signing model | Approval model | Session model | Priority |
|---|---|---|---|---|---|---|
| Cruzible | wagmi injected + WalletConnect + Coinbase | injected `Aethelred Wallet` via EIP-6963/EIP-1193 | EVM tx signing for staking, unstaking, reward and governance flows | wallet-owned tx approvals and simulation | wallet session only for phase 1 | 1 |
| TerraQura | RainbowKit/wagmi + WalletConnect + app-side legal/KYC gates | injected `Aethelred Wallet` plus WalletConnect fallback | EVM tx signing plus message signing for legal acceptance | app-owned business gates before wallet approval | wallet session + app-owned legal/KYC state | 2 |
| ZeroID | RainbowKit/wagmi fallback config | injected `Aethelred Wallet` first, later richer native intents | EVM tx signing first, later identity-sensitive message and proof-linked flows | high-context wallet approvals for identity actions | wallet session + optional app verification session | 3 |
| NoblePay | wagmi injected + WalletConnect + enterprise app state | injected `Aethelred Wallet` after enterprise wallet modes mature | EVM tx signing for payment and treasury actions | wallet approval-bound and later dual-control or committee mode | wallet session + product-owned operator session | 4 |
| Shiora | challenge-response wallet auth with bech32/Aethelred flow | Cosmos-style compatibility adapter after EVM path is stable | off-chain challenge signing first, later chain-aware auth and consent flows | wallet sign-message approval first | Shiora keeps server session cookie | 5 |

## 6. Detailed Integration Calls

### 6.1 Cruzible

Recommended role:
- first wallet integration target

Why first:

- it is the cleanest protocol-native wallet path
- it is EVM-first
- it depends heavily on standard connect and transaction flows
- it gives the wallet fast feedback on provider behavior, approvals, and simulation UX

Current shape:

- injected and WalletConnect based wagmi configuration
- app-owned connect and disconnect state in the frontend
- direct contract writes for vault and bridge flows

Target integration:

- `Aethelred Wallet` should appear as the preferred injected provider via EIP-6963 discovery
- Cruzible should connect through standard EIP-1193
- transaction signing remains standard wallet-driven tx approval
- Cruzible should not own custom approval logic beyond user messaging

What wallet must support for Cruzible:

- `eth_requestAccounts`
- `eth_sendTransaction`
- `wallet_switchEthereumChain`
- allowance and contract simulation clarity
- readable spender and asset warnings

Phase-1 objective:

- complete one end-to-end flow:
  `connect -> approve token spend -> stake -> confirm -> activity visible`

### 6.2 TerraQura

Recommended role:
- second wallet integration target

Why second:

- it is the strongest full-stack EVM product architecture already present
- it has real business gates like legal acceptance and KYC
- it validates that wallet sessions can coexist with product-side compliance and legal workflows

Current shape:

- RainbowKit and wagmi-based wallet connection
- message signing for terms acceptance
- product-side legal and compliance gates
- strong backend and worker decomposition

Target integration:

- keep TerraQura product gates in TerraQura
- move wallet connection and transaction approval to `Aethelred Wallet`
- keep WalletConnect fallback for broader ecosystem compatibility if needed
- later add first-party fast path for the Aethelred wallet brand inside RainbowKit or custom connect UI

What wallet must support for TerraQura:

- standard EVM connection
- personal sign for legal acceptance and equivalent acknowledgements
- tx signing for marketplace, retirement, and governance actions
- session grant revocation by origin

Phase-2 objective:

- complete one end-to-end flow:
  `connect -> pass legal gate -> sign terms -> execute marketplace or retirement action`

### 6.3 ZeroID

Recommended role:
- third wallet integration target

Why third:

- it is still EVM-compatible enough for the same connect path
- but it introduces more trust-sensitive identity semantics
- the wallet approval UX should be more mature before it fronts sensitive identity actions

Current shape:

- RainbowKit/wagmi style EVM config
- contract write flows for identity, credentials, governance, and proof-related actions
- backend and cryptographic services that should stay product-owned

Target integration:

- phase 1: standard injected wallet integration for EVM transactions
- phase 2: explore richer native wallet intents for identity-sensitive actions if needed
- wallet should remain the signer and session owner, while ZeroID keeps identity semantics and proof logic

What wallet must support for ZeroID:

- connect and tx signing
- better human-readable approvals for identity-sensitive actions
- future room for credential-aware or policy-aware approvals

Phase-3 objective:

- complete one end-to-end flow:
  `connect -> identity action -> wallet approval -> on-chain result -> operator visibility`

### 6.4 NoblePay

Recommended role:
- fourth wallet integration target

Why not first for wallet integration:

- NoblePay is first for workflow platform adoption, but not first for wallet connection
- its product complexity is higher than Cruzible or TerraQura
- it wants enterprise and approval-heavy behavior that should land after wallet modes are stronger

Current shape:

- standard wagmi EVM wallet connection
- contract write hooks for payment and business flows
- product-side compliance, treasury, and operator semantics

Target integration:

- basic wallet connection can use the same EVM injected pattern
- but the meaningful NoblePay integration should wait until wallet enterprise features are stronger
- NoblePay should eventually use approval-bound, dual-control, or committee-backed signing modes from the wallet

What wallet must support before serious NoblePay integration:

- workspace-aware accounts
- policy modes beyond retail allow or warn
- approval routing and audit evidence
- later reviewer and committee semantics

Practical position:

- do not make NoblePay the first dApp connected to the wallet
- do use it early for event-contract and workflow-platform work in parallel

### 6.5 Shiora

Recommended role:
- fifth wallet integration target

Why last:

- it is not just another EVM dApp
- it already uses a challenge-response wallet authentication model
- it keeps an app-owned authenticated session through an httpOnly cookie
- it needs Cosmos-style or bech32-compatible compatibility, not just EVM injection

Current shape:

- wallet challenge issuance
- off-chain signature verification
- server-issued session token and cookie
- app-owned authenticated session validation

Target integration:

- do not force Shiora into the EVM flow first
- the wallet should eventually provide a Cosmos-style compatibility adapter or Aethelred-native sign-message surface
- Shiora should continue owning its server session and auth semantics

What wallet must support before Shiora integration:

- signed challenge messages without chain tx
- compatible address handling for Aethelred/bech32 flows
- clear session handoff from wallet signature to Shiora server session issuance

Practical position:

- treat Shiora as the proof point for the wallet compatibility adapter, not as the first provider integration

## 7. Immediate Execution Order

### Step 1: Lock Integration Targets

Lock these now:

- target 1: `Cruzible`
- target 2: `TerraQura`

Do not keep this ambiguous.

### Step 2: Finish Wallet Vertical Slice Against Cruzible

Build and verify:

- connect
- session grant
- tx simulation
- approval
- signing
- audit event

Use one real Cruzible flow as the reference implementation.

### Step 3: Add TerraQura As The First Mixed-Model Integration

After Cruzible works:

- keep wallet session ownership in the wallet
- keep legal and KYC gating in TerraQura
- prove that app-level business gates and wallet trust gates can coexist cleanly

### Step 4: Prepare ZeroID, Do Not Lead With It

Do:

- map ZeroID identity actions to approval types
- identify which actions are plain tx approvals and which need richer wallet explanation

Do not:

- make ZeroID the first connect target

### Step 5: Run NoblePay Platform Work In Parallel

Parallel lane only:

- event taxonomy
- workflow contracts
- queue and case model

Do not make NoblePay the first wallet connection target.

### Step 6: Treat Shiora As A Compatibility Spike

Start only after the EVM path is solid:

- challenge sign model
- address compatibility
- server session handoff

## 8. What Not To Do

- do not start with all five apps at once
- do not start with Shiora before proving the EVM path
- do not let NoblePay enterprise workflow complexity block the first wallet integration slice
- do not rebuild each dApp's wallet layer independently after the wallet program has already defined `Aethelred Connect`
- do not confuse Elixir workflow adoption order with wallet integration order

## 9. Recommended Decision For This Week

Make these calls explicit:

1. `Cruzible` is wallet integration target 1
2. `TerraQura` is wallet integration target 2
3. `ZeroID` is wallet integration target 3
4. `NoblePay` begins workflow-platform work in parallel, but not first wallet integration
5. `Shiora` is deferred until the wallet Cosmos-style compatibility adapter is ready

## 10. Next Deliverable

After this matrix, the next execution document should be:

`wallet/AETHELRED_WALLET_FIRST_PARTY_INTEGRATION_SPEC_2026-04-15.md`

That document should define:

- the exact RPC methods and session permissions needed for Cruzible and TerraQura
- wallet approval templates for the first real actions
- the acceptance criteria for integration target 1 and target 2
