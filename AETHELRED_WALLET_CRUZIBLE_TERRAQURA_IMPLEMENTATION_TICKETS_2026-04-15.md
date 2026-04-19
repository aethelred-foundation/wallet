# Aethelred Wallet x Cruzible x TerraQura Implementation Tickets

Date: 2026-04-15
Owner: Aethelred wallet program
Status: Ready for execution

## Execution Order

1. Cruzible first-party wallet connection and approvals
2. Cruzible session/audit hardening
3. TerraQura legal-signature integration
4. TerraQura future typed-data and transaction lane

## Wallet Core

### WLT-CRZ-01 First-party wallet detection and preferred connector routing

- Scope: Treat `Aethelred Wallet` as the recommended first-party connector in Cruzible, hide ambiguous generic injected fallback when specific EIP-6963 wallets are available, and ensure the chosen wallet in the modal is actually the one connected.
- Files: `dApps/cruzible/src/components/WalletButton.tsx`, `dApps/cruzible/src/contexts/AppContext.tsx`, shared wallet-connector helper.
- Acceptance:
- Cruzible prefers `org.aethelred.wallet` when discovered.
- The connector modal does not ignore the user’s wallet selection.
- Generic `Injected` is hidden when Aethelred or another named injected wallet is available.

### WLT-CRZ-02 Permission-aware connect and session inspection

- Scope: After connection, query `wallet_getPermissions` and `wallet_getCapabilities` when supported, and surface the connected-site/session status inside Cruzible devtools or an integration status panel.
- Files: `dApps/cruzible/src/contexts/AppContext.tsx`, optional new integration-status component.
- Acceptance:
- Cruzible can tell whether the wallet granted only `eth_accounts` or broader permissions.
- Unsupported permission methods fail quietly without breaking third-party wallets.

### WLT-CRZ-03 Approval-template parity for stake flows

- Scope: Validate that `approve`, `stake`, `unstake`, and `claim` show distinct approval summaries in the wallet and tighten any missing decode/simulation labels for Cruzible-specific contract calls.
- Files: `wallet/apps/extension/src/background.ts`, `wallet/apps/extension/src/popup/views/approvals.tsx`.
- Acceptance:
- Unlimited approvals, token approvals, and staking actions render as separate, intelligible approvals.
- Approval and audit logs show the origin as Cruzible rather than a generic site label.

## Cruzible App

### CRZ-INT-01 Connector preference and modal polish

- Scope: Land the first-party connector helper, recommended badge, and real connector-selection behavior.
- Acceptance:
- Selecting `WalletConnect`, `Coinbase Wallet`, or `Aethelred Wallet` actually connects that connector.
- Aethelred Wallet appears first when available.

### CRZ-INT-02 Connected-site readiness panel

- Scope: Add a small wallet integration status module showing connected wallet, active chain, permission status, and whether the wallet is the first-party Aethelred path.
- Acceptance:
- Support and QA can verify first-party vs third-party wallet routing from the UI.

### CRZ-INT-03 Vault flow regression coverage

- Scope: Add tests around connector selection and keep the `approve -> stake` split explicit in the app UX and wallet UX.
- Acceptance:
- Connector helper tests pass.
- No code path collapses `approve` and `stake` into one opaque action.

## TerraQura App

### TQ-INT-01 First-party connect plus legal-sign flow

- Scope: Replace generic wallet connection assumptions with an Aethelred-aware connector preference path and wire the terms-acceptance signature flow as the first official wallet integration slice.
- Files: TerraQura wagmi/provider layer, legal modal, connection status surfaces.
- Acceptance:
- TerraQura can prefer Aethelred Wallet when present.
- Terms acceptance uses `personal_sign` through the wallet and persists completion app-side.

### TQ-INT-02 Signature policy boundaries

- Scope: Keep TerraQura legal-sign approvals separate from future typed-data or transaction approvals.
- Acceptance:
- No TerraQura legal gate is modeled as a transaction permission.
- Future marketplace or retirement typed-data flows can be added without reworking phase 1.

## QA and Release

### QA-INT-01 Manual wallet matrix

- Matrix:
- Aethelred Wallet only
- Aethelred Wallet + MetaMask
- MetaMask only
- WalletConnect only
- Coinbase Wallet only
- Acceptance:
- Cruzible always prefers Aethelred Wallet when it is present.
- The connector modal has no dead options and no misleading generic default path.

### REL-INT-01 Rollout gate

- Scope: Treat the Cruzible connector patch as the first release gate before deeper approval/status work.
- Acceptance:
- Connector routing, wrong-network handling, and stake flow all pass on testnet before TerraQura phase 1 starts.
