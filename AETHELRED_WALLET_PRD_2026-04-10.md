# Aethelred Wallet Product Requirements Document

Date: 2026-04-10
Status: Draft for leadership, product, and engineering review
Owner: Wallet program
Related: `wallet/AETHELRED_WALLET_DECISION_MEMO_2026-04-10.md`

## 1. Executive Summary

Aethelred Wallet is not a retail-only crypto wallet.

It is the secure operating layer for:

- sovereign institutions
- regulated enterprises
- treasury and operator teams
- validators and governance participants
- AI agents and service identities
- consumers and ecosystem partners

The product must be enterprise-grade and sovereign-capable by architecture, while remaining simple enough for broad onboarding and ecosystem use.

The launch strategy is staged:

1. Compatibility and trust kernel first
2. Personal and Pro product surface second
3. Enterprise controls third
4. Sovereign deployment and application platform fourth

The critical product rule is:

Do not ship a consumer wallet that later tries to bolt on institutional trust.

The architecture, data model, and control surfaces must support organizations, policy, audit, and deployment separation from day one.

## 2. Product Vision

### Vision Statement

Build the world-class wallet platform for Aethelred: one trusted environment where users, organizations, governments, services, and apps can hold assets, prove identity, execute policy-controlled actions, and operate regulated digital workflows.

### Product Thesis

Aethelred Wallet should become:

- the default wallet for first-party Aethelred applications
- the secure trust console for institutional and sovereign operations
- the application hub for Aethelred-native workflows
- the standards-compatible gateway that works with the rest of the wallet ecosystem

### What Makes It Different

Aethelred Wallet should combine:

- world-class onboarding and approvals
- enterprise-grade policy and organizational controls
- sovereign-grade deployment and assurance options
- app-of-apps runtime and curated distribution
- Aethelred-native trust and identity advantages

## 3. Why This Product Exists

### Market Problem

Current wallets are fragmented by design:

- retail wallets optimize for asset access and broad reach
- power-user wallets optimize for DeFi speed and transaction safety
- treasury products optimize for shared approvals
- hardware wallets optimize for assurance
- Cosmos wallets optimize for chain-adapter interoperability

No existing product cleanly combines:

- sovereign deployment needs
- institutional controls
- regulated workflow support
- modern onboarding
- broad app compatibility
- high-assurance operational models

### Aethelred Problem

Aethelred needs one trusted platform that can serve:

- current first-party apps with different wallet assumptions
- future enterprise and sovereign buyers
- ecosystem developers
- high-assurance operators
- retail participants entering through a simpler front door

The repo already reflects this split:

- `Cruzible`, `ZeroID`, and `TerraQura` assume EVM-style wallet flows
- `Shiora` and parts of backend auth assume Cosmos-style signing and bech32 identity
- regulated and policy-heavy documentation throughout the repo assumes roles, approvals, audit, and organizational control

## 4. Product Principles

### 4.1 One Core, Multiple Assurance Modes

There should be one product core with multiple modes, not separate wallet products.

### 4.2 Compatibility Is a Bridge, Not the Product

MetaMask, WalletConnect, Ledger, and Keplr support are required for adoption, but differentiation comes from Aethelred-native trust, policy, app runtime, and operator experience.

### 4.3 Enterprise and Sovereign by Design

Organizations, policy controls, approval workflows, evidence exports, and deployment tiers must be foundational, not later add-ons.

### 4.4 Simplicity at the Surface

Retail and first-time users should see a clean, simple experience with passkeys, guided approvals, and clear actions.

### 4.5 Intent-Based App Interactions

Apps should ask the wallet to execute intents, not directly access keys.

### 4.6 Auditability as a Default

Every meaningful action must be attributable, reconstructable, and exportable.

## 5. Product Modes

### 5.1 Personal

Target users:

- consumers
- investors
- community members
- ecosystem participants
- first-time Aethelred users

Primary value:

- fast onboarding
- passkeys
- clean approvals
- staking and governance
- app discovery
- secure recovery

### 5.2 Enterprise

Target users:

- treasury teams
- compliance officers
- operations leads
- regulated business units
- institutional counterparties

Primary value:

- shared workspaces
- roles and delegated authority
- approval queues
- spend and session policies
- audit trails
- app catalogs

### 5.3 Sovereign

Target users:

- ministries
- agencies
- regulated critical-infrastructure operators
- national or regional platforms
- sovereign cloud deployments

Primary value:

- deployment control
- jurisdictional separation
- key residency options
- offline and high-assurance operations
- evidence-grade audit
- private application distribution

## 6. Target Users and Roles

### Primary Personas

1. Retail Participant
   Wants easy onboarding, clear approvals, staking, governance, and app usage without crypto complexity.

2. Professional Operator
   Uses multiple accounts, signs frequently, wants simulation, hardware support, and strong session controls.

3. Treasury Manager
   Needs vaults, limits, approval routing, policy enforcement, and clear reporting.

4. Compliance Officer
   Needs visibility into policies, approval evidence, audit logs, and exportable records.

5. Validator / Governance Operator
   Needs staking, delegation, governance voting, hardware support, and chain-specific operational clarity.

6. Sovereign Administrator
   Needs deployment controls, organizational boundaries, jurisdictional policy, and restricted app distribution.

7. Application Developer
   Needs standards-compatible provider interfaces, app permissions, and a stable wallet SDK.

8. Agent / Service Operator
   Needs scoped machine identities, revocable permissions, quotas, and auditable automation.

## 7. Core User Jobs

### Personal Jobs

- Create or import an Aethelred account
- Connect to Aethelred apps without wallet confusion
- View assets, staking, governance, and key activity
- Sign with confidence after seeing a clear risk and consequence summary
- Recover access without seed-only complexity

### Enterprise Jobs

- Create a workspace for a team or legal entity
- Assign members, roles, and delegated authority
- Route sensitive actions into single, dual-control, or committee approvals
- Apply policies to counterparties, apps, assets, and spending
- Export evidence for audit and compliance review

### Sovereign Jobs

- Operate within controlled deployment boundaries
- Restrict actions by jurisdiction, role, and mission profile
- Run private apps inside a trusted wallet shell
- Maintain assurance under hardware, HSM, MPC, or offline signing constraints

## 8. Product Scope

### 8.1 In Scope for the Program

- Browser extension
- Mobile applications
- Aethelred Connect compatibility layer
- Personal and Pro user experience
- Enterprise workspace model
- Policy and approval framework
- Wallet app runtime and catalog
- Audit and evidence export
- High-assurance integration paths
- Sovereign deployment variants

### 8.2 Out of Scope for Initial Launch

- Full sovereign control plane on day one
- Complete HSM and on-prem support in first release
- A full embedded-wallet developer business before core wallet quality is proven
- Broad swap, DeFi, and trading feature sprawl unrelated to Aethelred adoption
- Building every custody rail internally in v1

## 9. Launch Wedge

### Initial Wedge

The first visible wedge should be:

- `Aethelred Connect` compatibility for first-party apps
- `Aethelred Wallet Personal/Pro` for internal teams, design partners, and early public users

This wedge should solve real problems immediately:

- connect first-party apps reliably
- reduce wallet fragmentation across Aethelred products
- establish a quality approval and onboarding experience
- create a product foundation that can scale into enterprise controls

### Why Not Launch with Sovereign Mode First

- slower adoption loop
- harder product validation
- much higher delivery and security risk
- no opportunity to harden user experience with lower-assurance segments first

### Why Not Launch as Retail-Only

- contradicts the strategic ambition
- creates upgrade debt in data model and architecture
- misses the core institutional moat

## 10. Product Requirements

### 10.1 Identity and Account Requirements

- Support account creation through passkeys and advanced custody options
- Support wallet import from seed, hardware, and compatible providers
- Support one Aethelred profile with multiple account representations and execution modes
- Support human, organizational, and service/agent identities over time
- Support account labels, workspaces, and delegated roles

### 10.2 Connectivity Requirements

- Support EVM-compatible provider interfaces for first-party apps
- Support wallet discovery and connection across modern browser standards
- Support WalletConnect for native and cross-device flows
- Support Cosmos-style signing compatibility where required by Aethelred apps
- Support hardware wallet connectivity

### 10.3 Approval and Safety Requirements

- Decode actions into human-readable summaries
- Simulate actions before signature where possible
- Show counterparties, contract trust, asset impacts, and policy impacts
- Support session permissions and app-level trust controls
- Support phishing and malformed-request warnings

### 10.4 Personal and Pro Requirements

- Asset overview and activity
- Staking and delegation
- Governance participation
- Contact and address book
- Recovery flows
- Notification center
- App catalog and app permissions

### 10.5 Enterprise Requirements

- Workspaces and teams
- Roles and delegated authority
- Vaults and sub-accounts
- Approval queues
- Spend limits and policy rules
- Admin console
- Audit and evidence export
- Private app distribution

### 10.6 Sovereign Requirements

- Dedicated deployment boundary
- Jurisdictional policy support
- Key residency options
- High-assurance custody integrations
- Restricted network and app distribution controls
- Offline or high-trust approval modes

### 10.7 Agent and Service Requirements

- Service identities
- API or delegated signing scopes
- Revocable permissions
- Usage quotas
- App- and policy-bound execution
- Full audit visibility

## 11. Non-Functional Requirements

### Security

- Strong secure-storage defaults
- Hardware-backed key storage where available
- Clear trust-boundary separation between UI, policy, and signing layers
- Independent security review gates before each phase

### Reliability

- Stable connect and reconnect behavior
- Deterministic approval rendering
- Session recovery after browser or device interruption
- Clear degraded-mode behavior when optional integrations fail

### Performance

- Fast initial app connect
- Responsive approval modals
- Low-friction switching between accounts and workspaces
- Efficient policy evaluation for common flows

### Usability

- Retail users should complete onboarding and first signed action with low friction
- Enterprise users should navigate roles, queues, and policy views without training-heavy workflows
- Admin and audit surfaces should use clear business language rather than crypto jargon

## 12. Success Metrics

### Personal Metrics

- onboarding completion rate
- first successful connect rate
- first successful signed action rate
- recovery success rate
- weekly active wallet users

### Ecosystem Metrics

- first-party app compatibility rate
- percentage of app sessions using Aethelred Wallet vs incumbent wallets
- support-ticket rate for connect and signing issues

### Enterprise Metrics

- number of enterprise workspaces
- approval flow completion rate
- policy coverage rate for sensitive actions
- audit export usage

### Sovereign Metrics

- pilot deployment count
- successful isolated environment deployments
- high-assurance custody adoption rate
- evidence package completeness for regulated reviews

## 13. Risks and Failure Modes

### Strategic Risks

- building a broad consumer wallet without an enterprise moat
- over-scoping the product into an unshippable trust platform
- delaying compatibility and losing developer adoption

### Product Risks

- complex role and policy UX overwhelming users
- approval surfaces becoming too technical
- app runtime introducing security and governance risk

### Technical Risks

- inconsistent behavior across EVM and Cosmos-style flows
- hardware and WalletConnect integration complexity
- future sovereign deployment requirements forcing redesign

## 14. Phased Roadmap

### Phase 0: Compatibility and Trust Kernel

Timing: 0-3 months

Deliver:

- Aethelred Connect layer
- compatibility with incumbent wallets used by first-party apps
- provider conformance and wallet integration test suite
- core signing and account abstraction layer
- initial activity and session logging

Exit criteria:

- all first-party Aethelred apps can be used reliably with supported incumbent wallets
- wallet compatibility issues are measurable and testable

### Phase 1: Aethelred Wallet Personal / Pro

Timing: 3-9 months

Deliver:

- browser extension
- mobile app
- passkey onboarding
- hardware wallet support
- simulation and warnings
- session controls
- recovery
- staking, governance, and app connect experience

Exit criteria:

- internal teams and design partners can use Aethelred Wallet as the preferred first-party wallet
- wallet quality is strong enough for broader controlled launch

### Phase 2: Enterprise Mode

Timing: 9-15 months

Deliver:

- workspaces and teams
- roles and delegated authority
- vaults
- policy engine surface
- approval queues
- spend limits
- audit and evidence exports
- admin console
- private app catalogs

Exit criteria:

- at least two design partners can operate meaningful treasury or workflow activity using enterprise controls

### Phase 3: Sovereign Mode and App Platform

Timing: 15-18 months

Deliver:

- dedicated deployment variants
- advanced custody integrations
- sovereign policy controls
- restricted app catalogs
- service and agent wallets
- evidence-grade operational views

Exit criteria:

- at least one sovereign or equivalent high-assurance pilot can run in a controlled deployment model

## 15. Build vs Partner Product Guidance

### Build Internally

- identity model
- organization and workspace model
- policy engine experience
- approval UX and workflow layer
- audit and evidence model
- app runtime and permission model
- admin console
- Aethelred Wallet brand and user experience

### Partner or Integrate

- WalletConnect
- hardware wallets
- selected custody and MPC infrastructure
- fiat rails and selected liquidity rails
- selected embedded-wallet or relay components where needed for speed

### Support as Compatibility Targets

- MetaMask
- Keplr
- Ledger
- WalletConnect ecosystem wallets

## 16. Open Questions

- Which buyer should be the first design-partner anchor: enterprise treasury, validator operations, or sovereign administration?
- Which sovereign deployment constraints are mandatory in the first 18 months versus later?
- How much embedded-wallet infrastructure should Aethelred own versus rent early on?
- Which app domains should ship in the curated catalog first?

## 17. Final Product Position

Aethelred Wallet should be positioned as:

"The secure trust and application platform for Aethelred: simple enough for users, strong enough for institutions, and deployable enough for sovereign systems."
