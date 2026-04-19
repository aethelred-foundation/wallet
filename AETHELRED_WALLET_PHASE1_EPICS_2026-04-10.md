# Aethelred Wallet Phase 1 Epics

Date: 2026-04-10
Status: Local execution draft
Scope: Weeks 14-39
Related:

- `wallet/AETHELRED_WALLET_WEEK_BY_WEEK_PLAN_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE1_TICKETS_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE1_DELIVERY_BOARD_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE1_ALPHA_AND_PARTNER_PLAN_2026-04-10.md`

## 1. Purpose

This document turns `Phase 1: Aethelred Wallet Personal / Pro` into execution-ready epics.

Phase 1 goal:

- make Aethelred Wallet the preferred first-party wallet for internal teams
- convert the Phase 0 compatibility shell into a real product experience
- deliver personal and pro wallet flows without losing enterprise and sovereign architectural integrity
- prepare the product for controlled design-partner use

## 2. Phase 1 Success Definition

Phase 1 is successful only if:

- the extension is usable end to end for first-party flows
- internal teams prefer Aethelred Wallet over incumbent wallets for targeted use cases
- session, approval, and safety UX feel product-grade rather than prototype-grade
- mobile direction is credible and started
- design-partner onboarding is ready for controlled launch

## 3. Epic List

### `WLT-P1-E01` Personal / Pro Product Scope and UX Foundation

Primary owner:
`Program lead`

Supporting owners:

- `Design lead`
- `Client lead`

Weeks:
`14-18`

Objective:
Lock the Personal / Pro product shape, core user journeys, and UI information architecture before the team starts polishing disconnected surfaces.

Key outcomes:

- Personal and Pro scope is explicit
- alpha journeys are locked
- popup and settings IA are stable
- connect, sign, and account flows have one design language

### `WLT-P1-E02` Onboarding, Identity, and Recovery Experience

Primary owner:
`Design lead`

Supporting owners:

- `Client lead`
- `Wallet core lead`
- `Security lead`

Weeks:
`16-28`

Objective:
Define and implement onboarding, import, passkeys, and recovery flows that are clean enough for broad use and safe enough for a trust-first product.

Key outcomes:

- account creation and import paths exist
- passkey strategy is locked and started
- recovery design and v0 implementation exist

### `WLT-P1-E03` Connect, Sessions, and Permission Controls

Primary owner:
`Connect lead`

Supporting owners:

- `Client lead`
- `Platform lead`

Weeks:
`18-23`

Objective:
Make app connection and session control feel intentional, readable, and reliable across first-party experiences.

Key outcomes:

- connect flow is productized
- session grants are visible
- permission controls and revoke flows exist
- first-party connect behavior is stable

### `WLT-P1-E04` Approvals, Simulation, and Safety Experience

Primary owner:
`Client lead`

Supporting owners:

- `Design lead`
- `Platform lead`
- `Security lead`

Weeks:
`19-22`

Objective:
Turn signing from a technical confirmation step into a differentiated trust experience.

Key outcomes:

- message signing is human-readable
- transaction approval includes trust, impact, and policy context
- simulation and warnings v0 exist

### `WLT-P1-E05` Personal / Pro Account Surfaces and Core Utility

Primary owner:
`Client lead`

Supporting owners:

- `Product lead`
- `Platform lead`

Weeks:
`23-28`

Objective:
Build the everyday wallet surfaces that make Personal / Pro useful beyond connection and signing.

Key outcomes:

- account management is usable
- activity and notification surfaces exist
- contacts and trusted destinations exist
- governance and staking product surfaces are defined

### `WLT-P1-E06` High-Assurance and Multi-Surface Expansion

Primary owner:
`Wallet core lead`

Supporting owners:

- `Connect lead`
- `Client lead`
- `Security lead`

Weeks:
`29-33`

Objective:
Push the wallet beyond a browser shell through hardware support, mobile architecture, and cross-device connection planning.

Key outcomes:

- hardware wallet strategy and prototype exist
- mobile architecture and shell v0 exist
- WalletConnect path is defined and proven at prototype level

### `WLT-P1-E07` App Catalog, Discovery, and Wallet Shell Quality

Primary owner:
`Product lead`

Supporting owners:

- `Design lead`
- `Client lead`
- `Connect lead`

Weeks:
`34-37`

Objective:
Make the wallet start behaving like an application shell rather than a narrow signer.

Key outcomes:

- first-party catalog basics exist
- app trust states are visible
- telemetry and diagnostics exist
- internal alpha is supportable

### `WLT-P1-E08` Internal Alpha, Feedback, and Design-Partner Readiness

Primary owner:
`Program lead`

Supporting owners:

- all leads

Weeks:
`35-39`

Objective:
Convert the work into a controlled internal alpha, then prepare the product and team for external design-partner use.

Key outcomes:

- alpha telemetry and support runbooks exist
- internal teams use the wallet in controlled flows
- alpha issues are burned down
- partner onboarding pack exists
- Phase 1 exit is evidence-based

## 4. Epic Dependency Map

- `E01` must settle before the team deepens UI polish.
- `E02` depends on stable product direction from `E01`.
- `E03` builds on Phase 0 connect and session foundations.
- `E04` depends on `E03` and the Phase 0 policy and audit models.
- `E05` depends on `E01`, `E03`, and `E04`.
- `E06` depends on stable account and signing behavior from `E02` to `E05`.
- `E07` depends on a wallet shell that is already coherent.
- `E08` depends on every epic producing reviewable artifacts, telemetry, and usable flows.

## 5. Phase 1 Exit Conditions

Phase 1 is complete only if:

- the extension is accepted as the preferred internal first-party wallet for scoped flows
- connect, sign, session, and approval experiences are stable enough for controlled external use
- recovery, hardware, and mobile direction are credible and not deferred ambiguities
- internal alpha supportability is in place
- design-partner entry can happen without improvisation
