# Aethelred Wallet Phase 2 Tickets

Date: 2026-04-11
Status: Local execution backlog
Scope: Weeks 40-65
Related:

- `wallet/AETHELRED_WALLET_PHASE2_EPICS_2026-04-11.md`
- `wallet/AETHELRED_WALLET_PHASE2_DELIVERY_BOARD_2026-04-11.md`
- `wallet/AETHELRED_WALLET_PHASE2_ENTERPRISE_BETA_AND_PARTNER_PLAN_2026-04-11.md`

## 1. How To Use This Backlog

- Each week has a target outcome.
- Each ticket is ready for immediate lead assignment.
- Acceptance criteria define the minimum done bar.
- If a week slips, explicitly re-plan it instead of absorbing hidden debt into later enterprise work.

## 2. Week 40

Target outcome:
Enterprise mode starts with a locked success definition and buyer workflow focus.

### `WLT-P2-4001` Lock enterprise mode success definition

- Owner: `Program lead`
- Epic: `WLT-P2-E01`
- Depends on: Phase 1 exit
- Acceptance criteria:
  - enterprise success metrics are explicit
  - target workflows are named
  - deferred enterprise capabilities are listed

### `WLT-P2-4002` Define target buyer flows

- Owner: `Product lead`
- Epic: `WLT-P2-E01`
- Depends on: `WLT-P2-4001`
- Acceptance criteria:
  - treasury, compliance, and operator jobs are mapped
  - primary and secondary buyer flows are distinguished
  - design and engineering can estimate from one shared view

### `WLT-P2-4003` Confirm enterprise review cadence and phase metrics

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-4001`
- Acceptance criteria:
  - phase review rhythm is explicit
  - enterprise beta and design-partner metrics are defined
  - leads know how enterprise progress will be judged

## 3. Week 41

Target outcome:
Workspaces and teams become live enterprise primitives.

### `WLT-P2-4101` Implement workspace model v1

- Owner: `Platform lead`
- Epic: `WLT-P2-E02`
- Depends on: `WLT-P2-4002`
- Acceptance criteria:
  - enterprise workspaces are represented in the model
  - workspace identity and boundaries are clear
  - client and platform teams use the same semantics

### `WLT-P2-4102` Implement team membership and role assignment v1

- Owner: `Platform lead`
- Epic: `WLT-P2-E02`
- Depends on: `WLT-P2-4101`
- Acceptance criteria:
  - team membership works in the enterprise model
  - role assignment rules are explicit
  - revocation and edge cases are listed

### `WLT-P2-4103` Design the enterprise workspace shell

- Owner: `Design lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-4101`
- Acceptance criteria:
  - workspace shell structure is defined
  - operator navigation assumptions are explicit
  - the UI does not collapse under enterprise complexity

## 4. Week 42

Target outcome:
Vaults and sub-accounts are defined as safe enterprise operating constructs.

### `WLT-P2-4201` Define vault and sub-account model

- Owner: `Platform lead`
- Epic: `WLT-P2-E02`
- Depends on: `WLT-P2-4101`
- Acceptance criteria:
  - vault and sub-account semantics are explicit
  - relationship to workspaces and roles is clear
  - the model supports future custody expansion

### `WLT-P2-4202` Define treasury views and workflows

- Owner: `Product lead`
- Epic: `WLT-P2-E02`
- Depends on: `WLT-P2-4201`
- Acceptance criteria:
  - treasury jobs are reflected in the product plan
  - key views and actions are scoped
  - enterprise mode stays workflow-driven

### `WLT-P2-4203` Review vault risk and separation assumptions

- Owner: `Security lead`
- Epic: `WLT-P2-E02`
- Depends on: `WLT-P2-4201`
- Acceptance criteria:
  - trust boundaries around vaults are reviewed
  - risky assumptions are documented
  - the team knows where stronger controls will be needed

## 5. Week 43

Target outcome:
Approval workflows become operational enterprise machinery.

### `WLT-P2-4301` Implement approval workflow engine v1

- Owner: `Platform lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-4102`
- Acceptance criteria:
  - approval request creation works for enterprise actions
  - reviewer routing has working logic
  - queue states are explicit and traceable

### `WLT-P2-4302` Define reviewer experiences and queue behavior

- Owner: `Design lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-4301`
- Acceptance criteria:
  - queue interactions are clear
  - reviewers can understand what they are approving
  - escalation and timeout assumptions are visible

### `WLT-P2-4303` Review approval abuse cases

- Owner: `Security lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-4301`
- Acceptance criteria:
  - abuse paths for reviewer manipulation are documented
  - control gaps are listed
  - mitigations are assigned

## 6. Week 44

Target outcome:
The policy engine reaches usable enterprise form.

### `WLT-P2-4401` Implement policy engine surface v1

- Owner: `Platform lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-4301`
- Acceptance criteria:
  - enterprise policy bundles are usable
  - evaluation hooks work in the workflow path
  - policy outcomes are consistent

### `WLT-P2-4402` Define enterprise policy templates

- Owner: `Product lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-4401`
- Acceptance criteria:
  - starter policy templates exist
  - templates map to real enterprise jobs
  - operators can understand the intent of each template

### `WLT-P2-4403` Surface policy state in the enterprise UX

- Owner: `Client lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-4401`
- Acceptance criteria:
  - policy state is visible in the product
  - enterprise users can see what is enforced
  - UX reflects live policy outcomes rather than static copy

## 7. Week 45

Target outcome:
Spend controls and allowlists make enterprise operations governable.

### `WLT-P2-4501` Implement spend limits and control thresholds

- Owner: `Platform lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-4401`
- Acceptance criteria:
  - spend limits are represented and enforced
  - threshold behavior is explicit
  - the model supports later committee flows

### `WLT-P2-4502` Implement trusted counterparties and allowlists

- Owner: `Platform lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-4501`
- Acceptance criteria:
  - allowlists work for enterprise actions
  - trust status is visible to operators
  - update flows are reviewable

### `WLT-P2-4503` Define enterprise control messaging

- Owner: `Design lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-4501`, `WLT-P2-4502`
- Acceptance criteria:
  - enterprise users can understand the active controls
  - control messaging is clear rather than overly technical
  - UX avoids hidden rules that surprise operators

## 8. Week 46

Target outcome:
The enterprise UI becomes a real operating shell.

### `WLT-P2-4601` Implement workspace switcher and enterprise shell

- Owner: `Client lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-4103`
- Acceptance criteria:
  - workspace switcher exists
  - shell navigation reflects enterprise workflows
  - the UI can support operators with multiple contexts

### `WLT-P2-4602` Implement reviewer queue views

- Owner: `Client lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-4302`
- Acceptance criteria:
  - reviewers can see pending work
  - key request context is visible
  - the queue is usable without engineering guidance

### `WLT-P2-4603` Run enterprise UX review on shell complexity

- Owner: `Design lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-4601`, `WLT-P2-4602`
- Acceptance criteria:
  - navigation complexity is reviewed
  - enterprise friction is called out
  - the next UX simplifications are prioritized

## 9. Week 47

Target outcome:
Audit persistence becomes reliable and enterprise-grade.

### `WLT-P2-4701` Implement audit persistence v1

- Owner: `Platform lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-4301`, `WLT-P2-4401`
- Acceptance criteria:
  - audit events persist reliably
  - event lineage is preserved
  - enterprise actions stop depending on ephemeral state

### `WLT-P2-4702` Define evidence lineage rules

- Owner: `Platform lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-4701`
- Acceptance criteria:
  - links between request, policy, approval, and outcome are explicit
  - evidence lineage can be explained and tested
  - the rules support later export work

### `WLT-P2-4703` Define compliance-oriented review views

- Owner: `Design lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-4702`
- Acceptance criteria:
  - compliance review surfaces are designed
  - terminology aligns with enterprise use
  - the surface is distinct from generic activity feeds

## 10. Week 48

Target outcome:
Evidence export v1 becomes a usable enterprise deliverable.

### `WLT-P2-4801` Implement evidence export package v1

- Owner: `Platform lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-4702`
- Acceptance criteria:
  - export package structure exists
  - evidence can be assembled for review
  - enterprise exports are understandable outside engineering

### `WLT-P2-4802` Implement export review interface

- Owner: `Client lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-4801`
- Acceptance criteria:
  - exports can be reviewed in product form
  - users can understand what will be exported
  - the UI fits enterprise operator needs

### `WLT-P2-4803` Validate evidence package against buyer expectations

- Owner: `Program lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-4801`
- Acceptance criteria:
  - evidence package is reviewed against real enterprise expectations
  - gaps are documented
  - the team knows what remains before partner use

## 11. Week 49

Target outcome:
Delegated authority reduces single-user enterprise assumptions.

### `WLT-P2-4901` Implement delegated authority model

- Owner: `Platform lead`
- Epic: `WLT-P2-E02`
- Depends on: `WLT-P2-4102`
- Acceptance criteria:
  - delegated authority rules exist
  - separation of duties is represented
  - revocation flows are supported

### `WLT-P2-4902` Surface delegated authority in enterprise UX

- Owner: `Client lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-4901`
- Acceptance criteria:
  - delegated roles are visible
  - operators can understand who can act for what
  - the UI does not obscure role power

### `WLT-P2-4903` Review privilege-escalation risks

- Owner: `Security lead`
- Epic: `WLT-P2-E02`
- Depends on: `WLT-P2-4901`
- Acceptance criteria:
  - escalation risks are documented
  - control weaknesses are prioritized
  - the team knows what must be fixed before broader beta

## 12. Week 50

Target outcome:
Policy authoring reaches a first usable form for admins.

### `WLT-P2-5001` Define policy authoring model and workflow

- Owner: `Product lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-4402`
- Acceptance criteria:
  - authoring workflow is explicit
  - admin expectations are clear
  - the feature stays within Phase 2 scope

### `WLT-P2-5002` Implement policy authoring UX v0

- Owner: `Client lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-5001`
- Acceptance criteria:
  - policy authoring reaches working form
  - admins can create or update basic policy bundles
  - feedback from the UI is understandable

### `WLT-P2-5003` Review policy authoring safety boundaries

- Owner: `Security lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-5002`
- Acceptance criteria:
  - risky authoring flows are identified
  - guardrail requirements are listed
  - unsafe admin shortcuts are rejected explicitly

## 13. Week 51

Target outcome:
Private app catalogs and enterprise distribution rules begin to exist.

### `WLT-P2-5101` Define private app catalog model v0

- Owner: `Product lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-4202`
- Acceptance criteria:
  - private catalog object model exists
  - workspace-level app visibility is defined
  - future tenant isolation is not blocked

### `WLT-P2-5102` Implement enterprise catalog permissions

- Owner: `Connect lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-5101`
- Acceptance criteria:
  - app permission rules are tied to enterprise context
  - catalog entries respect workspace boundaries
  - distribution logic is reviewable

### `WLT-P2-5103` Implement enterprise app catalog surface v0

- Owner: `Client lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-5101`
- Acceptance criteria:
  - enterprise catalog is visible in the product
  - distribution boundaries are understandable
  - the surface reflects app trust and availability correctly

## 14. Week 52

Target outcome:
Design partner 1 enters with a controlled enterprise environment.

### `WLT-P2-5201` Select and confirm enterprise design partner 1

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-4803`
- Acceptance criteria:
  - partner 1 is named
  - target workflow is explicit
  - success conditions are documented

### `WLT-P2-5202` Prepare partner 1 environment and onboarding

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-5201`, `WLT-P2-5103`
- Acceptance criteria:
  - onboarding pack exists
  - support path is assigned
  - the environment is configured for the scoped workflow

### `WLT-P2-5203` Launch partner 1 in controlled beta

- Owner: `Client lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-5202`
- Acceptance criteria:
  - partner 1 starts operating in a controlled workflow
  - issues are captured immediately
  - the team has live visibility into usage and friction

## 15. Week 53

Target outcome:
Partner 1 feedback drives concrete product correction.

### `WLT-P2-5301` Summarize partner 1 feedback and blockers

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-5203`
- Acceptance criteria:
  - critical friction points are ranked
  - workflow blockers are visible
  - owners are assigned to the response plan

### `WLT-P2-5302` Fix top approval and audit gaps from partner 1

- Owner: `Platform lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-5301`
- Acceptance criteria:
  - highest-priority approval or audit issues are addressed
  - improvement is visible in the partner workflow
  - remaining issues are explicitly deferred or scheduled

### `WLT-P2-5303` Simplify partner 1 enterprise UX pain points

- Owner: `Design lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-5301`
- Acceptance criteria:
  - usability issues are revised
  - operator confusion is reduced
  - updated UX is reviewed with engineering

## 16. Week 54

Target outcome:
Higher-assurance enterprise approvals become credible.

### `WLT-P2-5401` Implement dual-control approvals

- Owner: `Platform lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-4301`
- Acceptance criteria:
  - dual-control routing works
  - role participation rules are explicit
  - evidence captures the chain correctly

### `WLT-P2-5402` Implement committee approval support

- Owner: `Platform lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-5401`
- Acceptance criteria:
  - committee review and quorum handling exist
  - expiry or escalation behavior is defined
  - the flow is usable for enterprise review

### `WLT-P2-5403` Review higher-assurance approval abuse cases

- Owner: `Security lead`
- Epic: `WLT-P2-E03`
- Depends on: `WLT-P2-5401`, `WLT-P2-5402`
- Acceptance criteria:
  - committee and dual-control abuse cases are reviewed
  - required mitigations are listed
  - enterprise beta risk posture is updated

## 17. Week 55

Target outcome:
Compliance and control review surfaces become buyer-legible.

### `WLT-P2-5501` Implement compliance review surfaces

- Owner: `Client lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-4703`, `WLT-P2-4802`
- Acceptance criteria:
  - compliance users can inspect relevant controls and evidence
  - terminology is enterprise-appropriate
  - the surface supports review rather than generic browsing

### `WLT-P2-5502` Implement policy status views

- Owner: `Client lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-5002`
- Acceptance criteria:
  - policy status is visible and understandable
  - admins can see what is active and what changed
  - the surface supports real enterprise operations

### `WLT-P2-5503` Validate enterprise language and control clarity

- Owner: `Product lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-5501`, `WLT-P2-5502`
- Acceptance criteria:
  - enterprise language matches buyer expectations
  - unclear control wording is removed
  - partner learnability improves

## 18. Week 56

Target outcome:
Admin console v1 reaches coherent beta form.

### `WLT-P2-5601` Implement admin console v1 shell

- Owner: `Client lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-4601`, `WLT-P2-5002`
- Acceptance criteria:
  - admin console shell exists
  - primary admin domains are visible
  - the product can host real administration workflows

### `WLT-P2-5602` Implement role and policy admin views

- Owner: `Client lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-5601`
- Acceptance criteria:
  - roles and policy administration are usable
  - admins can review and act without engineering help
  - permissions around administration are respected

### `WLT-P2-5603` Review admin risk and misconfiguration cases

- Owner: `Security lead`
- Epic: `WLT-P2-E05`
- Depends on: `WLT-P2-5602`
- Acceptance criteria:
  - admin misuse cases are documented
  - high-risk misconfiguration paths are identified
  - required protections are prioritized

## 19. Week 57

Target outcome:
Enterprise operations across surfaces and alerting become explicit.

### `WLT-P2-5701` Define enterprise mobile review requirements

- Owner: `Product lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-5601`
- Acceptance criteria:
  - mobile review requirements are documented
  - enterprise operator expectations are clear
  - Phase 2 and later scope boundaries are explicit

### `WLT-P2-5702` Define operational alerting strategy

- Owner: `Program lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-3501`
- Acceptance criteria:
  - alerting priorities are explicit
  - enterprise operational ownership is defined
  - the product can support real operator attention flows

### `WLT-P2-5703` Define degraded-mode enterprise behavior

- Owner: `Platform lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-4701`, `WLT-P2-5601`
- Acceptance criteria:
  - degraded behavior is documented
  - enterprise users know what happens under failure
  - resilience planning has concrete inputs

## 20. Week 58

Target outcome:
A second enterprise design partner validates broader fit.

### `WLT-P2-5801` Select and confirm enterprise design partner 2

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-5301`
- Acceptance criteria:
  - partner 2 is named
  - its workflow differs meaningfully from partner 1
  - success criteria are documented

### `WLT-P2-5802` Prepare partner 2 onboarding and environment

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-5801`
- Acceptance criteria:
  - onboarding pack is adapted for partner 2
  - support ownership is explicit
  - configuration is ready for the selected workflow

### `WLT-P2-5803` Launch partner 2 in controlled beta

- Owner: `Client lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-5802`
- Acceptance criteria:
  - partner 2 begins controlled use
  - key issues are visible early
  - the team can compare partner 2 with partner 1 behavior

## 21. Week 59

Target outcome:
Enterprise mode grows more resilient under repeated use and failure.

### `WLT-P2-5901` Improve queue recovery and retry behavior

- Owner: `Platform lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-4301`, `WLT-P2-5703`
- Acceptance criteria:
  - queue recovery works reliably
  - retry and failure semantics are explicit
  - operators are not left in ambiguous queue states

### `WLT-P2-5902` Improve enterprise reconnect and session reliability

- Owner: `Connect lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-2203`, `WLT-P2-5803`
- Acceptance criteria:
  - repeat enterprise sessions improve
  - reconnect behavior is more reliable
  - high-frequency operator flows degrade less often

### `WLT-P2-5903` Run resilience review on enterprise failures

- Owner: `Security lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-5901`, `WLT-P2-5902`
- Acceptance criteria:
  - top failure modes are reviewed
  - resilience risks are documented
  - remaining weaknesses are assigned

## 22. Week 60

Target outcome:
Enterprise value becomes measurable through reporting and analytics.

### `WLT-P2-6001` Define enterprise analytics model

- Owner: `Product lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-4001`
- Acceptance criteria:
  - analytics goals are clear
  - metrics map to enterprise value
  - the model avoids vanity-only reporting

### `WLT-P2-6002` Implement reporting and analytics surfaces

- Owner: `Client lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-6001`
- Acceptance criteria:
  - reporting views exist
  - policy coverage and approval metrics are visible
  - the UI is understandable to business users

### `WLT-P2-6003` Validate metrics with partner workflows

- Owner: `Program lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-6002`
- Acceptance criteria:
  - metrics are reviewed against partner reality
  - weak or misleading metrics are identified
  - the team knows which measures matter for Phase 2 exit

## 23. Week 61

Target outcome:
The institutional custody path is credible enough for enterprise roadmap confidence.

### `WLT-P2-6101` Define the institutional custody integration strategy

- Owner: `Wallet core lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-4201`
- Acceptance criteria:
  - custody integration path is explicit
  - partner boundaries are defined
  - the roadmap is credible beyond local key management

### `WLT-P2-6102` Define HSM and MPC boundary assumptions

- Owner: `Wallet core lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-6101`
- Acceptance criteria:
  - HSM and MPC assumptions are documented
  - ownership versus integration boundaries are clear
  - later sovereign work is not blocked

### `WLT-P2-6103` Review custody integration risk

- Owner: `Security lead`
- Epic: `WLT-P2-E06`
- Depends on: `WLT-P2-6101`, `WLT-P2-6102`
- Acceptance criteria:
  - new custody risks are documented
  - control assumptions are reviewed
  - remaining open questions are explicit

## 24. Week 62

Target outcome:
Enterprise beta receives a focused security gate before freeze.

### `WLT-P2-6201` Update the enterprise threat model

- Owner: `Security lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-5302`, `WLT-P2-5603`, `WLT-P2-6103`
- Acceptance criteria:
  - enterprise threat model reflects current reality
  - major attack paths are ranked
  - the model is usable in beta go or no-go decisions

### `WLT-P2-6202` Retest approval abuse and admin misuse cases

- Owner: `Security lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6201`
- Acceptance criteria:
  - critical abuse cases are re-evaluated
  - regressions are identified
  - fixes or risk acceptances are explicit

### `WLT-P2-6203` Define the enterprise beta release gate

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6201`, `WLT-P2-6202`
- Acceptance criteria:
  - go or no-go criteria are explicit
  - ownership for unresolved issues is clear
  - the team can freeze or continue with confidence

## 25. Week 63

Target outcome:
The team rehearses enterprise beta end to end before the freeze.

### `WLT-P2-6301` Run internal enterprise pilot rehearsal

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6203`
- Acceptance criteria:
  - a full enterprise workflow is rehearsed
  - all lead roles are represented in the rehearsal
  - defects and confusion points are captured

### `WLT-P2-6302` Rehearse evidence export and review chain

- Owner: `Platform lead`
- Epic: `WLT-P2-E04`
- Depends on: `WLT-P2-4801`, `WLT-P2-6301`
- Acceptance criteria:
  - evidence review works under rehearsal conditions
  - missing links are exposed
  - export handling is tested as a real operational flow

### `WLT-P2-6303` Rehearse partner support and escalation

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6301`
- Acceptance criteria:
  - partner support workflow is tested
  - escalation responsibilities are clear
  - the team can support beta without improvisation

## 26. Week 64

Target outcome:
Enterprise beta stabilizes under a controlled freeze.

### `WLT-P2-6401` Freeze the enterprise beta scope

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6301`
- Acceptance criteria:
  - no new scope enters beta casually
  - final defect priorities are clear
  - the team stops churn before exit review

### `WLT-P2-6402` Burn down critical defects

- Owner: `Client lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6401`
- Acceptance criteria:
  - critical issues are reduced materially
  - partner-impacting defects are prioritized
  - remaining issues are clearly documented

### `WLT-P2-6403` Finalize partner and beta documentation

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6401`
- Acceptance criteria:
  - beta docs are current
  - partner expectations are explicit
  - documentation matches the actual product state

## 27. Week 65

Target outcome:
Phase 2 closes with proven enterprise value and a clean move into Phase 3.

### `WLT-P2-6501` Run the Phase 2 exit review

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6402`, `WLT-P2-6403`
- Acceptance criteria:
  - exit review is evidence-based
  - partner results are summarized clearly
  - pass, conditional pass, or fail is declared

### `WLT-P2-6502` Confirm enterprise design-partner outcomes

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6501`
- Acceptance criteria:
  - partner 1 and partner 2 outcomes are documented
  - meaningful workflow activity is demonstrated
  - gaps carried into Phase 3 are explicit

### `WLT-P2-6503` Produce the Phase 3 entry backlog

- Owner: `Program lead`
- Epic: `WLT-P2-E07`
- Depends on: `WLT-P2-6501`
- Acceptance criteria:
  - Phase 3 starting backlog exists
  - sovereign dependencies are visible
  - the team can move into the next phase without rebuilding enterprise context
