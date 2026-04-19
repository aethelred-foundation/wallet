# Aethelred Wallet Phase 2 Epics

Date: 2026-04-11
Status: Local execution draft
Scope: Weeks 40-65
Related:

- `wallet/AETHELRED_WALLET_WEEK_BY_WEEK_PLAN_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE2_TICKETS_2026-04-11.md`
- `wallet/AETHELRED_WALLET_PHASE2_DELIVERY_BOARD_2026-04-11.md`
- `wallet/AETHELRED_WALLET_PHASE2_ENTERPRISE_BETA_AND_PARTNER_PLAN_2026-04-11.md`

## 1. Purpose

This document turns `Phase 2: Enterprise Mode` into execution-ready epics.

Phase 2 goal:

- transform the wallet from a strong personal or pro experience into an enterprise operating product
- deliver teams, workspaces, approvals, policy, vaults, and audit exports as real product surfaces
- validate enterprise workflows with at least two design partners
- finish the phase with enterprise controls credible enough to support meaningful treasury or workflow activity

## 2. Phase 2 Success Definition

Phase 2 is successful only if:

- workspaces and teams are real product primitives
- policy and approval systems can govern sensitive enterprise actions
- audit and evidence outputs are usable in compliance or control conversations
- enterprise admin surfaces are coherent enough for real operators
- at least two design partners can run meaningful activity using enterprise controls

## 3. Epic List

### `WLT-P2-E01` Enterprise Scope, Buyer Flows, and Success Model

Primary owner:
`Program lead`

Supporting owners:

- `Product lead`
- `Design lead`

Weeks:
`40-42`

Objective:
Lock the enterprise scope, buyer jobs, and success model before the team starts adding controls without a clear operating picture.

Key outcomes:

- enterprise success definition is explicit
- target buyer workflows are chosen
- workspace, vault, and control assumptions are aligned

### `WLT-P2-E02` Workspaces, Teams, Vaults, and Delegated Authority

Primary owner:
`Platform lead`

Supporting owners:

- `Client lead`
- `Wallet core lead`

Weeks:
`41-49`

Objective:
Make organizations, workspaces, roles, vaults, and delegated authority into first-class operating constructs.

Key outcomes:

- enterprise workspace model is live
- teams, roles, and delegated authority exist
- vaults and sub-accounts exist in product and model form

### `WLT-P2-E03` Policy Engine, Spend Controls, and Approval Routing

Primary owner:
`Platform lead`

Supporting owners:

- `Security lead`
- `Design lead`
- `Client lead`

Weeks:
`43-55`

Objective:
Turn the wallet into a policy-governed execution environment rather than a personal signer with extra screens.

Key outcomes:

- approval workflow engine exists
- policy outcomes and templates are usable
- spend controls and allowlists exist
- dual control and committee approvals are real

### `WLT-P2-E04` Audit, Evidence, Reporting, and Operational Visibility

Primary owner:
`Platform lead`

Supporting owners:

- `Program lead`
- `Client lead`

Weeks:
`47-60`

Objective:
Make enterprise activity traceable, reviewable, exportable, and measurable.

Key outcomes:

- audit persistence is reliable
- evidence export v1 exists
- reporting and analytics exist
- compliance-oriented views are usable

### `WLT-P2-E05` Enterprise UX Shell and Admin Console

Primary owner:
`Client lead`

Supporting owners:

- `Design lead`
- `Product lead`
- `Platform lead`

Weeks:
`46-56`

Objective:
Present enterprise complexity in a product that operators can actually use without training-heavy failure.

Key outcomes:

- workspace switcher and queue views exist
- reviewer experiences exist
- compliance review surfaces exist
- admin console v1 exists

### `WLT-P2-E06` Private App Catalogs, Mobile Priorities, and Enterprise Operations

Primary owner:
`Product lead`

Supporting owners:

- `Connect lead`
- `Client lead`
- `Program lead`

Weeks:
`51-61`

Objective:
Extend the wallet into a controlled enterprise app shell while preparing for real operational use across surfaces.

Key outcomes:

- private app catalog v0 exists
- enterprise mobile priorities are explicit
- operational alerting and resilience assumptions are defined
- institutional custody integration path is credible

### `WLT-P2-E07` Design Partners, Enterprise Beta, and Phase Exit

Primary owner:
`Program lead`

Supporting owners:

- all leads

Weeks:
`52-65`

Objective:
Validate enterprise mode through real design partners, harden the product through beta, and close Phase 2 with evidence rather than optimism.

Key outcomes:

- design partner 1 and 2 are onboarded
- enterprise beta stabilizes
- partner remediation is visible
- Phase 2 exit is evidence-based

## 4. Epic Dependency Map

- `E01` must lock target enterprise jobs before `E02` to `E05` deepen implementation.
- `E02` must mature before `E03` can govern the correct operating entities.
- `E03` and `E04` must mature together because approvals without evidence are not enterprise-grade.
- `E05` depends on `E02` and `E03` to avoid UI shells with weak underlying semantics.
- `E06` depends on stable enterprise constructs from `E02` to `E05`.
- `E07` depends on the combined readiness of the previous epics.

## 5. Phase 2 Exit Conditions

Phase 2 is complete only if:

- enterprise workspaces, roles, approvals, and policy are productized
- audit and evidence exports are usable with design partners
- at least two design partners have operated meaningful flows
- beta stability is strong enough that enterprise mode is not just a concept demo
- the team can enter Phase 3 without reopening enterprise foundations
