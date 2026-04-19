# Aethelred Wallet Phase 0 Epics

Date: 2026-04-10
Status: Local execution draft
Scope: Weeks 1-13
Related:

- `wallet/AETHELRED_WALLET_WEEK_BY_WEEK_PLAN_2026-04-10.md`
- `wallet/AETHELRED_WALLET_SPRINT0_BACKLOG_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE0_TICKETS_2026-04-10.md`

## 1. Purpose

This document turns `Phase 0` into execution-ready epics for the wallet leads.

Phase 0 goal:

- make compatibility measurable
- establish the trust kernel foundation
- prove the extension request and approval loop
- leave Phase 0 with an architecture the rest of the roadmap can safely build on

## 2. Lead Roles

- `Program lead`
- `Client lead`
- `Connect lead`
- `Wallet core lead`
- `Platform lead`
- `Design lead`
- `Security lead`
- `App liaison` for each first-party target

## 3. Epic List

### `WLT-P0-E01` Program Governance and Delivery Control

Primary owner:
`Program lead`

Supporting owners:

- `Design lead`
- `Security lead`
- all workstream leads

Weeks:
`1-13`

Objective:
Create the operating system for the program so architecture, demos, risk, and decisions do not drift.

Key outcomes:

- weekly architecture, product, and security cadence is running
- decision log is maintained
- risk register is visible
- milestone and exit reviews happen on time

Success signal:
The team can explain what is being built, who owns each part, what is blocked, and what changed since last week without confusion.

Included ticket themes:

- kickoff and ownership assignment
- weekly demo and review cadence
- decision log and ADR practice
- milestone reviews
- Phase 0 exit and Phase 1 handoff

### `WLT-P0-E02` Aethelred Connect Contracts and Provider Surface

Primary owner:
`Connect lead`

Supporting owners:

- `Client lead`
- `Wallet core lead`
- `App liaisons`

Weeks:
`1-8`

Objective:
Define and implement the compatibility adapter surface for first-party app connections.

Key outcomes:

- provider contract exists
- request lifecycle is documented and testable
- discovery behavior is defined
- at least one first-party EVM-style integration path is executable

Success signal:
The connect surface is stable enough that app teams can integrate against it without guessing provider behavior.

Included ticket themes:

- EIP-1193 provider contract
- EIP-6963 discovery behavior
- request and session lifecycle
- compatibility checklist
- provider conformance harness

### `WLT-P0-E03` Trust Kernel and Secure Storage Foundation

Primary owner:
`Wallet core lead`

Supporting owners:

- `Security lead`
- `Platform lead`

Weeks:
`2-10`

Objective:
Establish the security-sensitive core around signing, key storage, account orchestration, and signer interfaces.

Key outcomes:

- no-key-leak rules are defined
- signer boundary is settled
- key slot model exists
- secure storage prototype exists
- sign message and sign transaction interfaces are defined

Success signal:
The team can point to a clear trust boundary and explain exactly which layer may hold, request, or execute signing operations.

Included ticket themes:

- signer boundary
- key slots and account handles
- local secure storage prototype
- signer interfaces
- security review of the prototype

### `WLT-P0-E04` Identity, Workspace, Policy, Approval, and Audit Foundation

Primary owner:
`Platform lead`

Supporting owners:

- `Product lead`
- `Design lead`
- `Security lead`

Weeks:
`2-10`

Objective:
Define the domain model that keeps the wallet enterprise-ready and sovereign-capable from day one.

Key outcomes:

- subject and workspace model exists
- policy objects and outcomes exist
- approval requests and routing model exist
- audit event schema exists
- session grant model exists

Success signal:
Every request can be described in terms of who acts, for which workspace, under which policy, with which approval, and what evidence is recorded.

Included ticket themes:

- account, subject, workspace, role entities
- policy bundle and decision model
- approval workflow model
- audit event schema
- session grants and activity logging

### `WLT-P0-E05` Extension Client Alpha Vertical Slice

Primary owner:
`Client lead`

Supporting owners:

- `Design lead`
- `Connect lead`
- `Platform lead`

Weeks:
`1-13`

Objective:
Build the local browser extension shell that proves Aethelred Wallet can become a real product surface.

Key outcomes:

- popup, options, background, and content surfaces exist
- mock request flow works end to end
- approval surface is visible
- account and workspace views exist
- local alpha quality improves each milestone

Success signal:
The team can demo a coherent wallet shell instead of disconnected screens and docs.

Included ticket themes:

- extension scaffold
- popup and options information architecture
- approval UX
- local demo mode
- environment indicators
- alpha hardening

### `WLT-P0-E06` Security, Threat Modeling, and Release Gates

Primary owner:
`Security lead`

Supporting owners:

- `Wallet core lead`
- `Program lead`
- `Client lead`

Weeks:
`1-13`

Objective:
Make trust and safety part of the delivery path instead of a late-phase review.

Key outcomes:

- extension threat model exists
- abuse-case library exists
- review checklists exist
- release gate criteria exist
- critical trust-boundary decisions receive explicit review

Success signal:
Security is involved before code hardens, and the team can identify the highest-risk attack surfaces in plain language.

Included ticket themes:

- threat model v0 and updates
- phishing and permission-abuse scenarios
- signer and storage review
- internal alpha gate
- Phase 0 exit security review

### `WLT-P0-E07` First-Party Compatibility and Integration Readiness

Primary owner:
`Connect lead`

Supporting owners:

- `App liaisons`
- `Client lead`
- `Program lead`

Weeks:
`7-13`

Objective:
Move from theoretical compatibility to a measured first-party integration strategy.

Key outcomes:

- first integration target is selected
- app integration matrix is finalized
- incumbent wallet gap analysis exists
- Cosmos-style compatibility direction is chosen

Success signal:
The team knows exactly which first-party flows work, which do not, and what must change next.

Included ticket themes:

- first live integration selection
- EVM integration path
- Shiora compatibility decision
- first-party compatibility matrix
- gap tracking and prioritization

### `WLT-P0-E08` Phase Exit, Internal Alpha Readiness, and Phase 1 Handoff

Primary owner:
`Program lead`

Supporting owners:

- all leads

Weeks:
`11-13`

Objective:
Close Phase 0 with accepted foundations, measurable output, and a clean handoff into Personal / Pro work.

Key outcomes:

- Phase 0 review is evidence-based
- internal alpha criteria are explicit
- Phase 1 backlog is prepared
- unresolved risks are documented instead of hidden

Success signal:
The team ends Phase 0 with confidence, not with accumulated ambiguity.

Included ticket themes:

- phase metrics and review package
- leadership walkthrough
- internal alpha readiness pack
- Phase 1 backlog handoff

## 4. Epic Dependency Map

- `E01` supports every other epic.
- `E02` depends on early direction from `E01` and interfaces with `E03` and `E05`.
- `E03` depends on decisions from `E01` and security input from `E06`.
- `E04` must begin before `E05` and `E07` solidify product behavior.
- `E05` depends on `E02`, `E03`, and `E04`.
- `E06` reviews `E02`, `E03`, `E04`, and `E05` continuously.
- `E07` depends on `E02`, `E03`, and `E05`.
- `E08` depends on accepted outputs from all previous epics.

## 5. Epic Exit Conditions

Phase 0 is complete only if:

- `E02` delivers a stable connect surface and measurable compatibility work
- `E03` delivers a reviewed trust-kernel direction and secure storage prototype
- `E04` delivers shared domain models for workspace, policy, approval, and audit
- `E05` delivers a demoable extension vertical slice
- `E06` delivers a reviewed threat model and release gates
- `E07` delivers a first-party compatibility matrix and chosen Cosmos direction
- `E08` delivers a real Phase 1 handoff
