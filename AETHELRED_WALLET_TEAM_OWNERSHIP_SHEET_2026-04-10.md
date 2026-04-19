# Aethelred Wallet Team Ownership Sheet

Date: 2026-04-10
Status: Local founder-facing sheet
Scope: Wallet program staffing, ownership, and decision rights
Related:

- `wallet/AETHELRED_WALLET_PHASE0_EPICS_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE0_DELIVERY_BOARD_2026-04-10.md`
- `wallet/AETHELRED_WALLET_WEEK_BY_WEEK_PLAN_2026-04-10.md`

## 1. Founder Summary

If you want this wallet program to move fast without architectural confusion, assign clear ownership immediately.

Minimum requirement:

- one accountable program lead
- one accountable client lead
- one accountable connect lead
- one accountable wallet-core lead
- one accountable platform lead
- one accountable security lead
- one accountable design lead

If one person covers multiple roles for now, that is acceptable temporarily.
What is not acceptable is shared ambiguity over who owns trust, connect, or approvals.

## 2. Recommended Team Shape

### Minimum viable team

- `Program lead`
- `Design lead`
- `Client engineer 1`
- `Client engineer 2`
- `Connect / integration engineer`
- `Wallet-core engineer`
- `Platform engineer`
- `Security lead or security-minded reviewer`

### Stronger execution team

- all of the above
- `QA / release engineer`
- `Mobile engineer`
- `Control-plane or backend engineer`

### Likely founder concern

If the team is smaller than this, the program can still start, but the first risk is not speed.
The first risk is blurred decision-making across trust, policy, and UX.

## 3. Role Ownership

### `Program lead`

Owns:

- roadmap execution
- milestone reviews
- weekly leadership visibility
- dependency management
- risk and decision escalation
- Phase exits

Should not own:

- final signer-boundary decisions without wallet-core and security review

### `Design lead`

Owns:

- information architecture
- onboarding flows
- approval UX
- workspace UX
- product clarity across Personal, Enterprise, and Sovereign modes

Should not own:

- trust-model decisions alone

### `Client lead`

Owns:

- extension shell
- popup, options, background, and content surfaces
- UI state integration
- session and approval rendering
- local alpha quality

Should not own:

- provider semantics alone
- signing rules

### `Connect lead`

Owns:

- `Aethelred Connect`
- provider contracts
- discovery behavior
- app integration compatibility
- conformance and integration test harness

Should not own:

- secure storage decisions alone

### `Wallet core lead`

Owns:

- signer boundary
- secure storage
- key slots
- account handles
- signing interfaces
- trust-kernel implementation direction

Should not own:

- product UX decisions without design and product review

### `Platform lead`

Owns:

- subject and workspace model
- policy engine model
- approval model
- audit event model
- session grants
- enterprise-ready data model foundations

Should not own:

- frontend-only compromises that weaken the operating model

### `Security lead`

Owns:

- threat model
- abuse-case library
- review checklists
- alpha release gates
- sign-off on critical trust-boundary changes

Should not own:

- the full program schedule

## 4. Decision Rights Matrix

| Decision | Primary decider | Required reviewers |
| --- | --- | --- |
| Product scope for the current phase | `Program lead` | `Design lead`, relevant leads |
| Extension-first versus mobile-first | `Program lead` | `Client lead`, `Connect lead` |
| Provider contract shape | `Connect lead` | `Wallet core lead`, `Client lead`, `Security lead` |
| Signer boundary and storage approach | `Wallet core lead` | `Security lead`, `Platform lead` |
| Domain model for workspace, policy, approval, audit | `Platform lead` | `Program lead`, `Design lead`, `Security lead` |
| Approval UX and trust messaging | `Design lead` | `Program lead`, `Security lead`, `Client lead` |
| First integration target | `Program lead` | `Connect lead`, app liaison |
| Cosmos-style compatibility direction | `Program lead` | `Connect lead`, `Wallet core lead`, `Security lead` |
| Phase exit acceptance | `Program lead` | all leads |

## 5. Week 1 Founder Checklist

- appoint the leads
- confirm the weekly architecture and demo cadence
- confirm the first EVM-style and Cosmos-style target apps
- require the decision log to be updated weekly
- require a live demo every week, not slide-only status
- require security review before signer or storage code hardens

## 6. Team Expectations For Phase 0

### Program lead must deliver

- a working operating cadence
- no hidden blockers
- an evidence-based Phase 0 exit review

### Design lead must deliver

- connect and approval flows the team can build from
- no vague wallet UX that hides trust complexity

### Client lead must deliver

- a working extension shell
- a demoable request and approval loop

### Connect lead must deliver

- stable provider contracts
- one live EVM-style path
- a chosen Cosmos-style direction

### Wallet core lead must deliver

- a defensible signer boundary
- storage prototype
- usable signing interfaces

### Platform lead must deliver

- shared domain models for workspace, policy, approval, and audit
- request lifecycle semantics that support enterprise and sovereign ambitions

### Security lead must deliver

- threat model
- abuse cases
- acceptance criteria for internal alpha trust posture

## 7. Suggested Reporting Rhythm

Weekly founder readout should answer only these questions:

1. What did we ship or prove this week?
2. What decision got locked this week?
3. What is blocked and who owns it?
4. What are the top three risks right now?
5. Are we still on the planned week-by-week path?

## 8. What To Watch Closely

- if UX work gets ahead of trust decisions, slow it down
- if connect work starts bypassing the core model, stop it
- if security appears only in review week, the program is drifting
- if the team cannot explain the difference between provider, signer, policy, and approval layers, ownership is still blurry

## 9. Immediate Assignment Recommendation

This week, you should insist that the team names:

- one `Program lead`
- one `Connect lead`
- one `Wallet core lead`
- one `Platform lead`
- one `Client lead`
- one `Design lead`
- one `Security lead`

Then run the team against the board and weekly plan, not against ad hoc requests.
