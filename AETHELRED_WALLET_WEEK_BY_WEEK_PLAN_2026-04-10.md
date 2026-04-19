# Aethelred Wallet Week-by-Week Plan

Date: 2026-04-10
Status: Local execution plan
Related:

- `wallet/AETHELRED_WALLET_DECISION_MEMO_2026-04-10.md`
- `wallet/AETHELRED_WALLET_PRD_2026-04-10.md`
- `wallet/AETHELRED_WALLET_ARCHITECTURE_RFC_2026-04-10.md`
- `wallet/AETHELRED_WALLET_BUILD_PLAN_2026-04-10.md`
- `wallet/AETHELRED_WALLET_SPRINT0_BACKLOG_2026-04-10.md`

## 1. Plan Assumption

This plan maps the full wallet program to the current 18-month roadmap in the PRD.

Planning assumption:

- `Week 1` starts on `April 13, 2026`
- the plan runs through `Week 78`, ending around `October 10, 2027`

The purpose of this document is not to lock every implementation detail.
It is to give the team a disciplined week-by-week operating plan that preserves the strategic sequence:

1. compatibility and trust kernel
2. personal and pro wallet
3. enterprise controls
4. sovereign mode and app platform

## 2. Recurring Weekly Cadence

Every week should include:

- one architecture review
- one product and design review
- one live demo
- one security checkpoint
- one updated risk and decision log

Every fourth week should include:

- milestone review against exit criteria
- scope correction if the program is drifting
- leadership summary

## 3. Program Phases

- `Phase 0` Weeks 1-13: Compatibility and Trust Kernel
- `Phase 1` Weeks 14-39: Aethelred Wallet Personal / Pro
- `Phase 2` Weeks 40-65: Enterprise Mode
- `Phase 3` Weeks 66-78: Sovereign Mode and App Platform

## 4. Phase 0: Compatibility and Trust Kernel

Date range:

- `Week 1` to `Week 13`
- `April 13, 2026` to `July 12, 2026`

| Week | Focus | Planned outputs | Review gate |
| --- | --- | --- | --- |
| 1 | Program kickoff and scope lock | Owners assigned, kickoff completed, workstreams confirmed, first integration targets shortlisted | Team operating model is active |
| 2 | Architecture baseline | Decision log started, extension-first direction confirmed, trust boundaries drafted, repo-local workspace ratified | No unresolved disagreement on the core product shape |
| 3 | Connect contract v0 | `Aethelred Connect` provider contract drafted, request lifecycle documented, discovery approach defined | Client and Connect leads agree on the adapter surface |
| 4 | Trust kernel boundary | Signer boundary defined, no-key-leak rules written, storage strategy options narrowed | Security signs off on the core boundary direction |
| 5 | Domain model foundation | Account, subject, workspace, role, policy, and approval entities drafted | Product and platform share one domain vocabulary |
| 6 | Extension shell vertical slice | Local extension shell boots, mock request path works, approval surface is clickable | Demo proves app-to-wallet request flow |
| 7 | EVM integration path | First EVM-style target selected, connection path mapped, provider conformance checklist created | One live integration path is executable in principle |
| 8 | Compatibility test harness | Wallet integration test suite skeleton exists, connect and sign scenarios defined, regression cases listed | Compatibility can now be measured instead of guessed |
| 9 | Audit and session model | Session grant schema, activity log schema, audit event schema, and review trace model drafted | Every request can be mapped to a future audit record |
| 10 | Secure storage prototype | Extension storage prototype built, key slot model refined, account registry behavior defined | Trust kernel can proceed without hand-wavy storage assumptions |
| 11 | Cosmos-style compatibility decision | Shiora-style path analyzed, adapter decision made, prototype criteria and risks documented | Team commits to one Cosmos compatibility direction |
| 12 | Multi-app compatibility pass | Cruzible, ZeroID, TerraQura, and Shiora integration matrix finalized, incumbent wallet support gaps measured | First-party compatibility status is visible and prioritized |
| 13 | Phase 0 hardening and exit | Phase review completed, trust kernel skeleton accepted, compatibility metrics baselined, next-phase backlog confirmed | Phase 0 exits only if compatibility and kernel foundations are testable |

## 5. Phase 1: Aethelred Wallet Personal / Pro

Date range:

- `Week 14` to `Week 39`
- `July 13, 2026` to `January 10, 2027`

| Week | Focus | Planned outputs | Review gate |
| --- | --- | --- | --- |
| 14 | Personal / Pro product cut | Personal and Pro scope split clearly defined, alpha user journeys locked | No confusion about what belongs in alpha |
| 15 | Extension UX foundation | Popup IA, navigation model, settings shell, and approval UX direction finalized | Design and engineering are building the same product |
| 16 | Onboarding architecture | Account creation, import, and first-connect flows specified | Onboarding path is coherent before polish begins |
| 17 | Passkey strategy | Passkey onboarding design and technical approach locked for extension and later mobile | Identity onboarding approach is not drifting |
| 18 | Connect flow implementation | Extension connect UX, account selection, and session creation implemented | One first-party app can connect cleanly |
| 19 | Message signing UX | Human-readable message signing path implemented with audit visibility | Signing no longer looks like raw wallet plumbing |
| 20 | Transaction approval UX | Approval modal shows app, impact, trust level, and policy context | The product begins to feel differentiated |
| 21 | Simulation v0 | Basic simulation and risk summary pipeline added for supported transaction classes | Approvals now include consequence visibility |
| 22 | Session controls v0 | App session permissions, trust states, and revoke flow added | Session model is usable, not theoretical |
| 23 | Account management v0 | Account list, labeling, switching, and import flow implemented | Multi-account behavior is stable in the shell |
| 24 | Activity and notification model | Activity feed, event view, and notification taxonomy designed and started | Users can trace what happened without logs |
| 25 | Governance and staking product slice | Governance and staking IA defined for the wallet experience | The wallet starts to reflect Aethelred-native jobs |
| 26 | Address book and contacts | Contact model, save-and-verify flows, and trusted destination handling added | Safer repeat actions become possible |
| 27 | Recovery design | Recovery requirements, backup model, and failure-handling playbooks finalized | Recovery is explicit before public exposure |
| 28 | Recovery implementation v0 | Recovery flows and secure user guidance started | Recovery moves from concept to product |
| 29 | Hardware wallet strategy | Hardware integration partner choice and UX assumptions locked | Hardware path is realistic, not aspirational |
| 30 | Hardware wallet prototype | First hardware integration prototype built for signing or account import | High-assurance path is now concretely testable |
| 31 | Mobile architecture | Shared contracts, mobile shell direction, and platform split agreed | Mobile can begin without rewriting the core |
| 32 | Mobile shell v0 | Mobile app shell or prototype starts with core connect and approval concepts | Personal / Pro is becoming multi-surface |
| 33 | WalletConnect plan and prototype | WalletConnect strategy finalized and first pairing proof explored | Cross-device path is validated for later launch |
| 34 | App catalog basics | Curated first-party app catalog, app trust states, and catalog metadata defined | The wallet starts behaving like an app hub |
| 35 | Alpha telemetry and supportability | Telemetry, crash surfaces, diagnostics, and support notes added | Internal alpha can be observed and supported |
| 36 | Internal alpha rollout | Internal teams start using extension alpha on controlled first-party flows | Real usage begins before design-partner exposure |
| 37 | Alpha feedback remediation | Top alpha issues fixed, confusing flows simplified, reliability pass executed | Alpha is improving based on evidence, not opinion |
| 38 | Design-partner preparation | Controlled external design-partner program, docs, and onboarding scripts prepared | External use will not be ad hoc |
| 39 | Phase 1 exit review | Personal / Pro review complete, extension quality accepted, mobile direction accepted, design-partner launch approved | Phase 1 exits only if Aethelred Wallet is preferred for first-party use |

## 6. Phase 2: Enterprise Mode

Date range:

- `Week 40` to `Week 65`
- `January 11, 2027` to `July 11, 2027`

| Week | Focus | Planned outputs | Review gate |
| --- | --- | --- | --- |
| 40 | Enterprise scope lock | Enterprise mode success definition, target buyer flows, and control surfaces confirmed | Team knows what enterprise means for v1 |
| 41 | Workspace model implementation | Workspaces, team membership, and role assignment start in code | Enterprise mode has a real operating unit |
| 42 | Vault and sub-account model | Vault abstractions, account grouping, and treasury views defined | Shared operations can be modeled safely |
| 43 | Approval workflow engine v1 | Approval request creation, reviewer routing, and queue states implemented | Sensitive actions can now pause for governance |
| 44 | Policy engine v1 | Core policy outcomes, bundles, and evaluation hooks implemented | Allow, warn, approval, and deny are operational |
| 45 | Spend controls and allowlists | Limits, trusted counterparties, and policy templates added | Treasury use cases become manageable |
| 46 | Enterprise UX shell | Workspace switcher, queue views, reviewer experiences, and admin surfaces designed and started | Enterprise is visible in product form |
| 47 | Audit pipeline persistence | Audit events persist reliably, evidence lineage is preserved, export requirements refined | Approval and audit data stop being ephemeral |
| 48 | Evidence export v1 | Export package structure, review format, and traceability views implemented | Compliance conversations can be grounded in product output |
| 49 | Delegated authority | Role delegation, separation of duties, and revocation flows implemented | Enterprise operations no longer assume one superuser |
| 50 | Policy authoring UX v0 | Admin-facing policy authoring and publishing concepts reach working form | Policy is manageable by humans, not just engineers |
| 51 | Private app catalog v0 | Enterprise app catalog rules, workspace-level permissions, and distribution boundaries defined | App-of-apps concept becomes enterprise-usable |
| 52 | Design partner 1 onboarding | First enterprise design partner environment prepared and enabled | External enterprise validation begins |
| 53 | Design partner 1 remediation | Friction points, approval issues, and audit gaps from partner 1 fixed | Enterprise fit improves from real operations |
| 54 | Dual control and committee approvals | Quorum routing, escalation rules, and committee review support added | High-trust enterprise approvals are credible |
| 55 | Compliance review surfaces | Evidence, queue review, policy status, and control visibility improved for compliance users | Enterprise buyers can understand the product in their language |
| 56 | Admin console v1 | Workspace admin, role management, policy control, and catalog admin reach coherent beta form | Control plane begins to exist as a product |
| 57 | Enterprise mobile and alerting priorities | Mobile review requirements and operational alerting strategy defined | Enterprise mode supports real operators, not desktop-only demos |
| 58 | Design partner 2 onboarding | Second enterprise design partner enabled on a distinct workflow | Fit is tested across more than one environment |
| 59 | Operational resilience pass | Queue recovery, degraded behavior, reconnect, and error handling improved | Enterprise mode can survive normal failures |
| 60 | Reporting and analytics | Treasury activity, policy coverage, and approval analytics added | Enterprise value can be measured operationally |
| 61 | Institutional custody integration path | Custody backend integration strategy, HSM or MPC boundaries, and partner hooks refined | Enterprise roadmap is credible beyond local custody |
| 62 | Security review for enterprise beta | Threat model updated, approval abuse cases retested, admin risks reviewed | Enterprise beta does not proceed on blind spots |
| 63 | Enterprise pilot rehearsal | Internal end-to-end rehearsal for partner workflows, exports, and approval chains completed | Team can operate the product under pressure |
| 64 | Enterprise beta freeze | Beta candidate stabilized, critical defects burned down, partner docs finalized | Program stops churn before broadening exposure |
| 65 | Phase 2 exit review | Two design partners validated, approval and audit value demonstrated, enterprise controls accepted | Phase 2 exits only if meaningful partner activity exists |

## 7. Phase 3: Sovereign Mode and App Platform

Date range:

- `Week 66` to `Week 78`
- `July 12, 2027` to `October 10, 2027`

| Week | Focus | Planned outputs | Review gate |
| --- | --- | --- | --- |
| 66 | Sovereign requirement lock | Sovereign deployment assumptions, pilot constraints, and control boundaries confirmed | Team knows which sovereign demands are in scope now |
| 67 | Dedicated deployment profile | Dedicated tenant, isolated control plane, and environment-aware configuration profiles defined | Sovereign mode is anchored in real deployment shapes |
| 68 | Catalog and tenant isolation | Restricted catalog model, tenant separation, and deployment-scoped app visibility implemented | App platform can be isolated by environment |
| 69 | Key residency and custody abstraction | Residency model, custody backend selection hooks, and deployment-aware signer paths refined | Sovereign discussions can reference concrete architecture |
| 70 | High-assurance approval modes | Offline review, stepped approvals, and stricter session rules added where required | Sovereign mode meaningfully increases assurance |
| 71 | Service and agent identity v1 | Service identities, scoped automation permissions, and audit visibility for non-human actors implemented | Wallet becomes usable for controlled agents and services |
| 72 | Sovereign policy controls | Jurisdictional rules, restricted destinations, network policy hooks, and mission-profile controls added | Policy engine can express sovereign constraints |
| 73 | Restricted deployment operations | Network restrictions, environment isolation, and control-plane hardening pass completed | Deployment model is not just branding on enterprise mode |
| 74 | Evidence-grade operational views | Stronger audit views, evidence packages, and control reports prepared for regulated review | Sovereign pilot artifacts become reviewable |
| 75 | Private sovereign app catalog pilot | Sovereign-only app distribution and permission model tested with controlled apps | App-of-apps strategy reaches high-assurance form |
| 76 | Pilot deployment rehearsal | Dry run for sovereign or equivalent high-assurance pilot completed end to end | Team proves it can deploy and operate the model |
| 77 | Sovereign pilot launch window | First sovereign or equivalent high-assurance pilot begins in controlled form | Real-world validation starts at the highest assurance tier |
| 78 | Phase 3 exit and next-horizon planning | Pilot review, roadmap extension, v2 priorities, and capability gaps documented | Program closes with evidence, not aspiration |

## 8. Decision Gates by Month

These are the decisions that should not drift quietly:

- End of Month 1: first integration target and signer boundary are final
- End of Month 2: domain model and extension shell are accepted
- End of Month 3: compatibility suite and trust kernel skeleton are accepted
- End of Month 6: Personal / Pro alpha scope is frozen
- End of Month 9: Aethelred Wallet is preferred internally for first-party use
- End of Month 12: enterprise beta is operating with design partners
- End of Month 15: enterprise mode is credible for meaningful treasury activity
- End of Month 18: sovereign or equivalent high-assurance pilot is running

## 9. What This Plan Optimizes For

- one coherent wallet core
- early compatibility without losing the long-term moat
- enterprise and sovereign depth built into the architecture
- a visible path from wallet to trust platform
- real pilots instead of endless internal design

## 10. What This Plan Explicitly Avoids

- launching as a retail-only wallet
- building separate products for personal and enterprise
- delaying policy and audit until after UI polish
- trying to build every custody rail internally before validating the core
- attempting a big-bang sovereign launch with no lower-risk hardening path
