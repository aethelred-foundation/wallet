# Aethelred Wallet Phase 3 Tickets

Date: 2026-04-11
Status: Local execution backlog
Scope: Weeks 66-78
Related:

- `wallet/AETHELRED_WALLET_PHASE3_EPICS_2026-04-11.md`
- `wallet/AETHELRED_WALLET_PHASE3_DELIVERY_BOARD_2026-04-11.md`
- `wallet/AETHELRED_WALLET_PHASE3_SOVEREIGN_PILOT_PLAN_2026-04-11.md`

## 1. How To Use This Backlog

- Each week has a target outcome.
- Each ticket is ready for immediate assignment.
- Acceptance criteria define the minimum done bar.
- If a week slips, explicitly re-plan it instead of burying the delay inside the pilot phase.

## 2. Week 66

Target outcome:
The sovereign phase starts with locked constraints, pilot assumptions, and success criteria.

### `WLT-P3-6601` Lock sovereign mode scope and exclusions

- Owner: `Program lead`
- Epic: `WLT-P3-E01`
- Depends on: Phase 2 exit
- Acceptance criteria:
  - in-scope sovereign capabilities are explicit
  - out-of-scope items are written down
  - the team is not assuming an unlimited sovereign backlog

### `WLT-P3-6602` Define the first sovereign or equivalent pilot profile

- Owner: `Product lead`
- Epic: `WLT-P3-E01`
- Depends on: `WLT-P3-6601`
- Acceptance criteria:
  - pilot user type and workflow are explicit
  - pilot goals are measurable
  - the team knows what “pilot success” means

### `WLT-P3-6603` Define sovereign review cadence and gate criteria

- Owner: `Program lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-6601`
- Acceptance criteria:
  - review cadence is explicit
  - high-assurance gates are named
  - pilot readiness will be reviewed against evidence, not momentum

## 3. Week 67

Target outcome:
Dedicated deployment profiles become concrete architecture artifacts.

### `WLT-P3-6701` Define dedicated deployment profile model

- Owner: `Platform lead`
- Epic: `WLT-P3-E02`
- Depends on: `WLT-P3-6602`
- Acceptance criteria:
  - deployment profile objects are defined
  - dedicated tenant assumptions are explicit
  - the model supports later sovereign variants cleanly

### `WLT-P3-6702` Define isolated control-plane topology assumptions

- Owner: `Platform lead`
- Epic: `WLT-P3-E02`
- Depends on: `WLT-P3-6701`
- Acceptance criteria:
  - control-plane isolation assumptions are documented
  - environment-aware configuration boundaries are clear
  - the team can explain how sovereign differs from enterprise in topology terms

### `WLT-P3-6703` Review deployment isolation risks

- Owner: `Security lead`
- Epic: `WLT-P3-E02`
- Depends on: `WLT-P3-6701`, `WLT-P3-6702`
- Acceptance criteria:
  - isolation risks are documented
  - highest-risk deployment assumptions are reviewed
  - unresolved gaps are assigned

## 4. Week 68

Target outcome:
Sovereign catalog rules and tenant isolation begin to work together.

### `WLT-P3-6801` Define sovereign catalog isolation model

- Owner: `Product lead`
- Epic: `WLT-P3-E05`
- Depends on: `WLT-P3-6701`
- Acceptance criteria:
  - catalog isolation model exists
  - environment-scoped visibility rules are explicit
  - the model is distinct from enterprise private catalogs where needed

### `WLT-P3-6802` Implement tenant-scoped app visibility rules

- Owner: `Connect lead`
- Epic: `WLT-P3-E05`
- Depends on: `WLT-P3-6801`
- Acceptance criteria:
  - app visibility respects deployment profile
  - the rules are testable
  - catalog state no longer assumes one global distribution plane

### `WLT-P3-6803` Implement sovereign catalog surface v0

- Owner: `Client lead`
- Epic: `WLT-P3-E05`
- Depends on: `WLT-P3-6801`
- Acceptance criteria:
  - sovereign catalog is visible in product form
  - isolation rules are understandable to operators
  - trust state and availability are rendered clearly

## 5. Week 69

Target outcome:
Key residency and custody abstraction are explicit enough for sovereign conversations.

### `WLT-P3-6901` Define key residency model

- Owner: `Wallet core lead`
- Epic: `WLT-P3-E02`
- Depends on: `WLT-P3-6701`
- Acceptance criteria:
  - residency constraints are represented
  - deployment-aware key handling assumptions are clear
  - the model supports policy and control reasoning

### `WLT-P3-6902` Define deployment-aware custody backend selection

- Owner: `Wallet core lead`
- Epic: `WLT-P3-E02`
- Depends on: `WLT-P3-6901`
- Acceptance criteria:
  - backend selection hooks are documented
  - control handoff between wallet and custody systems is explicit
  - the design supports later high-assurance integrations

### `WLT-P3-6903` Review residency and custody control assumptions

- Owner: `Security lead`
- Epic: `WLT-P3-E02`
- Depends on: `WLT-P3-6901`, `WLT-P3-6902`
- Acceptance criteria:
  - residency and custody risks are documented
  - the team knows what must be proven in pilot form
  - high-risk assumptions are not hidden behind roadmap language

## 6. Week 70

Target outcome:
Higher-assurance approvals become tangible sovereign controls.

### `WLT-P3-7001` Define high-assurance approval modes

- Owner: `Platform lead`
- Epic: `WLT-P3-E03`
- Depends on: `WLT-P3-6602`
- Acceptance criteria:
  - stepped and offline review modes are explicit
  - the product difference from enterprise approvals is clear
  - role and quorum assumptions are documented

### `WLT-P3-7002` Implement stricter approval-mode handling

- Owner: `Platform lead`
- Epic: `WLT-P3-E03`
- Depends on: `WLT-P3-7001`
- Acceptance criteria:
  - stricter approval states are represented
  - the request lifecycle respects the stronger controls
  - enterprise-era assumptions do not leak into sovereign paths

### `WLT-P3-7003` Design high-assurance approval UX

- Owner: `Design lead`
- Epic: `WLT-P3-E03`
- Depends on: `WLT-P3-7001`, `WLT-P3-7002`
- Acceptance criteria:
  - approval UX reflects higher assurance clearly
  - review and escalation states are understandable
  - the product does not rely on hidden operator knowledge

## 7. Week 71

Target outcome:
Service and agent identities become first-class and governed.

### `WLT-P3-7101` Define service identity model

- Owner: `Platform lead`
- Epic: `WLT-P3-E04`
- Depends on: `WLT-P3-6602`
- Acceptance criteria:
  - service identity semantics are explicit
  - relationship to human workspaces is defined
  - policy and audit hooks are mapped

### `WLT-P3-7102` Define agent identity and permission model

- Owner: `Platform lead`
- Epic: `WLT-P3-E04`
- Depends on: `WLT-P3-7101`
- Acceptance criteria:
  - agent permissions are scoped and revocable
  - automation boundaries are explicit
  - the model avoids uncontrolled agent execution

### `WLT-P3-7103` Review non-human identity abuse cases

- Owner: `Security lead`
- Epic: `WLT-P3-E04`
- Depends on: `WLT-P3-7101`, `WLT-P3-7102`
- Acceptance criteria:
  - abuse cases for service and agent identities are documented
  - policy or control gaps are listed
  - mitigations are assigned before pilot readiness

## 8. Week 72

Target outcome:
Sovereign policy controls become usable and expressive.

### `WLT-P3-7201` Implement sovereign policy control surface

- Owner: `Platform lead`
- Epic: `WLT-P3-E03`
- Depends on: `WLT-P3-7002`, `WLT-P3-6901`
- Acceptance criteria:
  - sovereign policy inputs are usable
  - deployment and mission-specific rules are expressible
  - the control surface is distinct from generic enterprise policy

### `WLT-P3-7202` Implement restricted destination and jurisdiction rules

- Owner: `Platform lead`
- Epic: `WLT-P3-E03`
- Depends on: `WLT-P3-7201`
- Acceptance criteria:
  - restricted destination logic exists
  - jurisdiction-related control rules are modeled
  - policy outcomes are reviewable and testable

### `WLT-P3-7203` Surface sovereign policy state in product form

- Owner: `Client lead`
- Epic: `WLT-P3-E03`
- Depends on: `WLT-P3-7201`, `WLT-P3-7202`
- Acceptance criteria:
  - product surfaces show sovereign policy state clearly
  - operators can understand what is restricted and why
  - UX avoids opaque high-assurance behavior

## 9. Week 73

Target outcome:
Restricted deployment operations are hardened and explicit.

### `WLT-P3-7301` Define restricted network and environment controls

- Owner: `Platform lead`
- Epic: `WLT-P3-E02`
- Depends on: `WLT-P3-6702`
- Acceptance criteria:
  - restricted operation rules are documented
  - network and environment controls are explicit
  - the model supports real deployment hardening

### `WLT-P3-7302` Implement control-plane hardening requirements

- Owner: `Platform lead`
- Epic: `WLT-P3-E02`
- Depends on: `WLT-P3-7301`
- Acceptance criteria:
  - hardening requirements are written and prioritized
  - the product and ops model reflect them
  - pilot preparation can depend on one known baseline

### `WLT-P3-7303` Review restricted deployment failure and abuse paths

- Owner: `Security lead`
- Epic: `WLT-P3-E02`
- Depends on: `WLT-P3-7301`, `WLT-P3-7302`
- Acceptance criteria:
  - failure and abuse paths are documented
  - high-risk items are ranked
  - remaining pilot blockers are explicit

## 10. Week 74

Target outcome:
Evidence-grade operational views reach high-assurance form.

### `WLT-P3-7401` Define evidence-grade operational reporting model

- Owner: `Platform lead`
- Epic: `WLT-P3-E06`
- Depends on: `WLT-P3-7201`, `WLT-P3-7101`
- Acceptance criteria:
  - operational reporting objects are explicit
  - reports map to sovereign or regulated review needs
  - evidence lineage is preserved

### `WLT-P3-7402` Implement stronger control-report views

- Owner: `Client lead`
- Epic: `WLT-P3-E06`
- Depends on: `WLT-P3-7401`
- Acceptance criteria:
  - operators can inspect stronger control reports
  - the surfaces are understandable to non-engineering reviewers
  - the outputs are usable in pilot review preparation

### `WLT-P3-7403` Validate evidence-grade review artifacts

- Owner: `Program lead`
- Epic: `WLT-P3-E06`
- Depends on: `WLT-P3-7401`, `WLT-P3-7402`
- Acceptance criteria:
  - review artifacts are validated against pilot expectations
  - gaps are documented
  - the team knows what must be corrected before launch

## 11. Week 75

Target outcome:
The sovereign-only app distribution model reaches pilot form.

### `WLT-P3-7501` Finalize sovereign-only app distribution rules

- Owner: `Product lead`
- Epic: `WLT-P3-E05`
- Depends on: `WLT-P3-6801`
- Acceptance criteria:
  - sovereign-only distribution rules are explicit
  - operator and admin assumptions are clear
  - the model supports the pilot environment

### `WLT-P3-7502` Implement sovereign catalog pilot path

- Owner: `Client lead`
- Epic: `WLT-P3-E05`
- Depends on: `WLT-P3-7501`, `WLT-P3-6803`
- Acceptance criteria:
  - sovereign catalog pilot flow works
  - restricted entries are visible only in the right context
  - the surface is coherent for pilot users

### `WLT-P3-7503` Review sovereign app distribution trust model

- Owner: `Security lead`
- Epic: `WLT-P3-E05`
- Depends on: `WLT-P3-7501`, `WLT-P3-7502`
- Acceptance criteria:
  - app distribution trust assumptions are documented
  - control weaknesses are identified
  - the pilot path is reviewed explicitly

## 12. Week 76

Target outcome:
The team rehearses the sovereign or equivalent pilot end to end.

### `WLT-P3-7601` Prepare the sovereign pilot environment

- Owner: `Program lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-7302`, `WLT-P3-7502`
- Acceptance criteria:
  - pilot environment is prepared
  - pilot participants and roles are explicit
  - success and stop conditions are documented

### `WLT-P3-7602` Run the end-to-end pilot rehearsal

- Owner: `Program lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-7601`
- Acceptance criteria:
  - pilot rehearsal completes end to end
  - role, approval, evidence, and control flows are exercised
  - defects and confusion points are captured

### `WLT-P3-7603` Rehearse support and incident escalation

- Owner: `Security lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-7602`
- Acceptance criteria:
  - incident escalation path is tested
  - support ownership is explicit
  - the team is not improvising under pilot pressure

## 13. Week 77

Target outcome:
The first sovereign or equivalent high-assurance pilot starts in controlled form.

### `WLT-P3-7701` Approve pilot go or no-go

- Owner: `Program lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-7602`, `WLT-P3-7603`
- Acceptance criteria:
  - go or no-go decision is explicit
  - known risks are accepted or blocked deliberately
  - pilot launch is not based on momentum alone

### `WLT-P3-7702` Launch the sovereign pilot window

- Owner: `Program lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-7701`
- Acceptance criteria:
  - pilot begins in controlled form
  - operational and evidence visibility are live
  - support ownership is active during launch

### `WLT-P3-7703` Capture pilot launch telemetry and findings

- Owner: `Program lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-7702`
- Acceptance criteria:
  - launch issues and learnings are captured quickly
  - pilot success signals are tracked
  - the team has a grounded view of what happened

## 14. Week 78

Target outcome:
The wallet program closes with an evidence-based sovereign review and a clear next-horizon plan.

### `WLT-P3-7801` Run the Phase 3 exit review

- Owner: `Program lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-7703`
- Acceptance criteria:
  - the review is evidence-based
  - pilot outcomes are summarized clearly
  - pass, conditional pass, or fail is declared

### `WLT-P3-7802` Document pilot outcomes and capability gaps

- Owner: `Program lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-7801`
- Acceptance criteria:
  - pilot strengths and weaknesses are documented
  - capability gaps are explicit
  - the roadmap can evolve from a known base

### `WLT-P3-7803` Produce the next-horizon roadmap

- Owner: `Program lead`
- Epic: `WLT-P3-E07`
- Depends on: `WLT-P3-7801`, `WLT-P3-7802`
- Acceptance criteria:
  - next priorities are documented
  - post-Phase-3 direction is explicit
  - the program ends with continuity rather than drift
