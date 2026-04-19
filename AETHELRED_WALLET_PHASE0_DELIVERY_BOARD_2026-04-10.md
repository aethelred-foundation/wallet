# Aethelred Wallet Phase 0 Delivery Board

Date: 2026-04-10
Status: Local planning board
Scope: Weeks 1-13
Related:

- `wallet/AETHELRED_WALLET_PHASE0_EPICS_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE0_TICKETS_2026-04-10.md`
- `wallet/AETHELRED_WALLET_WEEK_BY_WEEK_PLAN_2026-04-10.md`

## 1. How To Use This Board

This document is the team-friendly board view of Phase 0.

Use it to:

- seed Linear, Jira, Notion, or a spreadsheet board
- assign owners and priorities
- set weekly focus
- track blockers and review status

Recommended board columns:

- `Backlog`
- `Ready`
- `In Progress`
- `In Review`
- `Blocked`
- `Done`

Recommended priority labels:

- `P0` must move this week
- `P1` important and near-term
- `P2` important but can wait behind the current milestone

## 2. Epic Lanes

| Epic | Lane | Lead |
| --- | --- | --- |
| `WLT-P0-E01` | Program Governance and Delivery Control | `Program lead` |
| `WLT-P0-E02` | Aethelred Connect Contracts and Provider Surface | `Connect lead` |
| `WLT-P0-E03` | Trust Kernel and Secure Storage Foundation | `Wallet core lead` |
| `WLT-P0-E04` | Identity, Workspace, Policy, Approval, and Audit Foundation | `Platform lead` |
| `WLT-P0-E05` | Extension Client Alpha Vertical Slice | `Client lead` |
| `WLT-P0-E06` | Security, Threat Modeling, and Release Gates | `Security lead` |
| `WLT-P0-E07` | First-Party Compatibility and Integration Readiness | `Connect lead` |
| `WLT-P0-E08` | Phase Exit, Internal Alpha Readiness, and Phase 1 Handoff | `Program lead` |

## 3. Immediate Board Seeding

These items should enter `Ready` or `In Progress` first:

- `WLT-P0-101` Create the wallet war-room and ownership map
- `WLT-P0-102` Run the Phase 0 kickoff session
- `WLT-P0-103` Shortlist the first integration targets
- `WLT-P0-104` Start the decision and risk log
- `WLT-P0-201` Finalize the extension-first decision for Phase 0
- `WLT-P0-202` Draft the trust-boundary architecture
- `WLT-P0-203` Draft the core domain model v0
- `WLT-P0-204` Produce the extension threat model v0

## 4. Phase 0 Board Rows

| ID | Title | Epic | Week | Owner | Priority | Initial status | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `WLT-P0-101` | Create the wallet war-room and ownership map | `E01` | 1 | `Program lead` | `P0` | `Ready` | none |
| `WLT-P0-102` | Run the Phase 0 kickoff session | `E01` | 1 | `Program lead` | `P0` | `Ready` | `WLT-P0-101` |
| `WLT-P0-103` | Shortlist the first integration targets | `E07` | 1 | `Connect lead` | `P0` | `Ready` | `WLT-P0-102` |
| `WLT-P0-104` | Start the decision and risk log | `E01` | 1 | `Program lead` | `P0` | `Ready` | `WLT-P0-102` |
| `WLT-P0-201` | Finalize the extension-first decision for Phase 0 | `E01` | 2 | `Program lead` | `P0` | `Backlog` | `WLT-P0-102` |
| `WLT-P0-202` | Draft the trust-boundary architecture | `E03` | 2 | `Wallet core lead` | `P0` | `Backlog` | `WLT-P0-201` |
| `WLT-P0-203` | Draft the core domain model v0 | `E04` | 2 | `Platform lead` | `P0` | `Backlog` | `WLT-P0-201` |
| `WLT-P0-204` | Produce the extension threat model v0 | `E06` | 2 | `Security lead` | `P0` | `Backlog` | `WLT-P0-202` |
| `WLT-P0-301` | Define the `Aethelred Connect` contract v0 | `E02` | 3 | `Connect lead` | `P0` | `Backlog` | `WLT-P0-202`, `WLT-P0-203` |
| `WLT-P0-302` | Map the provider request lifecycle | `E02` | 3 | `Connect lead` | `P0` | `Backlog` | `WLT-P0-301` |
| `WLT-P0-303` | Define wallet discovery behavior | `E02` | 3 | `Connect lead` | `P1` | `Backlog` | `WLT-P0-301` |
| `WLT-P0-304` | Define connect and approval UX flows | `E05` | 3 | `Design lead` | `P0` | `Backlog` | `WLT-P0-301`, `WLT-P0-302` |
| `WLT-P0-401` | Finalize signer boundary v1 | `E03` | 4 | `Wallet core lead` | `P0` | `Backlog` | `WLT-P0-202`, `WLT-P0-204` |
| `WLT-P0-402` | Define the key-slot and account-handle model | `E03` | 4 | `Wallet core lead` | `P0` | `Backlog` | `WLT-P0-401`, `WLT-P0-203` |
| `WLT-P0-403` | Run a secure-storage options spike | `E03` | 4 | `Wallet core lead` | `P0` | `Backlog` | `WLT-P0-401` |
| `WLT-P0-404` | Define the Phase 0 review checklist | `E06` | 4 | `Security lead` | `P1` | `Backlog` | `WLT-P0-204` |
| `WLT-P0-501` | Define the policy object model | `E04` | 5 | `Platform lead` | `P0` | `Backlog` | `WLT-P0-203` |
| `WLT-P0-502` | Define the approval request model | `E04` | 5 | `Platform lead` | `P0` | `Backlog` | `WLT-P0-501` |
| `WLT-P0-503` | Define the audit event and session grant schema | `E04` | 5 | `Platform lead` | `P0` | `Backlog` | `WLT-P0-501` |
| `WLT-P0-504` | Draft the first intent and app-manifest schema candidates | `E02` | 5 | `Connect lead` | `P1` | `Backlog` | `WLT-P0-301`, `WLT-P0-501` |
| `WLT-P0-601` | Stand up the extension shell | `E05` | 6 | `Client lead` | `P0` | `Backlog` | `WLT-P0-304` |
| `WLT-P0-602` | Implement the mock request pipeline | `E05` | 6 | `Client lead` | `P0` | `Backlog` | `WLT-P0-301`, `WLT-P0-302`, `WLT-P0-601` |
| `WLT-P0-603` | Add alpha environment and seeded demo mode | `E05` | 6 | `Client lead` | `P1` | `Backlog` | `WLT-P0-601` |
| `WLT-P0-604` | Run the first vertical-slice demo review | `E01` | 6 | `Program lead` | `P0` | `Backlog` | `WLT-P0-602`, `WLT-P0-603` |
| `WLT-P0-701` | Select the first EVM-style integration target | `E07` | 7 | `Connect lead` | `P0` | `Backlog` | `WLT-P0-103`, `WLT-P0-604` |
| `WLT-P0-702` | Map the target app’s wallet assumptions | `E07` | 7 | `App liaison` | `P0` | `Backlog` | `WLT-P0-701` |
| `WLT-P0-703` | Implement the first provider bridge | `E02` | 7 | `Connect lead` | `P0` | `Backlog` | `WLT-P0-701`, `WLT-P0-702` |
| `WLT-P0-704` | Create the provider conformance checklist | `E02` | 7 | `Connect lead` | `P1` | `Backlog` | `WLT-P0-301`, `WLT-P0-703` |
| `WLT-P0-801` | Set up the compatibility test harness skeleton | `E02` | 8 | `Connect lead` | `P0` | `Backlog` | `WLT-P0-704` |
| `WLT-P0-802` | Define the initial regression scenarios | `E07` | 8 | `QA or Connect lead` | `P1` | `Backlog` | `WLT-P0-801` |
| `WLT-P0-803` | Start the compatibility gap board | `E07` | 8 | `Program lead` | `P1` | `Backlog` | `WLT-P0-702`, `WLT-P0-802` |
| `WLT-P0-804` | Review the first EVM path with Security | `E06` | 8 | `Security lead` | `P0` | `Backlog` | `WLT-P0-703` |
| `WLT-P0-901` | Implement session grants in the local wallet flow | `E04` | 9 | `Platform lead` | `P0` | `Backlog` | `WLT-P0-503`, `WLT-P0-703` |
| `WLT-P0-902` | Implement audit event generation hooks | `E04` | 9 | `Platform lead` | `P0` | `Backlog` | `WLT-P0-503`, `WLT-P0-602` |
| `WLT-P0-903` | Attach policy outcomes to the request path | `E04` | 9 | `Platform lead` | `P0` | `Backlog` | `WLT-P0-501`, `WLT-P0-602` |
| `WLT-P0-904` | Add approval review trace visibility | `E05` | 9 | `Client lead` | `P1` | `Backlog` | `WLT-P0-502`, `WLT-P0-902`, `WLT-P0-903` |
| `WLT-P0-1001` | Build the secure-storage prototype | `E03` | 10 | `Wallet core lead` | `P0` | `Backlog` | `WLT-P0-403` |
| `WLT-P0-1002` | Implement account registry behavior | `E03` | 10 | `Wallet core lead` | `P1` | `Backlog` | `WLT-P0-402`, `WLT-P0-1001` |
| `WLT-P0-1003` | Implement signer interfaces for message and transaction flows | `E03` | 10 | `Wallet core lead` | `P0` | `Backlog` | `WLT-P0-401`, `WLT-P0-1001` |
| `WLT-P0-1004` | Review the prototype with Security | `E06` | 10 | `Security lead` | `P0` | `Backlog` | `WLT-P0-1001`, `WLT-P0-1003` |
| `WLT-P0-1101` | Analyze Shiora-style compatibility requirements | `E07` | 11 | `Connect lead` | `P0` | `Backlog` | `WLT-P0-103`, `WLT-P0-203` |
| `WLT-P0-1102` | Build the Cosmos compatibility spike | `E07` | 11 | `Connect lead` | `P0` | `Backlog` | `WLT-P0-1101` |
| `WLT-P0-1103` | Write the compatibility decision memo | `E08` | 11 | `Program lead` | `P1` | `Backlog` | `WLT-P0-1102` |
| `WLT-P0-1104` | Update the risk register for Phase 0 exit | `E06` | 11 | `Security lead` | `P1` | `Backlog` | `WLT-P0-1103` |
| `WLT-P0-1201` | Finalize the first-party app integration matrix | `E07` | 12 | `Connect lead` | `P0` | `Backlog` | `WLT-P0-703`, `WLT-P0-1103` |
| `WLT-P0-1202` | Measure incumbent wallet support gaps | `E07` | 12 | `Connect lead` | `P1` | `Backlog` | `WLT-P0-1201` |
| `WLT-P0-1203` | Prepare the internal alpha readiness pack | `E08` | 12 | `Program lead` | `P0` | `Backlog` | `WLT-P0-1004`, `WLT-P0-1201` |
| `WLT-P0-1204` | Draft the Phase 1 backlog handoff | `E08` | 12 | `Program lead` | `P0` | `Backlog` | `WLT-P0-1201`, `WLT-P0-1203` |
| `WLT-P0-1301` | Run the Phase 0 exit review | `E08` | 13 | `Program lead` | `P0` | `Backlog` | `WLT-P0-1203`, `WLT-P0-1204` |
| `WLT-P0-1302` | Accept or reject the trust-kernel skeleton | `E06` | 13 | `Security lead` | `P0` | `Backlog` | `WLT-P0-1004`, `WLT-P0-1301` |
| `WLT-P0-1303` | Confirm the Personal / Pro Phase 1 entry package | `E08` | 13 | `Program lead` | `P0` | `Backlog` | `WLT-P0-1204`, `WLT-P0-1301` |
| `WLT-P0-1304` | Deliver the leadership walkthrough | `E08` | 13 | `Program lead` | `P1` | `Backlog` | `WLT-P0-1301`, `WLT-P0-1303` |

## 5. Founder View Of Current Weekly Focus

Weeks 1-2:

- assign owners
- lock extension-first direction
- lock trust boundary and domain model direction
- start threat model

Weeks 3-6:

- define `Aethelred Connect`
- ship the extension shell and approval loop demo
- settle signer boundary and storage direction

Weeks 7-10:

- connect the first live EVM-style app
- make compatibility measurable
- attach policy, session, and audit state
- build the secure-storage prototype

Weeks 11-13:

- decide the Cosmos-style path
- finalize first-party compatibility matrix
- prepare alpha readiness pack
- complete Phase 0 exit review
