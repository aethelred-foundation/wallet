# Aethelred Wallet Phase 1 Tickets

Date: 2026-04-10
Status: Local execution backlog
Scope: Weeks 14-39
Related:

- `wallet/AETHELRED_WALLET_PHASE1_EPICS_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE1_DELIVERY_BOARD_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PHASE1_ALPHA_AND_PARTNER_PLAN_2026-04-10.md`

## 1. How To Use This Backlog

- Each week has a target outcome.
- Each ticket is shaped for immediate assignment.
- Acceptance criteria define the minimum done bar.
- If a week slips, explicitly reassign the work instead of carrying silent debt.

## 2. Week 14

Target outcome:
Phase 1 begins with a locked Personal / Pro scope and agreed alpha user journeys.

### `WLT-P1-1401` Lock the Personal / Pro scope

- Owner: `Program lead`
- Epic: `WLT-P1-E01`
- Depends on: Phase 0 exit
- Acceptance criteria:
  - Personal and Pro boundaries are explicit
  - deferred features are written down
  - no team is building features outside the cut

### `WLT-P1-1402` Finalize alpha personas and user journeys

- Owner: `Design lead`
- Epic: `WLT-P1-E01`
- Depends on: `WLT-P1-1401`
- Acceptance criteria:
  - onboarding, connect, sign, and account journeys are mapped
  - personal and pro differences are clear
  - teams can build from one shared flow set

### `WLT-P1-1403` Define Phase 1 success metrics

- Owner: `Program lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-1401`
- Acceptance criteria:
  - internal alpha metrics are defined
  - design-partner readiness metrics are defined
  - review cadence is attached to these metrics

## 3. Week 15

Target outcome:
The extension UX has a stable structure and design direction.

### `WLT-P1-1501` Finalize popup information architecture

- Owner: `Design lead`
- Epic: `WLT-P1-E01`
- Depends on: `WLT-P1-1402`
- Acceptance criteria:
  - popup structure is stable
  - priority views are sequenced clearly
  - no major navigation uncertainty remains

### `WLT-P1-1502` Finalize settings and shell navigation

- Owner: `Client lead`
- Epic: `WLT-P1-E01`
- Depends on: `WLT-P1-1501`
- Acceptance criteria:
  - settings shell is mapped
  - navigation states are handled clearly
  - extension surfaces share one navigation model

### `WLT-P1-1503` Establish the wallet UI design system v0

- Owner: `Design lead`
- Epic: `WLT-P1-E01`
- Depends on: `WLT-P1-1501`
- Acceptance criteria:
  - component direction is defined
  - trust, warning, and approval visual language is consistent
  - client engineering can implement without ad hoc styling

## 4. Week 16

Target outcome:
Onboarding architecture is coherent before implementation expands.

### `WLT-P1-1601` Define account creation flow v0

- Owner: `Design lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-1402`
- Acceptance criteria:
  - create-account path is mapped
  - required user states are known
  - unresolved trust questions are listed

### `WLT-P1-1602` Define import flow v0

- Owner: `Wallet core lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-1601`
- Acceptance criteria:
  - import modes are listed
  - high-risk edge cases are identified
  - client and design teams can implement from one spec

### `WLT-P1-1603` Define first-connect onboarding behavior

- Owner: `Client lead`
- Epic: `WLT-P1-E03`
- Depends on: `WLT-P1-1601`, `WLT-P1-1602`
- Acceptance criteria:
  - connect-first-use behavior is defined
  - session creation and account selection touchpoints are clear
  - the onboarding path is not fragmented across surfaces

## 5. Week 17

Target outcome:
Passkey strategy is settled and connected to the product model.

### `WLT-P1-1701` Lock the passkey technical strategy

- Owner: `Wallet core lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-1601`
- Acceptance criteria:
  - passkey assumptions are explicit
  - device and browser constraints are known
  - implementation sequence is written

### `WLT-P1-1702` Define passkey onboarding UX

- Owner: `Design lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-1701`
- Acceptance criteria:
  - copy and flow are ready for implementation
  - failure states are designed
  - product and engineering agree on the first pass

### `WLT-P1-1703` Review passkey and recovery risk assumptions

- Owner: `Security lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-1701`
- Acceptance criteria:
  - major trust risks are documented
  - required mitigations are listed
  - the team knows what cannot be hand-waved in implementation

## 6. Week 18

Target outcome:
The connect flow becomes a real product surface for the first first-party path.

### `WLT-P1-1801` Implement account picker and connect flow

- Owner: `Client lead`
- Epic: `WLT-P1-E03`
- Depends on: `WLT-P1-1603`
- Acceptance criteria:
  - users can choose accounts clearly
  - connect flow is stable in the extension
  - the first-party flow is demoable

### `WLT-P1-1802` Implement session creation and connect state handling

- Owner: `Connect lead`
- Epic: `WLT-P1-E03`
- Depends on: `WLT-P1-1801`
- Acceptance criteria:
  - session creation is represented in state
  - connect and reconnect behavior is deterministic
  - session failures are understandable

### `WLT-P1-1803` Validate the first live connect integration

- Owner: `App liaison`
- Epic: `WLT-P1-E03`
- Depends on: `WLT-P1-1801`, `WLT-P1-1802`
- Acceptance criteria:
  - at least one first-party app connects successfully
  - blockers are documented
  - product and engineering review the outcome together

## 7. Week 19

Target outcome:
Message signing looks like a trust product, not a raw prompt.

### `WLT-P1-1901` Implement human-readable message signing

- Owner: `Client lead`
- Epic: `WLT-P1-E04`
- Depends on: `WLT-P1-1503`, `WLT-P1-1802`
- Acceptance criteria:
  - message requests are rendered clearly
  - app and trust context are visible
  - the flow is not developer-only in tone

### `WLT-P1-1902` Implement audit visibility for message signing

- Owner: `Platform lead`
- Epic: `WLT-P1-E04`
- Depends on: `WLT-P1-1901`
- Acceptance criteria:
  - message signing events are traceable
  - audit context is attached correctly
  - review state is inspectable

### `WLT-P1-1903` Review sign-message risk messaging

- Owner: `Security lead`
- Epic: `WLT-P1-E04`
- Depends on: `WLT-P1-1901`
- Acceptance criteria:
  - phishing and confusing message cases are reviewed
  - trust messaging is strengthened where needed
  - known gaps are documented

## 8. Week 20

Target outcome:
Transaction approval reaches a differentiated product standard.

### `WLT-P1-2001` Implement transaction approval modal v1

- Owner: `Client lead`
- Epic: `WLT-P1-E04`
- Depends on: `WLT-P1-1503`, `WLT-P1-1901`
- Acceptance criteria:
  - approval modal handles the primary transaction path
  - account, app, and action context are visible
  - basic edge cases do not break the surface

### `WLT-P1-2002` Add trust, impact, and policy sections

- Owner: `Platform lead`
- Epic: `WLT-P1-E04`
- Depends on: `WLT-P1-2001`
- Acceptance criteria:
  - trust state is visible
  - impact summary is visible
  - policy state is visible

### `WLT-P1-2003` Review transaction approval language and fallback states

- Owner: `Design lead`
- Epic: `WLT-P1-E04`
- Depends on: `WLT-P1-2001`, `WLT-P1-2002`
- Acceptance criteria:
  - unclear copy is removed
  - loading, error, and unsupported states are handled
  - product review signs off on the interaction

## 9. Week 21

Target outcome:
Simulation and warnings v0 are attached to supported transaction paths.

### `WLT-P1-2101` Define the simulation adapter path

- Owner: `Connect lead`
- Epic: `WLT-P1-E04`
- Depends on: `WLT-P1-2002`
- Acceptance criteria:
  - supported transaction classes are defined
  - simulation architecture is documented
  - unsupported classes are clearly called out

### `WLT-P1-2102` Implement risk-summary rendering v0

- Owner: `Client lead`
- Epic: `WLT-P1-E04`
- Depends on: `WLT-P1-2101`
- Acceptance criteria:
  - risk summaries render cleanly
  - consequence visibility improves approval clarity
  - warning presentation fits the wallet design language

### `WLT-P1-2103` Define warning rules and copy

- Owner: `Security lead`
- Epic: `WLT-P1-E04`
- Depends on: `WLT-P1-2101`
- Acceptance criteria:
  - warning rules are written
  - warning copy avoids panic and vagueness
  - product can implement from a known ruleset

## 10. Week 22

Target outcome:
App sessions and permission controls become visible and manageable.

### `WLT-P1-2201` Implement app permission model v0

- Owner: `Platform lead`
- Epic: `WLT-P1-E03`
- Depends on: `WLT-P1-1802`
- Acceptance criteria:
  - permission states are defined in the product
  - app trust level and permission scope are visible
  - permission changes can be tracked

### `WLT-P1-2202` Implement session manager UI

- Owner: `Client lead`
- Epic: `WLT-P1-E03`
- Depends on: `WLT-P1-2201`
- Acceptance criteria:
  - active sessions are visible
  - permission summaries are readable
  - revoke flows exist

### `WLT-P1-2203` Implement revoke and expire flows

- Owner: `Connect lead`
- Epic: `WLT-P1-E03`
- Depends on: `WLT-P1-2201`, `WLT-P1-2202`
- Acceptance criteria:
  - sessions can be revoked
  - expiry handling is represented
  - session state is reliable after revocation

## 11. Week 23

Target outcome:
Account management moves from prototype state into a usable wallet surface.

### `WLT-P1-2301` Implement account registry UI

- Owner: `Client lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-1602`, `WLT-P1-2202`
- Acceptance criteria:
  - accounts can be browsed and understood
  - account identity is visible without ambiguity
  - the surface works with the current model

### `WLT-P1-2302` Implement account labels and switching

- Owner: `Client lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-2301`
- Acceptance criteria:
  - account labels are editable
  - switching is stable
  - selected account state is consistent across key flows

### `WLT-P1-2303` Wire import surfaces into account management

- Owner: `Wallet core lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-1602`, `WLT-P1-2301`
- Acceptance criteria:
  - import surfaces connect to the live account model
  - error handling is present
  - the flow is usable for controlled alpha

## 12. Week 24

Target outcome:
Users can see what happened in the wallet through activity and notification surfaces.

### `WLT-P1-2401` Define the activity feed model

- Owner: `Platform lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-1902`, `WLT-P1-2201`
- Acceptance criteria:
  - activity object types are defined
  - event ordering rules are clear
  - the model supports later audit alignment

### `WLT-P1-2402` Implement the activity surface v0

- Owner: `Client lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-2401`
- Acceptance criteria:
  - key actions appear in one feed
  - users can interpret what happened
  - the surface is usable in internal alpha

### `WLT-P1-2403` Define and implement notification taxonomy v0

- Owner: `Client lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-2401`
- Acceptance criteria:
  - notification types are defined
  - high-priority actions are surfaced clearly
  - the team can expand the model later without redesign

## 13. Week 25

Target outcome:
The wallet begins to reflect Aethelred-native use cases beyond connection.

### `WLT-P1-2501` Define governance product requirements

- Owner: `Product lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-1401`
- Acceptance criteria:
  - governance user jobs are defined
  - wallet role in governance is explicit
  - phase scope is clear

### `WLT-P1-2502` Define staking product requirements

- Owner: `Product lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-1401`
- Acceptance criteria:
  - staking user jobs are defined
  - asset and validator assumptions are documented
  - the scope is appropriate for Phase 1

### `WLT-P1-2503` Create governance and staking IA prototypes

- Owner: `Design lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-2501`, `WLT-P1-2502`
- Acceptance criteria:
  - prototype flows exist
  - tradeoffs are visible
  - product and engineering can estimate from them

## 14. Week 26

Target outcome:
Contacts and trusted destinations make repeat actions safer and more usable.

### `WLT-P1-2601` Define the contact and address-book model

- Owner: `Platform lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-2301`
- Acceptance criteria:
  - contact fields are defined
  - trust markers are part of the model
  - the model can support destination safety work

### `WLT-P1-2602` Implement trusted destination UX

- Owner: `Client lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-2601`
- Acceptance criteria:
  - users can save trusted destinations
  - trust state is visible in send or approval surfaces
  - the flow is simple enough for regular use

### `WLT-P1-2603` Define destination verification rules

- Owner: `Security lead`
- Epic: `WLT-P1-E05`
- Depends on: `WLT-P1-2601`
- Acceptance criteria:
  - verification rules are documented
  - risky destination patterns are called out
  - the design avoids accidental false trust

## 15. Week 27

Target outcome:
Recovery moves from an abstract requirement to a designed product path.

### `WLT-P1-2701` Define recovery requirements and principles

- Owner: `Wallet core lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-1701`
- Acceptance criteria:
  - recovery goals are explicit
  - user and security tradeoffs are documented
  - out-of-scope methods are acknowledged

### `WLT-P1-2702` Design backup and recovery guidance

- Owner: `Design lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-2701`
- Acceptance criteria:
  - recovery guidance is readable
  - high-stress user scenarios are considered
  - the flow is ready for implementation

### `WLT-P1-2703` Define recovery failure playbooks

- Owner: `Security lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-2701`
- Acceptance criteria:
  - major failure modes are documented
  - team response assumptions are known
  - support and product have a shared view

## 16. Week 28

Target outcome:
Recovery v0 exists in product form.

### `WLT-P1-2801` Implement recovery flow v0

- Owner: `Client lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-2702`
- Acceptance criteria:
  - core recovery flow is implemented
  - the flow is testable in alpha
  - the UI is understandable without team guidance

### `WLT-P1-2802` Implement backup-state handling

- Owner: `Wallet core lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-2701`, `WLT-P1-2801`
- Acceptance criteria:
  - backup state is represented correctly
  - product assumptions match the storage model
  - known gaps are documented

### `WLT-P1-2803` Review recovery flow with Security and Support

- Owner: `Security lead`
- Epic: `WLT-P1-E02`
- Depends on: `WLT-P1-2801`, `WLT-P1-2802`
- Acceptance criteria:
  - recovery review is completed
  - critical issues are logged
  - the team agrees on whether v0 is acceptable for alpha

## 17. Week 29

Target outcome:
Hardware support is no longer a vague roadmap item.

### `WLT-P1-2901` Choose the hardware-wallet integration path

- Owner: `Wallet core lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-2303`
- Acceptance criteria:
  - candidate partner path is selected
  - integration assumptions are explicit
  - product impact is documented

### `WLT-P1-2902` Define the hardware-wallet UX

- Owner: `Design lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-2901`
- Acceptance criteria:
  - setup and signing flows are designed
  - failure states are considered
  - the flow feels consistent with the rest of the wallet

### `WLT-P1-2903` Define hardware trust and fallback rules

- Owner: `Security lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-2901`
- Acceptance criteria:
  - trust assumptions are documented
  - fallback paths are reviewed
  - unsafe shortcuts are explicitly prohibited

## 18. Week 30

Target outcome:
The team has a real hardware prototype and security review path.

### `WLT-P1-3001` Build the hardware-wallet prototype

- Owner: `Wallet core lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-2901`
- Acceptance criteria:
  - import or signing proof exists
  - integration blockers are visible
  - the prototype is demoable

### `WLT-P1-3002` Wire the prototype into the wallet shell

- Owner: `Client lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3001`, `WLT-P1-2902`
- Acceptance criteria:
  - the hardware path is visible in the product
  - users can understand when they are using hardware mode
  - the shell does not break around the new path

### `WLT-P1-3003` Review hardware prototype risk

- Owner: `Security lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3001`
- Acceptance criteria:
  - prototype-specific risks are documented
  - required fixes are prioritized
  - the team knows the acceptable alpha boundary

## 19. Week 31

Target outcome:
Mobile work can begin without fragmenting the architecture.

### `WLT-P1-3101` Define the shared mobile architecture

- Owner: `Program lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-1401`, `WLT-P1-2201`
- Acceptance criteria:
  - shared contracts and boundaries are explicit
  - mobile does not fork the core model
  - platform choice is recorded

### `WLT-P1-3102` Extract shared contracts needed by mobile

- Owner: `Connect lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3101`
- Acceptance criteria:
  - the shared interfaces are ready for reuse
  - duplication is reduced
  - mobile can consume the same conceptual model

### `WLT-P1-3103` Define the mobile alpha scope

- Owner: `Product lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3101`
- Acceptance criteria:
  - mobile v0 scope is explicit
  - unsupported features are listed
  - the team does not overbuild mobile in Phase 1

## 20. Week 32

Target outcome:
Mobile shell v0 exists and reflects the core wallet model.

### `WLT-P1-3201` Create the mobile shell scaffold

- Owner: `Mobile lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3101`, `WLT-P1-3102`
- Acceptance criteria:
  - mobile shell boots
  - core navigation concept exists
  - the project is ready for iterative expansion

### `WLT-P1-3202` Implement connect and approval concept views on mobile

- Owner: `Mobile lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3201`
- Acceptance criteria:
  - connect and approval ideas are visible on mobile
  - the product relationship between extension and mobile is understandable
  - parity gaps are captured

### `WLT-P1-3203` Produce the mobile parity gap list

- Owner: `Program lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3202`
- Acceptance criteria:
  - extension-mobile gaps are documented
  - the team knows what remains Phase 1 versus Phase 2+
  - the gap list is used in planning

## 21. Week 33

Target outcome:
Cross-device connection planning becomes concrete through WalletConnect strategy and prototype.

### `WLT-P1-3301` Finalize the WalletConnect integration strategy

- Owner: `Connect lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3101`
- Acceptance criteria:
  - scope and use cases are explicit
  - integration architecture is documented
  - risk and dependency assumptions are clear

### `WLT-P1-3302` Prototype WalletConnect pairing flow

- Owner: `Connect lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3301`
- Acceptance criteria:
  - one pairing proof exists
  - limitations are visible
  - product and engineering can estimate follow-on work

### `WLT-P1-3303` Define cross-device UX assumptions

- Owner: `Design lead`
- Epic: `WLT-P1-E06`
- Depends on: `WLT-P1-3302`
- Acceptance criteria:
  - cross-device user expectations are defined
  - handoff and error states are captured
  - design and connect leads align on the next steps

## 22. Week 34

Target outcome:
The wallet begins to function as an application shell through a curated first-party catalog.

### `WLT-P1-3401` Define app catalog metadata and trust states

- Owner: `Product lead`
- Epic: `WLT-P1-E07`
- Depends on: `WLT-P1-1401`
- Acceptance criteria:
  - catalog metadata fields are defined
  - trust states are explicit
  - the model works for first-party apps

### `WLT-P1-3402` Implement app catalog surface v0

- Owner: `Client lead`
- Epic: `WLT-P1-E07`
- Depends on: `WLT-P1-3401`
- Acceptance criteria:
  - app catalog exists in the wallet shell
  - users can see first-party app entries
  - trust state presentation is clear

### `WLT-P1-3403` Define install and permission assumptions for catalog apps

- Owner: `Connect lead`
- Epic: `WLT-P1-E07`
- Depends on: `WLT-P1-3401`
- Acceptance criteria:
  - install and permission behavior is documented
  - catalog does not bypass the existing trust model
  - future expansion path is known

## 23. Week 35

Target outcome:
The internal alpha becomes observable and supportable.

### `WLT-P1-3501` Implement telemetry and diagnostics v0

- Owner: `Platform lead`
- Epic: `WLT-P1-E07`
- Depends on: `WLT-P1-2401`, `WLT-P1-3402`
- Acceptance criteria:
  - alpha telemetry captures the right events
  - diagnostic surfaces exist for support
  - privacy and trust assumptions are respected

### `WLT-P1-3502` Create the alpha support runbook

- Owner: `Program lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3501`
- Acceptance criteria:
  - support owners and response rules are documented
  - issue triage paths are defined
  - the runbook is usable by the team

### `WLT-P1-3503` Define the internal alpha release checklist

- Owner: `Security lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3501`
- Acceptance criteria:
  - alpha release gates are explicit
  - known-risk handling is documented
  - no alpha release is based on guesswork

## 24. Week 36

Target outcome:
Internal teams start using the wallet in controlled real flows.

### `WLT-P1-3601` Select the internal alpha cohort

- Owner: `Program lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3503`
- Acceptance criteria:
  - the alpha cohort is named
  - target use cases are explicit
  - feedback channels are assigned

### `WLT-P1-3602` Launch internal alpha for targeted flows

- Owner: `Client lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3601`
- Acceptance criteria:
  - alpha participants can use the wallet in scoped flows
  - issues are captured in real time
  - the launch is controlled rather than broad and chaotic

### `WLT-P1-3603` Capture initial alpha signals

- Owner: `Program lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3602`
- Acceptance criteria:
  - first-week alpha issues are summarized
  - top friction areas are ranked
  - the team has a remediation plan for Week 37

## 25. Week 37

Target outcome:
Alpha feedback is turned into concrete product improvement.

### `WLT-P1-3701` Burn down top alpha defects

- Owner: `Client lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3603`
- Acceptance criteria:
  - highest-severity defects are addressed
  - tracked regressions are reduced
  - improvement is visible in the alpha experience

### `WLT-P1-3702` Simplify confusing flows

- Owner: `Design lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3603`
- Acceptance criteria:
  - the most confusing journeys are revised
  - approval and onboarding clarity improve
  - product changes are based on real usage

### `WLT-P1-3703` Improve reliability on repeated use

- Owner: `Connect lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3603`
- Acceptance criteria:
  - repeat connect and session flows improve
  - common flaky behaviors are reduced
  - reliability findings are documented

## 26. Week 38

Target outcome:
The team is ready to onboard external design partners deliberately.

### `WLT-P1-3801` Create the design-partner onboarding pack

- Owner: `Program lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3502`, `WLT-P1-3701`
- Acceptance criteria:
  - onboarding steps are documented
  - supported flows and limits are explicit
  - partner-facing expectations are clear

### `WLT-P1-3802` Create the design-partner product walkthrough

- Owner: `Design lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3702`
- Acceptance criteria:
  - partner walkthrough exists
  - trust posture is explained clearly
  - the walkthrough does not overpromise beyond Phase 1 reality

### `WLT-P1-3803` Define partner success criteria and review cadence

- Owner: `Program lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3801`
- Acceptance criteria:
  - partner goals are explicit
  - review rhythm is agreed
  - the team knows how success will be measured

## 27. Week 39

Target outcome:
Phase 1 closes with a credible Personal / Pro product and a clear handoff into Enterprise Mode.

### `WLT-P1-3901` Run the Phase 1 exit review

- Owner: `Program lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3801`, `WLT-P1-3803`
- Acceptance criteria:
  - exit review is evidence-based
  - pass, conditional pass, or fail is declared
  - all leads align on the result

### `WLT-P1-3902` Confirm design-partner readiness

- Owner: `Security lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3901`
- Acceptance criteria:
  - trust posture for controlled partner use is reviewed
  - known risks are documented
  - partner launch assumptions are explicit

### `WLT-P1-3903` Produce the Phase 2 entry backlog

- Owner: `Program lead`
- Epic: `WLT-P1-E08`
- Depends on: `WLT-P1-3901`
- Acceptance criteria:
  - enterprise-mode starting backlog is drafted
  - unresolved dependencies are carried forward cleanly
  - the team can enter Phase 2 without re-planning from zero
