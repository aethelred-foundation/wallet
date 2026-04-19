# Aethelred Wallet Team Kickoff

Date: 2026-04-10
Status: Local working draft
Scope: Team alignment and immediate execution
Related:

- `wallet/AETHELRED_WALLET_DECISION_MEMO_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PRD_2026-04-10.md`
- `wallet/AETHELRED_WALLET_ARCHITECTURE_RFC_2026-04-10.md`

## 1. Why We Are Starting Now

Aethelred Wallet is not being launched as another retail wallet.

We are building the trust operating environment for:

- sovereign users
- regulated institutions
- enterprise teams
- validators and operators
- ecosystem developers
- retail users who need a simpler front door

This means our product must be:

- secure enough for regulated and sovereign workflows
- flexible enough to support multiple wallet interfaces
- simple enough for everyday onboarding
- extensible enough to become an app-of-apps platform

## 2. What We Are Building

We are building one wallet core with multiple assurance modes:

- `Personal`
- `Enterprise`
- `Sovereign`

The product will expose one Aethelred experience while supporting multiple execution environments underneath:

- EVM-style provider flows for apps such as Cruzible, ZeroID, and TerraQura
- Cosmos-style compatibility and bech32-aware flows for apps such as Shiora
- future institutional and sovereign deployment modes with policy, audit, and approval controls

## 3. What Success Looks Like in the First 90 Days

By the end of the first 90 days, we should have:

- a working browser extension alpha
- an Aethelred provider layer that can connect to at least one current EVM-style app
- a compatibility approach for Cosmos-style flows validated in design and prototype form
- a trust-kernel baseline for key management and signing boundaries
- a workspace and policy v0 model
- an approval and audit event model
- a simulation and risk-summary path for approvals
- a local team operating cadence with clear ownership and weekly demos

## 4. Program Workstreams

### 4.1 Product and Design

Mission:
Define user journeys, approval UX, information architecture, mode separation, and the app-of-apps product shell.

Immediate outputs:

- wallet IA and navigation model
- onboarding flows for Personal and Enterprise
- approval UX model
- account and workspace model in UX terms
- extension shell wireframes

### 4.2 Aethelred Connect and Compatibility

Mission:
Make first-party apps work through Aethelred Wallet using standards-compatible adapters.

Immediate outputs:

- EIP-1193 provider plan
- EIP-6963 discovery plan
- custom connector strategy for current dApps
- Cosmos-style compatibility adapter decision
- app integration matrix for Cruzible, ZeroID, TerraQura, and Shiora

### 4.3 Trust Kernel and Custody

Mission:
Design and implement the high-assurance core for account storage, signing, custody abstraction, and future HSM or MPC integration.

Immediate outputs:

- signer boundary definition
- key slot model
- secure storage approach for extension
- imported account model
- hardware wallet integration plan

### 4.4 Identity, Policy, and Approval Systems

Mission:
Model subjects, organizations, workspaces, policies, delegated authority, and approvals.

Immediate outputs:

- subject and workspace domain model
- policy object model
- approval workflow model
- audit evidence model
- initial policy templates

### 4.5 Wallet App Runtime

Mission:
Shape the wallet into a secure app shell rather than a passive signer.

Immediate outputs:

- app manifest format
- intent request model
- permission model
- trusted app catalog rules
- internal app container concept

### 4.6 Platform and Control Plane

Mission:
Prepare the management layer for enterprise and sovereign operations.

Immediate outputs:

- admin console scope
- deployment tier assumptions
- evidence export requirements
- environment and secret-handling model
- observability baseline

### 4.7 Security and Verification

Mission:
Make trust and assurance part of delivery from week one.

Immediate outputs:

- security review checklist
- extension threat model
- policy abuse-case list
- approval spoofing and phishing test cases
- release gating criteria for internal alpha

## 5. Initial Ownership Model

Recommended program structure:

- `Program lead`: product, sequencing, executive alignment
- `Wallet core lead`: trust kernel, account model, custody
- `Platform lead`: policy, approvals, audit, control plane
- `Client lead`: extension shell, mobile planning, UI architecture
- `Connect lead`: provider interfaces and app compatibility
- `Design lead`: onboarding, approvals, workspaces, app shell
- `Security lead`: threat modeling, review gates, trust boundaries

If the team is smaller, combine roles carefully:

- combine `Program` and `Product`
- combine `Wallet core` and `Connect`
- combine `Platform` and `Security` only temporarily
- do not combine `Client UX` and `Security sign-off`

## 6. Decisions We Need in Week One

1. Confirm the first shipping surface:
   Browser extension first, mobile second.

2. Confirm the wallet core boundary:
   UI and adapters must not own signing logic.

3. Confirm the first app integrations:
   Start with one EVM-style app and one Cosmos-style compatibility target.

4. Confirm the first policy surface:
   Workspace approvals, allowlists, limits, and session controls.

5. Confirm the first deployment mode:
   Local and managed cloud assumptions first, sovereign deployment architecture defined but not built out fully.

## 7. Recommended Kickoff Agenda

1. Product ambition and market posture
2. Current repo reality and integration constraints
3. Architecture decision review
4. Workstream owners
5. First 2-week sprint commitments
6. Demo cadence and review gates
7. Risk register and blocked decisions

## 8. Team Rules for the First Month

- Build one core, not parallel wallet products.
- Keep compatibility work as an adapter layer, not the product center.
- Make approvals, policy, and audit part of the first architecture pass.
- Do not hide unresolved trust decisions inside UI placeholders.
- Demo working integration progress every week.
- Capture decisions fast and in writing.

## 9. Immediate Next Actions

- Review the PRD and RFC together in one working session.
- Assign named owners for each workstream.
- Open a Sprint 0 board based on the backlog document.
- Choose the first app integration target.
- Choose the extension technology direction and security envelope.
- Begin architecture decision records immediately.
