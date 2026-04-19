# Aethelred Wallet Architecture RFC

Date: 2026-04-10
Status: Draft for architecture review
Owner: Wallet architecture group
Related: `wallet/AETHELRED_WALLET_PRD_2026-04-10.md`

## 1. Summary

This RFC proposes the architecture for Aethelred Wallet as a multi-mode trust platform with wallet interfaces.

The architecture is designed to satisfy three simultaneous realities:

1. Aethelred must work with incumbent wallet standards and ecosystems.
2. Aethelred must support sovereign, institutional, and regulated operational models.
3. Aethelred must be pleasant enough for broad user adoption and app connectivity.

The architecture therefore separates:

- compatibility interfaces
- trust and signing kernel
- identity and organizational model
- policy and approvals
- app runtime
- control plane
- deployment model

## 2. Context

### 2.1 Repo Reality

The current repo requires more than one wallet style:

- EVM-style provider flows for `Cruzible`, `ZeroID`, and `TerraQura`
- Cosmos-style signing and bech32-compatible flows in `Shiora` and some backend auth paths
- policy-heavy and approval-heavy operating assumptions across standards and compliance docs

This means the architecture cannot assume one narrow wallet protocol or one narrow account model.

### 2.2 Product Decision

Per the decision memo, Aethelred should launch in stages, but the foundation must already support:

- organizations
- policy
- evidence and audit
- multiple deployment tiers
- service and agent identities

## 3. Goals

- Provide one Aethelred wallet core with multiple assurance modes
- Support first-party apps through standards-compatible interfaces
- Preserve room for enterprise and sovereign controls without redesign
- Enable app-of-apps experiences without exposing raw keys to apps
- Support multiple custody patterns
- Make approvals and policy evaluation first-class

## 4. Non-Goals

- Rebuilding every external wallet protocol from scratch
- Launching a full sovereign deployment stack in v1
- Shipping every institutional custody integration in the first phase
- Replacing all incumbent wallets immediately

## 5. Architecture Principles

### 5.1 Core Before Surface

The trust model, account model, organization model, and policy model must be settled before adding surface-level features.

### 5.2 Intent Over Raw Signing

Applications should request intents.

The wallet should translate intents into:

- identity checks
- policy checks
- simulation
- approval routing
- signing
- logging

### 5.3 Separation of Trust Domains

UI, policy, signing, audit, and control-plane concerns must be separable and independently reviewable.

### 5.4 Compatibility as an Adapter Layer

External wallet interfaces should be implemented as adapters to the Aethelred core, not as the core itself.

### 5.5 Deployment-Aware Design

Cloud, dedicated, sovereign, and offline variants should share the same logical model wherever possible.

## 6. System Overview

Core logical layers:

1. Compatibility Layer
2. Trust Kernel
3. Identity and Workspace Layer
4. Policy and Approval Layer
5. App Runtime Layer
6. Audit and Evidence Layer
7. Control Plane
8. Deployment and Operations Layer

## 7. Major Components

### 7.1 Aethelred Connect

Purpose:

- provide standards-compatible wallet interfaces to apps
- normalize app requests into wallet intents

Responsibilities:

- EIP-1193 provider behavior
- EIP-6963 discovery behavior
- WalletConnect integration
- Cosmos-style compatibility adapter where required
- mobile deep-link and QR connection support

Own vs partner:

- own interface normalization and provider behavior
- integrate WalletConnect rather than reimplementing its network

### 7.2 Trust Kernel

Purpose:

- own keys, signing decisions, account abstractions, and cryptographic operations

Responsibilities:

- key slot management
- local secure storage and hardware-backed storage where available
- custody abstraction
- signing policies at the cryptographic boundary
- transaction and message signing
- future support for HSM, MPC, and offline flows

Notes:

This is the most security-sensitive component and should have the narrowest possible API.

### 7.3 Account and Custody Orchestrator

Purpose:

- map one Aethelred profile to multiple usable account forms

Responsibilities:

- account registry
- execution-environment mapping
- hardware account linkage
- imported account linkage
- smart-account or delegated-account overlays
- workspace-linked account assignment

This layer allows the same product to support:

- self-custody
- assisted custody
- shared custody
- enterprise custody
- future sovereign custody

### 7.4 Identity and Workspace Layer

Purpose:

- model who is acting and on whose behalf

Core entities:

- subject
- person
- organization
- workspace
- role
- credential
- service identity
- agent identity

Responsibilities:

- subject registry
- organization and workspace membership
- role assignment
- delegated authority
- credential attachment and verification hooks

### 7.5 Policy Engine

Purpose:

- decide whether and how actions are allowed

Policy inputs:

- subject and role
- workspace
- app identity
- session state
- asset and account
- destination or counterparty
- transaction class
- credential state
- device posture
- deployment context

Policy outcomes:

- allow
- deny
- require warning
- require approval
- require dual control
- require committee
- escalate

### 7.6 Approval Workflow Service

Purpose:

- route actions requiring human or organizational approval

Responsibilities:

- approval request creation
- reviewer selection
- queueing and notifications
- quorum handling
- expiry and escalation
- evidence capture

### 7.7 Simulation and Risk Service

Purpose:

- convert opaque requests into understandable risk views

Responsibilities:

- transaction simulation
- expected balance and permission changes
- contract trust hints
- policy impact preview
- suspicious-request detection

This service is where Aethelred should borrow heavily from Rabby-style safety UX, while extending it into policy and regulated context.

### 7.8 App Runtime and App Catalog

Purpose:

- turn the wallet into a secure application shell

Responsibilities:

- app manifest model
- app permissions
- intent schemas
- app trust states
- curated public catalog
- private enterprise catalog
- private sovereign catalog

Rules:

- apps do not get raw key access
- apps must declare required intents and permissions
- app distribution must be governed by deployment and workspace policy

### 7.9 Audit and Evidence Pipeline

Purpose:

- capture a full evidence record of actions, policies, and approvals

Responsibilities:

- event capture
- immutable or tamper-evident sequencing
- export views
- evidence packages
- approval lineage
- app and session history

Audit data should capture:

- subject
- acting workspace
- app
- session
- request summary
- policy decision
- simulation result
- approvers
- signature event
- export trace

### 7.10 Admin Control Plane

Purpose:

- manage organizations, policy, deployments, and app catalogs

Responsibilities:

- workspace management
- role administration
- policy authoring and publishing
- app catalog administration
- audit and export administration
- deployment configuration

### 7.11 Deployment Manager

Purpose:

- adapt the same architecture to multiple trust environments

Responsibilities:

- feature gating by tier
- control-plane topology
- custody backend selection
- network restrictions
- app catalog isolation
- key residency configuration

## 8. Logical Data Model

### Core Objects

- `Subject`
- `Workspace`
- `RoleAssignment`
- `WalletProfile`
- `AccountHandle`
- `KeySlot`
- `CredentialRecord`
- `PolicyBundle`
- `PolicyDecision`
- `ApprovalRequest`
- `ApprovalDecision`
- `SessionGrant`
- `AppManifest`
- `AppInstallation`
- `DeploymentProfile`
- `EvidenceRecord`

### Important Relationships

- a subject may belong to multiple workspaces
- a workspace may own multiple accounts and vaults
- a role assignment determines default permissions within a workspace
- a policy bundle may apply globally, per workspace, per app, or per account
- an approval request may require one or more subject decisions
- an app installation inherits permissions and restrictions from workspace and deployment policy

## 9. Deployment Tiers

### Tier 1: Shared Managed Cloud

Target:

- consumers
- startups
- developer ecosystems

Characteristics:

- managed updates
- standard telemetry
- public app catalog
- default security controls

### Tier 2: Dedicated Managed Tenant

Target:

- regulated enterprises
- design partners
- high-value institutional operators

Characteristics:

- tenant isolation
- private app catalog
- policy administration
- stronger audit retention options

### Tier 3: Sovereign Cloud

Target:

- ministries
- public institutions
- critical regulated sectors

Characteristics:

- regional hosting control
- deployment-specific controls
- restricted distribution boundaries
- stronger residency and admin requirements

### Tier 4: Self-Hosted / On-Prem

Target:

- highly regulated institutions
- defense-adjacent or critical infrastructure operators

Characteristics:

- self-operated control plane
- selectable custody backends
- isolated app distribution
- custom integration surface

### Tier 5: Air-Gapped / High-Assurance Signing

Target:

- top-tier sovereign and institutional operations

Characteristics:

- restricted network exposure
- offline approval or signing support
- HSM and manual-approval integration paths

## 10. Build vs Partner vs Support Matrix

| Subsystem | Strategy | Rationale |
|---|---|---|
| Identity model | Build | Core differentiation and policy dependency |
| Workspace and role model | Build | Core enterprise and sovereign control plane |
| Policy engine | Build | Primary moat |
| Approval workflows | Build | Directly tied to policy and trust experience |
| Audit and evidence model | Build | Required for regulated and sovereign trust |
| App runtime and permission model | Build | Defines the app-of-apps platform |
| Provider normalization layer | Build | Needed to unify all wallet interfaces |
| WalletConnect transport and ecosystem support | Partner / integrate | Industry network effect is already established |
| Hardware wallet support | Integrate | Must-support assurance path, not worth reinventing |
| Fiat and swap rails | Partner selectively | Commodity capability relative to Aethelred moat |
| MPC backend | Partner initially, abstract internally | Useful later, high implementation complexity |
| HSM integrations | Partner / integrate | Specialized infrastructure best exposed through adapters |
| Smart-account infrastructure | Mix | Own user experience and policy layer; selectively adopt mature underlying patterns |
| App catalog review and distribution logic | Build | Central to trust and deployment model |
| Sovereign deployment automation | Build incrementally | Must align with Aethelred-specific control requirements |

## 11. Compatibility Plan for Current Aethelred Apps

### EVM-Style Apps

Targets:

- `Cruzible`
- `ZeroID`
- `TerraQura`

Requirements:

- provider compatibility
- chain switching
- session management
- transaction signing
- clear account visibility

### Cosmos-Style or Native-Signing Apps

Targets:

- `Shiora`
- backend flows that verify Cosmos-style signatures today

Requirements:

- compatibility adapter for Cosmos-style signing
- address and identity normalization
- migration path toward a cleaner Aethelred-native signing story

### Migration Rule

No first-party app should remain tightly coupled to one external wallet brand.

All first-party apps should converge on Aethelred Connect.

## 12. Security and Trust Boundaries

### Boundary A: App to Wallet

Risk:

- malicious or malformed requests

Mitigation:

- intent schemas
- app manifests
- permission grants
- request validation
- simulation

### Boundary B: Wallet UI to Policy Layer

Risk:

- bypassing or misrepresenting policy state

Mitigation:

- signed policy bundles
- deterministic policy evaluation
- event capture

### Boundary C: Policy Layer to Trust Kernel

Risk:

- direct signing without proper authorization

Mitigation:

- narrow signing API
- authorization tokens with bounded scope
- approval and policy preconditions

### Boundary D: Control Plane to Deployment

Risk:

- tenant or environment crossover

Mitigation:

- deployment profiles
- catalog isolation
- environment-aware configuration

## 13. Phased Implementation

### Phase 0

Focus:

- compatibility layer
- trust kernel skeleton
- account orchestration foundation
- wallet integration test suite

### Phase 1

Focus:

- extension and mobile
- personal/pro UX
- simulation
- recovery
- hardware support
- app catalog basics

### Phase 2

Focus:

- workspaces
- roles
- policy authoring
- approval routing
- audit exports
- admin console

### Phase 3

Focus:

- dedicated deployment tiers
- sovereign catalog isolation
- service and agent identities
- advanced custody integrations

## 14. Trade-Offs

### Trade-Off 1: Speed vs Future-Proofing

Decision:

Ship compatibility early, but do not compromise the underlying account and policy model.

### Trade-Off 2: Own Everything vs Integrate Mature Systems

Decision:

Own the differentiating trust and control layers.
Integrate mature commodity rails where they reduce time-to-market without giving away the moat.

### Trade-Off 3: Consumer Polish vs Enterprise Depth

Decision:

Use one architecture with different experience layers rather than separate products.

## 15. Rejected Alternatives

### White-Label Wallet Only

Rejected because:

- weak strategic control
- weak policy differentiation
- limited long-term moat

### Consumer-Only Wallet

Rejected because:

- misaligned with Aethelred strategy
- creates later redesign costs

### Big-Bang Sovereign Trust OS Launch

Rejected because:

- too much scope
- excessive delivery risk
- difficult validation path

## 16. Open Questions

- Which credential formats should be first-class in the initial identity model?
- What level of service and agent wallet support is required in the first 12 months?
- Which deployment controls are mandatory for the first sovereign pilot?
- Which existing first-party app should become the reference implementation for Aethelred Connect first?

## 17. Proposed Decision

Adopt this architecture direction and proceed to:

1. interface specification for Aethelred Connect
2. trust-kernel technical design
3. workspace and policy domain model
4. compatibility test plan for first-party apps
