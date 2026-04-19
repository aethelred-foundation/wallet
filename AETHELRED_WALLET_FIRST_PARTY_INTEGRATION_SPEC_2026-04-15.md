# Aethelred Wallet First-Party Integration Spec

Date: 2026-04-15
Status: Execution draft
Scope: first two wallet integration targets

- Target 1: `Cruzible`
- Target 2: `TerraQura`

Purpose: define the exact RPC methods, session permissions, approval templates, and acceptance criteria for the first two first-party wallet integrations.

This document assumes:

- `wallet/AETHELRED_WALLET_ARCHITECTURE_RFC_2026-04-10.md` remains the architecture source of truth
- `wallet/AETHELRED_WALLET_BUILD_PLAN_2026-04-10.md` remains the sequencing source of truth
- `wallet/AETHELRED_WALLET_DAPP_INTEGRATION_MATRIX_2026-04-15.md` remains the integration-order source of truth

## 1. Integration Goal

The first wallet integration program must prove four things:

1. `Aethelred Connect` works as a real first-party provider
2. the wallet can own connection, session, approval, signing, and audit
3. a first-party dApp can keep its own product semantics without owning wallet trust logic
4. app-level business gates can coexist with wallet-level trust gates

## 2. Shared Scope

## 2.1 Shared Wallet Connect Capabilities

The first two integrations should use the current wallet connect surface, not invent a new one.

Required shared capabilities:

- EIP-6963 provider discovery
- EIP-1193 request handling
- origin-scoped wallet sessions
- rich approval rendering for:
  - `connect`
  - `personal_sign`
  - `eth_sendTransaction`
  - `wallet_switchEthereumChain`
  - `wallet_watchAsset`

## 2.2 Canonical Permission Vocabulary

The wallet currently stores permissions as freeform strings.

For the first-party integrations, standardize on this vocabulary:

- `accounts:read`
- `chains:read`
- `chains:switch`
- `transactions:send`
- `messages:sign`
- `typed-data:sign`
- `assets:watch`

Do not introduce product-specific permission names in phase 1.

## 2.3 Session Model

Two layers are allowed:

- `wallet session`
  - origin-scoped
  - owned by `Aethelred Wallet`
  - covers connect and signing rights

- `app session`
  - product-owned
  - only used if the app needs business authentication beyond wallet connectivity

First-party rule:

- the wallet owns signing authority
- the app owns product-state, legal-state, KYC-state, or business workflow state

## 3. Cruzible Spec

## 3.1 Why Cruzible Goes First

`Cruzible` is the cleanest first target because:

- it is EVM-first
- it already uses direct contract write flows
- it depends on standard connect, approve, and transaction confirmation behavior
- it gives fast validation of simulation and approval UX

## 3.2 Current Repo Reality

Current Cruzible behavior already uses:

- wagmi injected wallet connection
- WalletConnect fallback
- `useWriteContract` for real contract actions
- a two-step `approve -> stake` flow
- direct transaction flows for unstake and claim rewards

This means the wallet integration should target real user actions immediately, not read-only demo flows.

## 3.3 Phase 1 Cruzible Scope

Mandatory phase-1 flows:

1. connect wallet
2. switch to the correct Aethelred chain if needed
3. approve AETHEL spending
4. stake AETHEL into Cruzible
5. unstake stAETHEL
6. claim rewards

Optional phase-1.5 flows:

- bridge-out stablecoins
- governance vote and delegation
- watch stAETHEL as an asset

## 3.4 Cruzible Required RPC Methods

Mandatory:

- `eth_requestAccounts`
- `eth_accounts`
- `eth_chainId`
- `wallet_switchEthereumChain`
- `eth_call`
- `eth_estimateGas`
- `eth_feeHistory`
- `eth_maxPriorityFeePerGas`
- `eth_sendTransaction`
- `eth_getTransactionReceipt`

Optional phase-1.5:

- `wallet_watchAsset`
- `eth_signTypedData_v4` only if governance or gasless flows later require it

Not needed for Cruzible phase 1:

- `personal_sign`

## 3.5 Cruzible Wallet Session Permissions

Grant on connect:

- `accounts:read`
- `chains:read`
- `chains:switch`
- `transactions:send`

Only grant `assets:watch` if the user explicitly adds a token from a wallet-owned CTA.

## 3.6 Cruzible Approval Templates

### A. Connect Approval

Intent:
- `connect`

Title:
- `Connect Cruzible`

Required fields:

- app name
- origin
- requested permissions
- selected account addresses
- trust level

Decision behavior:

- approve creates a wallet session for Cruzible origin
- reject creates no session

### B. Token Approval Transaction

Intent:
- `sign-transaction`

Typical decoded method:
- `approve`

Title:
- `Approve AETHEL Spending`

Required fields:

- token symbol
- spender contract
- amount
- whether allowance is exact or effectively unlimited
- estimated fee
- simulation risk
- warnings

Required warnings:

- highlight spender contract identity as `Cruzible Vault`
- highlight if approval amount exceeds entered stake amount materially
- highlight if approval is unlimited

Success condition:

- user can clearly distinguish token approval from staking itself

### C. Stake Transaction

Intent:
- `sign-transaction`

Typical decoded method:
- `stake`

Title:
- `Stake AETHEL`

Required fields:

- destination contract
- amount
- asset symbol
- estimated fee
- resulting user-facing meaning:
  `AETHEL will be deposited and stAETHEL will be received`

Required warnings:

- contract destination
- simulation anomalies
- unusually high fee or slippage-like discrepancies if found

### D. Unstake Transaction

Intent:
- `sign-transaction`

Typical decoded method:
- `unstake`

Title:
- `Unstake stAETHEL`

Required fields:

- amount of stAETHEL
- expected withdrawal behavior
- estimated fee

Required warnings:

- withdrawal may not be instantly liquid if protocol semantics imply delay

### E. Claim Rewards Transaction

Intent:
- `sign-transaction`

Typical decoded method:
- `claimRewards`

Title:
- `Claim Cruzible Rewards`

Required fields:

- source contract
- expected reward asset if known
- estimated fee

Required warnings:

- none beyond standard simulation unless the transaction is abnormal

## 3.7 Cruzible Acceptance Criteria

The Cruzible integration is complete only if all of the following are true:

1. `Aethelred Wallet` is discoverable in Cruzible through injected provider discovery
2. a user can connect with `Aethelred Wallet` without using MetaMask or WalletConnect
3. the wallet session for Cruzible is visible and revocable by origin
4. the `approve -> stake` flow produces two distinct approvals with decoded meaning
5. user rejection of either approval returns control cleanly to Cruzible
6. successful transactions appear in wallet activity and Cruzible success UI
7. audit and approval history are recorded for connect and send flows

## 3.8 Cruzible Out Of Scope For This Spec

- stablecoin bridge as a required launch blocker for target 1
- governance proposal authoring
- committee or enterprise review semantics

## 4. TerraQura Spec

## 4.1 Why TerraQura Goes Second

`TerraQura` is second because it proves the mixed model:

- wallet-owned trust and signing
- app-owned legal and compliance gating
- stronger full-stack product architecture around the wallet

## 4.2 Current Repo Reality

Current TerraQura web behavior already uses:

- RainbowKit and wagmi wallet connection
- message signing for terms acceptance
- app-level legal and KYC gating
- strong backend, worker, verifier, and indexer architecture

Important current constraint:

- the current web surface shows clear read and gated-flow behavior, but it does not yet expose a production-grade wallet transaction write path comparable to Cruzible

That means TerraQura phase 1 should not pretend to be:

- a full transaction signing integration

TerraQura phase 1 should instead be:

- a connect plus sign-message plus gated-access integration

## 4.3 Phase 1 TerraQura Scope

Mandatory phase-1 flows:

1. connect wallet
2. switch to correct Aethelred chain if needed
3. sign terms acceptance message
4. persist app-side legal acceptance state
5. enter TerraQura gated dashboard flows after wallet trust and app legal gating both succeed

Optional phase-2 flows:

- marketplace purchase transaction
- retirement transaction
- governance transaction
- gasless marketplace typed-data flow

## 4.4 TerraQura Required RPC Methods

Mandatory:

- `eth_requestAccounts`
- `eth_accounts`
- `eth_chainId`
- `wallet_switchEthereumChain`
- `personal_sign`

Recommended but not required in phase 1:

- `wallet_getPermissions`
- `wallet_revokePermissions`

Reserved for phase 2:

- `eth_sendTransaction`
- `eth_signTypedData_v4`

## 4.5 TerraQura Wallet Session Permissions

Grant on connect:

- `accounts:read`
- `chains:read`
- `chains:switch`
- `messages:sign`

Do not grant `transactions:send` in TerraQura phase 1 unless a real tx flow is turned on.

Add later when production tx flows exist:

- `transactions:send`
- `typed-data:sign`

## 4.6 TerraQura Approval Templates

### A. Connect Approval

Intent:
- `connect`

Title:
- `Connect TerraQura`

Required fields:

- app name
- origin
- requested permissions
- selected account addresses
- trust level

Decision behavior:

- approve creates wallet session
- TerraQura still decides whether legal and KYC gates are satisfied

### B. Terms Acceptance Message Signature

Intent:
- `sign-message`

Method:
- `personal_sign`

Title:
- `Sign TerraQura Terms Acceptance`

Required fields:

- signer address
- preview of the human-readable message
- terms version
- terms hash if present
- timestamp
- statement that no blockchain transaction will be sent

Required warnings:

- show that this is a legal acknowledgement, not a token transfer
- warn if the message preview is truncated
- flag if the payload shape deviates materially from the approved TerraQura format

Approval success meaning:

- the wallet authorizes the message signature
- TerraQura stores the legal acceptance state on the app side

### C. Future Gasless Marketplace Signature

Intent:
- `eth_signTypedData_v4`

Status:
- phase 2 only

Title:
- `Authorize TerraQura Marketplace Action`

Required future fields:

- primary type
- domain name
- verifying contract
- chain id
- business meaning of the typed data

Required future warnings:

- if the typed-data action can move assets or authorize relayers
- if the signature can be replayed outside TerraQura's intended domain

### D. Future Retirement Transaction

Intent:
- `sign-transaction`

Status:
- phase 2 only

Title:
- `Retire Carbon Credits`

Required future fields:

- asset id or token id
- quantity to retire
- beneficiary
- reason
- permanence warning that retirement is irreversible

## 4.7 TerraQura Acceptance Criteria

The TerraQura phase-1 integration is complete only if all of the following are true:

1. `Aethelred Wallet` can connect successfully through TerraQura's provider stack
2. the wallet session for TerraQura is visible and revocable by origin
3. TerraQura can request and receive a human-readable `personal_sign` terms signature
4. the user clearly sees that this is a legal acknowledgement and not an on-chain transaction
5. TerraQura legal/KYC gates continue to be app-owned and are not absorbed into wallet session semantics
6. revoking the wallet session disconnects signing authority without corrupting TerraQura product state

## 4.8 TerraQura Out Of Scope For This Spec

- full marketplace settlement transaction support
- ERC-1155 purchase flows
- retirement transaction flows
- typed-data gasless settlement flows

Those belong in TerraQura phase 2 after the phase-1 signature integration is stable.

## 5. Implementation Sequence

## 5.1 Cruzible First

Build in this order:

1. injected provider discovery
2. connect approval
3. chain switch flow
4. approve transaction template
5. stake transaction template
6. unstake and claim templates
7. session visibility and revocation
8. acceptance test flow

## 5.2 TerraQura Second

Build in this order:

1. injected provider compatibility inside TerraQura provider stack
2. connect approval
3. message-sign approval template for terms acceptance
4. legal state handoff validation
5. session revocation and reconnect behavior

## 6. What Not To Do

- do not start TerraQura by inventing transaction flows that are not yet live in the current web app
- do not merge TerraQura legal gating into wallet permission logic
- do not collapse Cruzible's multi-step `approve -> stake` flow into one opaque approval
- do not add product-specific permission vocabularies before the first two integrations stabilize

## 7. Definition Of Success

This spec succeeds if, after implementation:

1. `Cruzible` proves the wallet can handle real first-party EVM transaction flows
2. `TerraQura` proves the wallet can coexist with app-owned legal and compliance state
3. the wallet team gains one repeatable EVM transaction template and one repeatable first-party message-sign template
4. the next integration target, `ZeroID`, can start from proven patterns instead of from scratch
