# Aethelred Wallet Sprint 0 Backlog

Date: 2026-04-10
Status: Local working backlog
Sprint Length: 10 working days
Goal: Establish the wallet foundation and produce the first local vertical slice.

## 1. Sprint 0 Outcomes

By the end of Sprint 0, the team should have:

- a shared architecture baseline
- a bootable extension shell
- provider and signer interface contracts
- first domain models for account, subject, workspace, and policy
- a first integration target selected and mapped
- a threat model and risk register

## 2. Priority 0 Tasks

### Program

- `WLT-001` Create the wallet war-room workspace inside `wallet/` and define document ownership.
- `WLT-002` Assign named owners for Product, Client, Connect, Trust, Platform, and Security.
- `WLT-003` Set a weekly demo slot and architecture review slot.
- `WLT-004` Create a lightweight decision log and record the first week-one decisions.

### Product and Design

- `WLT-010` Turn the PRD into a first user-journey map for Personal and Enterprise.
- `WLT-011` Define the primary navigation model for the extension shell.
- `WLT-012` Design the approval surface for connect, sign message, and sign transaction flows.
- `WLT-013` Draft account import, account creation, and workspace creation flows.
- `WLT-014` Define what the app-of-apps home screen should show in alpha.

### Connect

- `WLT-020` Define the `Aethelred Connect` interface boundary.
- `WLT-021` Draft the EIP-1193 provider contract and request lifecycle.
- `WLT-022` Draft the EIP-6963 discovery behavior for wallet announcement and selection.
- `WLT-023` Create the app integration matrix for Cruzible, ZeroID, TerraQura, and Shiora.
- `WLT-024` Pick the first app target for vertical-slice integration.
- `WLT-025` Define the Cosmos-style compatibility decision path and prototype criteria.

### Trust Kernel

- `WLT-030` Define the signer boundary and no-key-leak rules.
- `WLT-031` Define the key slot and account model.
- `WLT-032` Choose the local secure storage approach for extension alpha.
- `WLT-033` Define message signing and transaction signing interfaces.
- `WLT-034` Define imported account handling rules.

### Identity, Policy, and Audit

- `WLT-040` Define the `subject`, `workspace`, `role`, and `credential` entities.
- `WLT-041` Define the policy object model and first evaluation outcomes.
- `WLT-042` Define the approval request object and reviewer routing rules.
- `WLT-043` Define the minimum audit event schema.
- `WLT-044` Draft the first policy templates for app connection, transaction approval, and session limits.

### Client and UX

- `WLT-050` Stand up the extension shell locally.
- `WLT-051` Create placeholder screens for onboarding, wallet home, approvals, and settings.
- `WLT-052` Wire the request pipeline from mock dApp request to approval screen.
- `WLT-053` Add a visible environment indicator to keep local alpha builds unmistakable.
- `WLT-054` Create a local demo mode with seeded mock requests.

### Security

- `WLT-060` Produce an extension threat model v0.
- `WLT-061` Write the initial abuse-case list for phishing, permission abuse, and approval spoofing.
- `WLT-062` Define the internal alpha release gate checklist.
- `WLT-063` Review the signer boundary and storage plan before implementation starts.

## 3. Priority 1 Tasks

- `WLT-070` Define WalletConnect support assumptions for later phases.
- `WLT-071` Define hardware wallet integration assumptions for alpha and beta.
- `WLT-072` Define evidence export requirements for enterprise review.
- `WLT-073` Draft the first admin-control surface inventory.
- `WLT-074` Define app manifest and wallet intent schema candidates.

## 4. Suggested Task Ownership

- Product lead owns `WLT-001` to `WLT-014`
- Connect lead owns `WLT-020` to `WLT-025`
- Wallet core lead owns `WLT-030` to `WLT-034`
- Platform lead owns `WLT-040` to `WLT-044`
- Client lead owns `WLT-050` to `WLT-054`
- Security lead owns `WLT-060` to `WLT-063`

## 5. Sprint 0 Exit Review

Sprint 0 is successful if:

- the team can demo a local extension shell
- the team can trace a request from app to approval to signer boundary in design or code
- the first integration target is agreed
- domain models exist for account, workspace, policy, and audit
- the first major unresolved risks are written down, not hidden

## 6. What Not to Do in Sprint 0

- do not build a full mobile app yet
- do not start with every chain or protocol integration
- do not over-design the app marketplace
- do not leave security and policy until after the UI demo
- do not chase external polish over internal architecture clarity
