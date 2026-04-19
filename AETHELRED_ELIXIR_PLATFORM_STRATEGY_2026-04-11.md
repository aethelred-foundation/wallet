# Aethelred Elixir Platform Strategy

Date: 2026-04-11
Status: Local strategy draft
Purpose: Define whether, where, and how Elixir should be introduced across Aethelred Wallet and selected dApps

## 1. Executive Summary

Elixir should be introduced at Aethelred as a shared platform capability for workflow-heavy and operations-heavy systems.

It should not become the default language for all products.

Recommended decision:

- adopt Elixir as a shared platform for workflow orchestration, notifications, approvals, event ingestion, and operator-facing real-time systems
- do not use Elixir for wallet UI, dApp frontend delivery, trust-kernel code, signing boundaries, chain-specific low-level services, or cryptographic execution
- roll it out first where workflow and operational complexity are highest

This means Aethelred should build one bounded Elixir platform layer and let selected products consume it through APIs, queues, and events.

It does not mean every product should be rewritten into Elixir.

## 2. Why This Decision Exists

The current Aethelred estate is already multi-runtime:

- `Cruzible` uses Next.js and a TypeScript API gateway, with Rust components in adjacent backend areas
- `Shiora` is primarily a Next.js and TypeScript web application
- `NoblePay` already spans Next.js, TypeScript backend, Go gateway, Rust compliance, and Python tooling
- `TerraQura` already spans TypeScript, Go, Rust, and Python
- `ZeroID` already spans Next.js, TypeScript backend, and Rust for TEE-related work

Therefore the strategic question is not whether Aethelred should stay single-stack.

That ship has already sailed.

The actual question is whether Elixir creates enough leverage in the right places to justify becoming another supported runtime.

## 3. Core Decision

### 3.1 What Elixir Should Own

Elixir is a good fit for:

- approval workflow orchestration
- queueing, escalation, and notification routing
- durable job execution
- real-time operator consoles
- audit and evidence event ingestion
- cross-product workflow state machines
- review queues and case management
- admin and control-plane APIs

### 3.2 What Elixir Should Not Own

Elixir should not be the default choice for:

- wallet extension code
- mobile wallet code
- `Aethelred Connect`
- dApp frontend code
- signing boundaries
- key custody core
- HSM integration core
- TEE and verifier logic
- low-level chain execution clients
- product-specific domain logic that changes rapidly with one team

### 3.3 Strategic Position

Elixir should be treated as:

- a shared platform runtime
- a control-plane and workflow runtime
- an event and notification runtime

Elixir should not be treated as:

- the universal backend for all Aethelred systems
- a reason to rewrite stable TypeScript, Go, or Rust services
- a replacement for product-owned service boundaries

## 4. Shared Platform Boundary

### 4.1 What Can Be Shared Safely

The shared Elixir platform may own cross-cutting capabilities such as:

- workflow orchestration engine
- notification and escalation engine
- approval and reviewer queue infrastructure
- event ingestion and fan-out
- audit event normalization
- policy-trigger execution hooks
- operational alerting
- admin and operator real-time channels

### 4.2 What Must Stay Product-Owned

Each product should keep ownership of:

- product-specific business rules
- product-specific data models
- product-specific transaction semantics
- product-specific regulatory logic
- product-specific user experience decisions
- product-specific service-level priorities

### 4.3 Anti-Pattern To Avoid

The shared Elixir platform must not become:

- the default place to put all backend work
- a dumping ground for urgent product-specific exceptions
- the owner of every queue in the company
- a hidden coupling layer across unrelated products

If that happens, the platform becomes a future bottleneck.

## 5. Product-By-Product Recommendation

### 5.1 Adoption Order

Recommended adoption order:

1. `NoblePay`
2. `TerraQura`
3. `Aethelred Wallet Control Plane`
4. `ZeroID`
5. `Cruzible`
6. `Shiora`

### 5.2 NoblePay

Recommendation:
`Adopt early`

Rationale:

- NoblePay is already enterprise-heavy and operations-heavy
- it has workflow, compliance, settlement, review, and notification characteristics
- it already tolerates multi-runtime architecture

Best Elixir roles:

- payment workflow orchestration
- compliance review queues
- settlement state machine coordination
- case management and escalations
- treasury and operator notifications
- real-time operations console

Do not move into Elixir:

- frontend
- product-specific compliance engine logic that is already embedded elsewhere
- core gateway behavior that is better left with the existing Go or TypeScript owners

### 5.3 TerraQura

Recommendation:
`Adopt early`

Rationale:

- TerraQura is institutional and process-heavy
- it already has worker, analytics, verifier, and indexer-style decomposition
- review, verification, and event pipeline concerns are a natural fit

Best Elixir roles:

- verification workflow orchestration
- asset review queues
- operator alerts
- event ingestion and process tracking
- audit-friendly evidence lifecycle
- real-time program dashboards

Do not move into Elixir:

- indexer core
- verifier core
- product-specific carbon and asset semantics

### 5.4 Aethelred Wallet Control Plane

Recommendation:
`Adopt early, but only for the control plane`

Rationale:

- the wallet architecture already separates trust kernel from control plane
- Phase 2 and Phase 3 introduce approvals, policy routing, audit persistence, evidence exports, and real-time admin surfaces
- these are good candidates for Elixir-backed orchestration and operations

Best Elixir roles:

- approval workflow service
- notification and escalation service
- audit-event ingestion
- admin control-plane APIs
- reviewer queues
- operational alerts and live control views

Do not move into Elixir:

- wallet extension
- mobile wallet
- trust kernel
- signer boundary
- cryptographic key operations

### 5.5 ZeroID

Recommendation:
`Adopt selectively after the first three`

Rationale:

- ZeroID has real workflow potential around credentials, verification, review, and lifecycle operations
- however, its trust-sensitive and cryptographic pieces already lean toward other runtimes

Best Elixir roles:

- credential issuance orchestration
- revocation and policy-trigger workflows
- operator verification queues
- evidence and audit fan-out
- real-time admin views for credential operations

Do not move into Elixir:

- ZK circuits
- verifier logic
- TEE logic
- key and credential trust boundary code

### 5.6 Cruzible

Recommendation:
`Adopt only if operations become meaningfully workflow-heavy`

Rationale:

- Cruzible is currently more of a dashboard and explorer product than a workflow platform
- its current TypeScript and web stack is coherent enough without another runtime

Best Elixir roles if adopted later:

- governance workflow queues
- large-scale alerting
- institutional reviewer tooling
- real-time monitoring and incident operations

Do not move into Elixir:

- main app backend just for the sake of standardization
- current web delivery path

### 5.7 Shiora

Recommendation:
`Do not adopt in the near term`

Rationale:

- Shiora is currently a relatively straightforward product shell
- introducing Elixir here now would add stack complexity without enough leverage

Possible future fit:

- care coordination queues
- escalation and operational notifications
- regulated review workflows

Current decision:

- keep Shiora on its existing path unless its product model evolves into an operations-heavy system

## 6. Platform Architecture Boundary

### 6.1 Shared Elixir Platform Modules

Recommended shared modules:

- `workflow-orchestrator`
- `approval-router`
- `notification-hub`
- `event-ingestion`
- `audit-fanout`
- `ops-realtime`

### 6.2 Integration Style

Products should integrate through:

- versioned HTTP or gRPC APIs
- event streams
- queue interfaces
- signed callbacks where required

Products should not integrate through:

- direct database coupling
- shared private schema access
- product-specific branching inside the core platform

### 6.3 Deployment Principle

The Elixir platform should support:

- shared managed deployment for internal and early partner use
- tenant-aware configuration
- product-level isolation controls
- future dedicated deployments for regulated and sovereign environments

## 7. Staffing Implications

### 7.1 Minimum Team To Justify Elixir

Do not add Elixir unless Aethelred has at least:

- 1 strong Elixir or Phoenix lead
- 1 backend engineer able to grow into Elixir ownership
- 1 platform-minded product or program owner who will protect scope boundaries
- 1 DevOps or infrastructure owner able to support production operations

### 7.2 Stronger Team Shape

Preferred team shape:

- 1 Staff or Principal Elixir platform lead
- 2 Elixir backend engineers
- 1 platform SRE or DevOps engineer
- 1 product manager for workflow and control-plane use cases
- embedded domain engineers from NoblePay, TerraQura, Wallet, and ZeroID as needed

### 7.3 Organizational Risk

Risks if Elixir is adopted without enough ownership:

- a platform nobody fully owns
- slower delivery caused by hiring and onboarding lag
- accidental duplication between product backends and platform workflows
- weak operational maturity in production
- pressure to push unrelated work into Elixir to justify the decision

## 8. Rollout Plan

### Wave 1

Start with:

- `NoblePay`
- `TerraQura`
- wallet control-plane prototypes

Goal:

- prove that Elixir creates real leverage in workflows, notifications, and operations

### Wave 2

Expand to:

- wallet control plane in production form
- `ZeroID` workflow-heavy surfaces

Goal:

- confirm reuse of the shared platform model across at least three serious products

### Wave 3

Evaluate:

- `Cruzible`
- `Shiora`

Goal:

- adopt only if real workflow and real-time operational needs justify it

## 9. Decision Gates

Elixir adoption should continue only if the following become true:

1. Wave 1 reduces workflow and operations complexity meaningfully
2. at least two product teams reuse the shared modules without heavy platform branching
3. production reliability improves rather than declines
4. platform scope remains bounded and product teams do not lose local ownership
5. the team can hire and retain Elixir ownership credibly

If these do not become true, Elixir should remain a bounded platform experiment instead of becoming an expanding company-wide standard.

## 10. Final Recommendation

Adopt Elixir at Aethelred as a bounded shared platform for workflow-heavy and operations-heavy systems.

Do not adopt Elixir as a universal backend policy.

The right mental model is:

- one shared Elixir platform
- multiple product-owned services
- strict boundaries
- early proof in `NoblePay`, `TerraQura`, and wallet control-plane work
- later expansion only if the leverage is clearly real

## 11. Team Execution Packs

Use these team-specific documents for immediate parallel execution:

- `wallet/AETHELRED_ELIXIR_NOBLEPAY_TEAM_PLAN_2026-04-11.md`
- `wallet/AETHELRED_ELIXIR_TERRAQURA_TEAM_PLAN_2026-04-11.md`
- `wallet/AETHELRED_ELIXIR_ZEROID_TEAM_PLAN_2026-04-11.md`
- `wallet/AETHELRED_ELIXIR_CRUZIBLE_TEAM_PLAN_2026-04-11.md`
- `wallet/AETHELRED_ELIXIR_SHIORA_TEAM_PLAN_2026-04-11.md`
