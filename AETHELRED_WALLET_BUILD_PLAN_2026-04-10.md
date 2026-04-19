# Aethelred Wallet Build Plan

Date: 2026-04-10
Status: Local execution draft
Scope: First 90 days

## 1. Build Objective

Start the wallet program immediately with a delivery plan that preserves sovereign and enterprise readiness in the architecture while producing a usable internal alpha quickly.

## 2. Delivery Shape

The program should run across four tracks in parallel:

1. `Client Track`
2. `Connect Track`
3. `Trust and Policy Track`
4. `Program and Security Track`

## 3. Phase Plan

### Phase 0: Week 1 to Week 2

Goal:
Create alignment, settle core decisions, and produce a runnable wallet shell.

Deliverables:

- finalized product north star and mode boundaries
- architecture decision log
- browser extension shell repository structure inside the local wallet workspace
- initial design system direction for the wallet shell
- account, subject, workspace, and policy domain model v0
- app integration target list and technical approach
- threat model v0

Exit criteria:

- team owners are assigned
- the extension shell boots locally
- the first provider and signer interfaces are defined
- the first integration target is selected

### Phase 1: Week 3 to Week 6

Goal:
Build the first vertical slice from app connection to approval to signing to audit event.

Deliverables:

- Aethelred Connect provider v0
- EVM-compatible connection path
- signer boundary and secure local storage v0
- approval modal and transaction summary UX v0
- audit event pipeline v0
- workspace and role model v0
- policy engine stub with allow, deny, warn, and approval-required states

Exit criteria:

- one first-party EVM-style app can connect locally
- basic transaction or message signing works through the wallet shell
- policy and audit events fire on every request

### Phase 2: Week 7 to Week 10

Goal:
Expand from a narrow connection demo into a serious wallet alpha.

Deliverables:

- account management and import flows
- session controls and dApp permission model
- simulation and risk-summary v0
- enterprise workspace UX v0
- hardware wallet path definition
- Cosmos-style compatibility prototype or adapter decision with proof
- initial app-runtime manifest draft

Exit criteria:

- wallet alpha supports repeated local use
- workspaces and approvals are visible in product form
- compatibility path for Shiora-style flows is validated

### Phase 3: Week 11 to Week 12

Goal:
Prepare internal alpha and leadership review.

Deliverables:

- extension alpha for internal team use
- two integrated first-party app paths
- policy template set v0
- evidence export sample
- admin and control-plane scope for next phase
- mobile direction memo
- security review findings and remediation list

Exit criteria:

- internal alpha is demoable end to end
- leadership can see a credible path from wallet to trust platform

## 4. Workstream Breakdown

### 4.1 Client Track

Scope:

- browser extension shell
- onboarding and account creation
- approval and signing UX
- account and workspace views
- permissions and session management

Key milestones:

- week 2: extension shell live
- week 4: approval UX live
- week 8: workspace UX live
- week 12: internal alpha quality pass

### 4.2 Connect Track

Scope:

- EIP-1193 provider
- EIP-6963 discovery
- app connection state
- WalletConnect planning
- Cosmos-style compatibility adapter

Key milestones:

- week 2: provider interface contract
- week 4: first dApp connects
- week 8: compatibility prototype validated
- week 12: two app integrations stable

### 4.3 Trust and Policy Track

Scope:

- signer boundary
- secure storage
- account registry
- subject and workspace model
- policy engine
- approval workflows
- audit evidence model

Key milestones:

- week 2: domain models drafted
- week 4: signer path live
- week 6: policy decisions attached to requests
- week 10: approval and audit working together

### 4.4 Program and Security Track

Scope:

- decision management
- architecture reviews
- threat modeling
- security checkpoints
- weekly demos
- blocker resolution

Key milestones:

- week 1: kickoff complete
- week 2: threat model v0
- week 6: first security gate
- week 12: internal alpha readiness review

## 5. Staffing Model

Recommended minimum:

- 1 product lead
- 1 design lead
- 2 frontend or extension engineers
- 1 platform engineer
- 1 wallet or crypto engineer
- 1 integration engineer
- 1 security engineer or security-minded lead reviewer

Recommended stronger team:

- add 1 mobile engineer
- add 1 backend or control-plane engineer
- add 1 QA or release engineer

## 6. Daily and Weekly Cadence

Daily:

- 15-minute cross-workstream standup
- blocker list maintained in one place

Weekly:

- architecture review
- product and design review
- live demo
- security review checkpoint
- decision log cleanup

## 7. First-Order Risks

- building UI faster than trust boundaries are defined
- overfitting to retail wallet patterns
- leaving organization and policy out of the first domain model
- trying to solve mobile, extension, enterprise, and sovereign hosting all at once
- unclear compatibility strategy across EVM and Cosmos-style apps

## 8. Immediate Command Intent

For the first month, optimize for:

- one coherent architecture
- one working extension alpha
- one app connection vertical slice
- one policy and audit model
- one shared operating cadence

Do not optimize for:

- public launch polish
- multi-platform feature parity
- full app marketplace breadth
- every custody option in v1
