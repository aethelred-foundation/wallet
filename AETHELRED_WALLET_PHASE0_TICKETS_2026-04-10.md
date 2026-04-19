# Aethelred Wallet Phase 0 Tickets

Date: 2026-04-10
Status: Local execution backlog
Scope: Weeks 1-13
Related:

- `wallet/AETHELRED_WALLET_PHASE0_EPICS_2026-04-10.md`
- `wallet/AETHELRED_WALLET_WEEK_BY_WEEK_PLAN_2026-04-10.md`
- `wallet/DECISION_LOG.md`

## 1. How To Use This Backlog

- Each week has a target outcome.
- Each ticket is written so a lead can assign it immediately.
- Acceptance criteria should be treated as the minimum definition of done.
- If a ticket slips, update the week plan explicitly instead of carrying silent debt.

## 2. Week 1

Target outcome:
The wallet program is officially running with named owners, a shared operating cadence, and initial target apps shortlisted.

### `WLT-P0-101` Create the wallet war-room and ownership map

- Owner: `Program lead`
- Epic: `WLT-P0-E01`
- Depends on: none
- Acceptance criteria:
  - named owners exist for Program, Client, Connect, Wallet Core, Platform, Design, and Security
  - the local `wallet/` workspace is declared as the planning hub
  - each lead knows what they own in Phase 0

### `WLT-P0-102` Run the Phase 0 kickoff session

- Owner: `Program lead`
- Epic: `WLT-P0-E01`
- Depends on: `WLT-P0-101`
- Acceptance criteria:
  - kickoff agenda is run
  - strategic intent, phase sequence, and success criteria are reviewed
  - open questions and risks are captured

### `WLT-P0-103` Shortlist the first integration targets

- Owner: `Connect lead`
- Epic: `WLT-P0-E07`
- Depends on: `WLT-P0-102`
- Acceptance criteria:
  - one EVM-style first target is shortlisted
  - one Cosmos-style compatibility target is shortlisted
  - app liaisons are identified for each

### `WLT-P0-104` Start the decision and risk log

- Owner: `Program lead`
- Epic: `WLT-P0-E01`
- Depends on: `WLT-P0-102`
- Acceptance criteria:
  - initial decisions are written in `DECISION_LOG.md`
  - a visible risk list exists
  - weekly review cadence is scheduled

## 3. Week 2

Target outcome:
The team agrees on the initial architecture boundaries and the first domain model direction.

### `WLT-P0-201` Finalize the extension-first decision for Phase 0

- Owner: `Program lead`
- Epic: `WLT-P0-E01`
- Depends on: `WLT-P0-102`
- Acceptance criteria:
  - extension-first direction is explicit
  - mobile is positioned correctly as later Phase 1 work
  - no team is building a competing first surface

### `WLT-P0-202` Draft the trust-boundary architecture

- Owner: `Wallet core lead`
- Epic: `WLT-P0-E03`
- Depends on: `WLT-P0-201`
- Acceptance criteria:
  - UI, provider, policy, and signer boundaries are described
  - no-key-leak principles are written
  - unresolved trust questions are listed

### `WLT-P0-203` Draft the core domain model v0

- Owner: `Platform lead`
- Epic: `WLT-P0-E04`
- Depends on: `WLT-P0-201`
- Acceptance criteria:
  - entities exist for account, subject, workspace, role, policy, approval, and audit
  - product, platform, and design use the same vocabulary
  - known gaps are called out

### `WLT-P0-204` Produce the extension threat model v0

- Owner: `Security lead`
- Epic: `WLT-P0-E06`
- Depends on: `WLT-P0-202`
- Acceptance criteria:
  - key assets and trust boundaries are listed
  - top abuse paths are identified
  - review follow-ups are assigned

## 4. Week 3

Target outcome:
The `Aethelred Connect` surface is defined clearly enough for client and app integration work to proceed.

### `WLT-P0-301` Define the `Aethelred Connect` contract v0

- Owner: `Connect lead`
- Epic: `WLT-P0-E02`
- Depends on: `WLT-P0-202`, `WLT-P0-203`
- Acceptance criteria:
  - provider-facing methods are listed
  - state snapshot and request types are defined
  - client and app teams can review against one contract

### `WLT-P0-302` Map the provider request lifecycle

- Owner: `Connect lead`
- Epic: `WLT-P0-E02`
- Depends on: `WLT-P0-301`
- Acceptance criteria:
  - request stages from app to approval to signer are documented
  - failure modes are listed
  - audit hooks are identified

### `WLT-P0-303` Define wallet discovery behavior

- Owner: `Connect lead`
- Epic: `WLT-P0-E02`
- Depends on: `WLT-P0-301`
- Acceptance criteria:
  - discovery and announcement behavior is described
  - browser integration expectations are clear
  - app teams know how the wallet should appear in selection flows

### `WLT-P0-304` Define connect and approval UX flows

- Owner: `Design lead`
- Epic: `WLT-P0-E05`
- Depends on: `WLT-P0-301`, `WLT-P0-302`
- Acceptance criteria:
  - connect, sign-message, and sign-transaction flows are mapped
  - required state and copy are identified
  - client implementation can begin without guessing user flow

## 5. Week 4

Target outcome:
The signer boundary and secure-storage direction are explicit enough to start building real internals.

### `WLT-P0-401` Finalize signer boundary v1

- Owner: `Wallet core lead`
- Epic: `WLT-P0-E03`
- Depends on: `WLT-P0-202`, `WLT-P0-204`
- Acceptance criteria:
  - allowed callers into signing logic are defined
  - prohibited patterns are explicitly written
  - security lead signs off on the boundary direction

### `WLT-P0-402` Define the key-slot and account-handle model

- Owner: `Wallet core lead`
- Epic: `WLT-P0-E03`
- Depends on: `WLT-P0-401`, `WLT-P0-203`
- Acceptance criteria:
  - key slots, account handles, and account labels are modeled
  - imported and future hardware cases are considered
  - platform and client teams can consume the model

### `WLT-P0-403` Run a secure-storage options spike

- Owner: `Wallet core lead`
- Epic: `WLT-P0-E03`
- Depends on: `WLT-P0-401`
- Acceptance criteria:
  - at least two viable storage approaches are compared
  - tradeoffs are documented
  - one candidate path is recommended for prototype work

### `WLT-P0-404` Define the Phase 0 review checklist

- Owner: `Security lead`
- Epic: `WLT-P0-E06`
- Depends on: `WLT-P0-204`
- Acceptance criteria:
  - checklist exists for signing, storage, permission, and approval review
  - review cadence is attached to weeks and milestones
  - no major trust review is left implicit

## 6. Week 5

Target outcome:
The product and platform share the same policy, approval, session, and audit language.

### `WLT-P0-501` Define the policy object model

- Owner: `Platform lead`
- Epic: `WLT-P0-E04`
- Depends on: `WLT-P0-203`
- Acceptance criteria:
  - policy bundles, inputs, and outcomes are written
  - allow, warn, approval, and deny are defined
  - request evaluation has a common model

### `WLT-P0-502` Define the approval request model

- Owner: `Platform lead`
- Epic: `WLT-P0-E04`
- Depends on: `WLT-P0-501`
- Acceptance criteria:
  - approval request fields and states are defined
  - reviewer routing assumptions are documented
  - future dual-control support is acknowledged in the model

### `WLT-P0-503` Define the audit event and session grant schema

- Owner: `Platform lead`
- Epic: `WLT-P0-E04`
- Depends on: `WLT-P0-501`
- Acceptance criteria:
  - session grant fields are defined
  - audit event schema captures subject, workspace, app, request, policy, approval, and result
  - logging requirements are usable by client and connect workstreams

### `WLT-P0-504` Draft the first intent and app-manifest schema candidates

- Owner: `Connect lead`
- Epic: `WLT-P0-E02`
- Depends on: `WLT-P0-301`, `WLT-P0-501`
- Acceptance criteria:
  - app manifest candidates exist
  - wallet intent request candidates exist
  - schema candidates are reviewable by product and platform

## 7. Week 6

Target outcome:
The team can demo a real local extension shell with a request and approval loop.

### `WLT-P0-601` Stand up the extension shell

- Owner: `Client lead`
- Epic: `WLT-P0-E05`
- Depends on: `WLT-P0-304`
- Acceptance criteria:
  - popup, options, background, and content entrypoints exist
  - the shell runs locally
  - extension structure is usable by the team

### `WLT-P0-602` Implement the mock request pipeline

- Owner: `Client lead`
- Epic: `WLT-P0-E05`
- Depends on: `WLT-P0-301`, `WLT-P0-302`, `WLT-P0-601`
- Acceptance criteria:
  - a mock app request can reach the wallet shell
  - approval state is rendered
  - the flow is demoable end to end

### `WLT-P0-603` Add alpha environment and seeded demo mode

- Owner: `Client lead`
- Epic: `WLT-P0-E05`
- Depends on: `WLT-P0-601`
- Acceptance criteria:
  - local alpha status is visually obvious
  - a demo mode exists for predictable review flows
  - reviewers can trigger the main request scenarios quickly

### `WLT-P0-604` Run the first vertical-slice demo review

- Owner: `Program lead`
- Epic: `WLT-P0-E01`
- Depends on: `WLT-P0-602`, `WLT-P0-603`
- Acceptance criteria:
  - demo happens with all leads present
  - issues and follow-ups are captured
  - the backlog is updated based on findings

## 8. Week 7

Target outcome:
The program moves from shell work into the first real first-party EVM integration path.

### `WLT-P0-701` Select the first EVM-style integration target

- Owner: `Connect lead`
- Epic: `WLT-P0-E07`
- Depends on: `WLT-P0-103`, `WLT-P0-604`
- Acceptance criteria:
  - one target app is confirmed
  - app liaison is active
  - integration success criteria are documented

### `WLT-P0-702` Map the target app’s wallet assumptions

- Owner: `App liaison`
- Epic: `WLT-P0-E07`
- Depends on: `WLT-P0-701`
- Acceptance criteria:
  - current wallet assumptions are written
  - connection, account, sign, and chain expectations are listed
  - blockers to Aethelred Wallet adoption are visible

### `WLT-P0-703` Implement the first provider bridge

- Owner: `Connect lead`
- Epic: `WLT-P0-E02`
- Depends on: `WLT-P0-701`, `WLT-P0-702`
- Acceptance criteria:
  - the local wallet can present a provider surface to the target app
  - connect behavior is observable in code
  - known incompatibilities are listed

### `WLT-P0-704` Create the provider conformance checklist

- Owner: `Connect lead`
- Epic: `WLT-P0-E02`
- Depends on: `WLT-P0-301`, `WLT-P0-703`
- Acceptance criteria:
  - connect, accounts, sign-message, sign-transaction, and session cases are listed
  - conformance criteria are reviewable
  - the checklist can drive later automated tests

## 9. Week 8

Target outcome:
Compatibility work becomes testable and repeatable instead of manual-only.

### `WLT-P0-801` Set up the compatibility test harness skeleton

- Owner: `Connect lead`
- Epic: `WLT-P0-E02`
- Depends on: `WLT-P0-704`
- Acceptance criteria:
  - a place exists to run wallet integration scenarios
  - test cases are organized by provider behavior
  - failures are easy to interpret

### `WLT-P0-802` Define the initial regression scenarios

- Owner: `QA or Connect lead`
- Epic: `WLT-P0-E07`
- Depends on: `WLT-P0-801`
- Acceptance criteria:
  - core connect and signing regressions are listed
  - at least one scenario exists per supported first-party flow
  - coverage gaps are explicit

### `WLT-P0-803` Start the compatibility gap board

- Owner: `Program lead`
- Epic: `WLT-P0-E07`
- Depends on: `WLT-P0-702`, `WLT-P0-802`
- Acceptance criteria:
  - issues are categorized by severity and owning lead
  - gaps are tied to apps and flows
  - the board is used in weekly review

### `WLT-P0-804` Review the first EVM path with Security

- Owner: `Security lead`
- Epic: `WLT-P0-E06`
- Depends on: `WLT-P0-703`
- Acceptance criteria:
  - new risks introduced by provider exposure are reviewed
  - required mitigations are logged
  - connect work continues with explicit risk awareness

## 10. Week 9

Target outcome:
Requests, sessions, policy, approval, and audit are connected as one coherent model.

### `WLT-P0-901` Implement session grants in the local wallet flow

- Owner: `Platform lead`
- Epic: `WLT-P0-E04`
- Depends on: `WLT-P0-503`, `WLT-P0-703`
- Acceptance criteria:
  - app sessions are represented in state
  - trust level and permissions are visible
  - revoke or expire states are accounted for

### `WLT-P0-902` Implement audit event generation hooks

- Owner: `Platform lead`
- Epic: `WLT-P0-E04`
- Depends on: `WLT-P0-503`, `WLT-P0-602`
- Acceptance criteria:
  - connect and sign flows produce audit events
  - event fields match the schema
  - missing evidence is visible

### `WLT-P0-903` Attach policy outcomes to the request path

- Owner: `Platform lead`
- Epic: `WLT-P0-E04`
- Depends on: `WLT-P0-501`, `WLT-P0-602`
- Acceptance criteria:
  - requests receive allow, warn, approval-required, or deny states
  - approval UI can reflect policy outcomes
  - product behavior matches the model

### `WLT-P0-904` Add approval review trace visibility

- Owner: `Client lead`
- Epic: `WLT-P0-E05`
- Depends on: `WLT-P0-502`, `WLT-P0-902`, `WLT-P0-903`
- Acceptance criteria:
  - request review trace is visible in the shell
  - product and security can inspect what happened
  - the flow becomes easier to debug and explain

## 11. Week 10

Target outcome:
The trust-kernel direction is backed by an actual secure-storage and account-registry prototype.

### `WLT-P0-1001` Build the secure-storage prototype

- Owner: `Wallet core lead`
- Epic: `WLT-P0-E03`
- Depends on: `WLT-P0-403`
- Acceptance criteria:
  - chosen storage path is prototyped
  - account material handling rules are reflected in code
  - the prototype is reviewable by security

### `WLT-P0-1002` Implement account registry behavior

- Owner: `Wallet core lead`
- Epic: `WLT-P0-E03`
- Depends on: `WLT-P0-402`, `WLT-P0-1001`
- Acceptance criteria:
  - accounts can be registered, labeled, and surfaced consistently
  - account handles align with the model
  - future import and hardware cases are not blocked

### `WLT-P0-1003` Implement signer interfaces for message and transaction flows

- Owner: `Wallet core lead`
- Epic: `WLT-P0-E03`
- Depends on: `WLT-P0-401`, `WLT-P0-1001`
- Acceptance criteria:
  - message and transaction signing interfaces exist
  - they respect the signer boundary
  - the client and connect layers can call them through approved paths

### `WLT-P0-1004` Review the prototype with Security

- Owner: `Security lead`
- Epic: `WLT-P0-E06`
- Depends on: `WLT-P0-1001`, `WLT-P0-1003`
- Acceptance criteria:
  - storage and signer risks are reviewed
  - required fixes are documented
  - the team knows whether the prototype is acceptable for Phase 0 exit

## 12. Week 11

Target outcome:
The team chooses the Cosmos-style compatibility direction with evidence instead of debate.

### `WLT-P0-1101` Analyze Shiora-style compatibility requirements

- Owner: `Connect lead`
- Epic: `WLT-P0-E07`
- Depends on: `WLT-P0-103`, `WLT-P0-203`
- Acceptance criteria:
  - required wallet behaviors are documented
  - differences from the EVM path are explicit
  - open questions are owned

### `WLT-P0-1102` Build the Cosmos compatibility spike

- Owner: `Connect lead`
- Epic: `WLT-P0-E07`
- Depends on: `WLT-P0-1101`
- Acceptance criteria:
  - one concrete adapter or compatibility spike exists
  - feasibility is evaluated with evidence
  - unsupported assumptions are exposed

### `WLT-P0-1103` Write the compatibility decision memo

- Owner: `Program lead`
- Epic: `WLT-P0-E08`
- Depends on: `WLT-P0-1102`
- Acceptance criteria:
  - the chosen direction is documented
  - tradeoffs and risks are clear
  - the team can move forward without re-arguing the choice

### `WLT-P0-1104` Update the risk register for Phase 0 exit

- Owner: `Security lead`
- Epic: `WLT-P0-E06`
- Depends on: `WLT-P0-1103`
- Acceptance criteria:
  - top remaining risks are ranked
  - mitigation owners are assigned
  - Phase 0 exit discussion is grounded in current risk

## 13. Week 12

Target outcome:
The team has a measured compatibility view across first-party apps and a credible internal alpha package.

### `WLT-P0-1201` Finalize the first-party app integration matrix

- Owner: `Connect lead`
- Epic: `WLT-P0-E07`
- Depends on: `WLT-P0-703`, `WLT-P0-1103`
- Acceptance criteria:
  - Cruzible, ZeroID, TerraQura, and Shiora are each classified
  - support status is visible by flow
  - priorities for Phase 1 are clear

### `WLT-P0-1202` Measure incumbent wallet support gaps

- Owner: `Connect lead`
- Epic: `WLT-P0-E07`
- Depends on: `WLT-P0-1201`
- Acceptance criteria:
  - gap analysis exists against current incumbent wallets and flows
  - top blockers are ranked
  - test evidence supports the ranking

### `WLT-P0-1203` Prepare the internal alpha readiness pack

- Owner: `Program lead`
- Epic: `WLT-P0-E08`
- Depends on: `WLT-P0-1004`, `WLT-P0-1201`
- Acceptance criteria:
  - alpha scope, known issues, review notes, and demo steps are documented
  - leadership can understand what is ready and what is not
  - next-phase decisions are framed clearly

### `WLT-P0-1204` Draft the Phase 1 backlog handoff

- Owner: `Program lead`
- Epic: `WLT-P0-E08`
- Depends on: `WLT-P0-1201`, `WLT-P0-1203`
- Acceptance criteria:
  - Phase 1 priorities are written
  - unresolved dependencies are carried forward explicitly
  - leads can begin Phase 1 planning without rebuilding context

## 14. Week 13

Target outcome:
Phase 0 closes with accepted foundations, a clear alpha position, and a clean move into Personal / Pro work.

### `WLT-P0-1301` Run the Phase 0 exit review

- Owner: `Program lead`
- Epic: `WLT-P0-E08`
- Depends on: `WLT-P0-1203`, `WLT-P0-1204`
- Acceptance criteria:
  - Phase 0 goals are reviewed against evidence
  - pass, conditional pass, or fail is declared
  - the team agrees on the result

### `WLT-P0-1302` Accept or reject the trust-kernel skeleton

- Owner: `Security lead`
- Epic: `WLT-P0-E06`
- Depends on: `WLT-P0-1004`, `WLT-P0-1301`
- Acceptance criteria:
  - trust-kernel direction receives explicit acceptance or required remediation
  - unresolved security items are documented
  - no ambiguous “good enough” handoff remains

### `WLT-P0-1303` Confirm the Personal / Pro Phase 1 entry package

- Owner: `Program lead`
- Epic: `WLT-P0-E08`
- Depends on: `WLT-P0-1204`, `WLT-P0-1301`
- Acceptance criteria:
  - Phase 1 scope, owners, and opening backlog are confirmed
  - the team knows exactly what starts in Week 14
  - Phase 1 does not begin in planning chaos

### `WLT-P0-1304` Deliver the leadership walkthrough

- Owner: `Program lead`
- Epic: `WLT-P0-E08`
- Depends on: `WLT-P0-1301`, `WLT-P0-1303`
- Acceptance criteria:
  - leadership sees the product shell, compatibility status, risk profile, and next phase
  - asks and concerns are captured
  - the program leaves Phase 0 with aligned executive support
