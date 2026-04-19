# Aethelred Wallet Phase 3 Epics

Date: 2026-04-11
Status: Local execution draft
Scope: Weeks 66-78
Related:

- `wallet/AETHELRED_WALLET_WEEK_BY_WEEK_PLAN_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE3_TICKETS_2026-04-11.md`
- `wallet/AETHELRED_WALLET_PHASE3_DELIVERY_BOARD_2026-04-11.md`
- `wallet/AETHELRED_WALLET_PHASE3_SOVEREIGN_PILOT_PLAN_2026-04-11.md`

## 1. Purpose

This document turns `Phase 3: Sovereign Mode and App Platform` into execution-ready epics.

Phase 3 goal:

- extend the wallet into sovereign-grade deployment and control models
- deliver isolation, residency, higher-assurance approvals, and restricted app distribution
- introduce service and agent identities as first-class controlled actors
- complete the program with a sovereign or equivalent high-assurance pilot in a controlled environment

## 2. Phase 3 Success Definition

Phase 3 is successful only if:

- dedicated deployment profiles are credible and well-defined
- sovereign policy controls can express jurisdictional and mission-specific constraints
- service and agent identities are usable under scoped permissions
- restricted catalogs and environment isolation work as designed
- at least one sovereign or equivalent high-assurance pilot runs in a controlled deployment model

## 3. Epic List

### `WLT-P3-E01` Sovereign Scope, Deployment Constraints, and Pilot Success Model

Primary owner:
`Program lead`

Supporting owners:

- `Product lead`
- `Security lead`

Weeks:
`66-67`

Objective:
Lock the sovereign scope, deployment assumptions, and pilot success model before implementation fragments into disconnected control ideas.

Key outcomes:

- sovereign scope is explicit
- pilot constraints are named
- deployment and assurance assumptions are aligned

### `WLT-P3-E02` Dedicated Deployment Profiles, Isolation, and Residency

Primary owner:
`Platform lead`

Supporting owners:

- `Wallet core lead`
- `Security lead`

Weeks:
`67-73`

Objective:
Define and implement the deployment-aware foundations that distinguish sovereign mode from enterprise mode.

Key outcomes:

- dedicated deployment profiles exist
- tenant and environment isolation are enforceable
- key residency and custody abstractions are explicit

### `WLT-P3-E03` Sovereign Policy Controls and High-Assurance Approval Modes

Primary owner:
`Platform lead`

Supporting owners:

- `Security lead`
- `Design lead`
- `Client lead`

Weeks:
`70-72`

Objective:
Raise the assurance level of the wallet through stronger approval modes and sovereign-specific policy controls.

Key outcomes:

- high-assurance approval modes exist
- sovereign policy constraints are usable
- restricted actions can be governed by deployment and mission profile

### `WLT-P3-E04` Service and Agent Identities

Primary owner:
`Platform lead`

Supporting owners:

- `Connect lead`
- `Security lead`
- `Wallet core lead`

Weeks:
`71-72`

Objective:
Make non-human actors first-class, auditable wallet participants under controlled identity and permission rules.

Key outcomes:

- service identities exist
- agent permissions are scoped and revocable
- audit visibility for non-human actors exists

### `WLT-P3-E05` Sovereign App Catalogs and Controlled Distribution

Primary owner:
`Product lead`

Supporting owners:

- `Client lead`
- `Connect lead`
- `Platform lead`

Weeks:
`68-75`

Objective:
Transform the app-of-apps model into a sovereign-grade controlled distribution system.

Key outcomes:

- sovereign catalog model exists
- environment-scoped app visibility works
- restricted app distribution is pilot-ready

### `WLT-P3-E06` Evidence-Grade Operational Views and Control Reporting

Primary owner:
`Platform lead`

Supporting owners:

- `Client lead`
- `Program lead`

Weeks:
`74-75`

Objective:
Provide the operational and evidentiary surfaces needed for high-assurance review and controlled deployment conversations.

Key outcomes:

- evidence-grade operational views exist
- stronger control reports exist
- review artifacts are usable in regulated or sovereign conversations

### `WLT-P3-E07` Sovereign Pilot Rehearsal, Launch, and Program Exit

Primary owner:
`Program lead`

Supporting owners:

- all leads

Weeks:
`76-78`

Objective:
Rehearse, launch, and review the first sovereign or equivalent high-assurance pilot with discipline and evidence.

Key outcomes:

- pilot rehearsal succeeds
- pilot launch happens in controlled form
- program exit and next-horizon plan are evidence-based

## 4. Epic Dependency Map

- `E01` must settle the pilot and deployment assumptions before the rest of Phase 3 deepens.
- `E02` underpins `E03`, `E05`, and `E06`.
- `E03` and `E04` must align because high-assurance approvals and non-human identities create shared trust questions.
- `E05` depends on `E02` to avoid a catalog model with weak isolation.
- `E06` depends on the combined outputs of `E02`, `E03`, and `E04`.
- `E07` depends on every previous epic producing pilot-ready outputs.

## 5. Phase 3 Exit Conditions

Phase 3 is complete only if:

- sovereign deployment assumptions are embodied in real product and architecture artifacts
- isolation, residency, and restricted distribution are credible in a controlled environment
- service and agent identities are governed and auditable
- evidence-grade review artifacts are ready for high-assurance use
- at least one sovereign or equivalent high-assurance pilot has been executed in controlled form
