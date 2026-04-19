# Aethelred Wallet Decision Memo

Date: 2026-04-10
Owner: Ramesh Tamilselvan
Status: Recommended working position for product, engineering, and leadership review

## Inputs Reviewed

1. `wallet/aethelred_wallet_market_analysis.xlsx`
2. `wallet/Aethelred_wallet_market_analysis_2026-04-10.xlsx`

## Executive Decision

Use `Aethelred_wallet_market_analysis_2026-04-10.xlsx` as the stronger base document.

Do not adopt either workbook as-is.

The older workbook is a helpful first-pass market scan, but it is too shallow and too retail-weighted for a sovereign- and institution-focused wallet strategy.

The newer workbook is materially better and much closer to a usable decision framework. It correctly argues for a staged platform approach, recognizes the importance of enterprise policy patterns, and separates consumer UX, security, connectivity, and organizational control more clearly. However, it still underweights Aethelred's actual ambition: a world-class wallet platform for sovereigns, institutions, regulated enterprises, agents, and consumers.

The recommended path is:

- Keep the newer workbook as the base.
- Reject the implied consumer-first end state.
- Upgrade the strategy so the architecture is enterprise-first and sovereign-capable from day one, even if the first visible product surface is smaller.

## Bottom Line

Aethelred should not build "another wallet."

Aethelred should build a trust platform with wallet interfaces:

- consumer-grade on the surface
- enterprise-grade in controls
- sovereign-grade in deployment, assurance, and policy

The wallet should become the secure operating layer for assets, identity, policy, approvals, applications, and regulated workflows.

## Assessment of Workbook 1

File: `wallet/aethelred_wallet_market_analysis.xlsx`

### What It Gets Right

- Reaches a sensible high-level conclusion that a hybrid path is better than either a white-label-only approach or a full scratch build from day one.
- Correctly identifies useful public benchmarks:
  - MetaMask and Rabby for extension and dApp flows
  - Phantom for consumer polish
  - Trust Wallet for chain breadth
  - hardware wallet pairing for high-value users
- Recognizes that regulated-market fit matters, not just generic retail adoption.

### What Is Weak

- The benchmark is too compressed for strategic capital allocation.
- It leans on weaker external ranking-style sources and broad wallet narratives rather than a rigorous category-by-category comparison.
- It does not deeply model:
  - enterprise policy
  - sovereign deployment
  - auditability
  - organizational roles
  - app platform architecture
  - agent or service identities
- Its "fork + custom modules" recommendation is useful as an execution instinct, but too simplistic as the core strategy for Aethelred.

### Verdict

Useful as a starter scan.

Not strong enough to guide a board-level product decision.

## Assessment of Workbook 2

File: `wallet/Aethelred_wallet_market_analysis_2026-04-10.xlsx`

### What It Gets Right

- Correctly critiques the consultant's earlier vision as directionally strong but not launch-ready.
- Introduces a much better structure:
  - executive summary
  - critique
  - methodology
  - security and custody
  - UX and recovery
  - connectivity and developer ecosystem
  - enterprise and policy
  - scoring
  - recommendation
- Properly identifies the most useful benchmark set for Aethelred:
  - MetaMask for compatibility and reach
  - Rabby for safety UX
  - Coinbase/Base for passkeys, embedded onboarding, and smart-wallet direction
  - Keplr for Cosmos-style interoperability
  - Ledger for high-assurance custody
  - Safe for enterprise policy and shared custody
- Its staged recommendation is much more realistic than a big-bang "trust operating system" launch.

### What Is Still Missing

- The scoring model still overweights distribution and consumer/developer momentum relative to sovereign and enterprise priorities.
- The proposed sequencing can be misread as:
  - consumer and compatibility first
  - enterprise policy later
  which is dangerous if the core architecture is not designed for policy and audit from the start.
- It does not yet define the decisive product wedge for Aethelred.
- It does not make the following first-class architectural decisions:
  - organization model
  - policy engine
  - custody abstraction
  - deployment topology
  - app runtime and permission model
  - audit and evidence model
  - service and agent identity model

### Verdict

This is the stronger workbook and should be treated as the base reference.

But it should be upgraded from a "wallet market analysis" into an "Aethelred trust platform strategy."

## Where the Current Scoring Misaligns with Aethelred

Workbook 2 currently ranks:

1. Coinbase Wallet / Base App
2. Safe
3. MetaMask

That ranking is understandable under its current weights because it rewards:

- distribution
- onboarding quality
- developer platform strength
- smart-account momentum

Those are important, but they are not the full story for Aethelred.

When the same scoring inputs are reweighted for enterprise-first and sovereign-first priorities, the ranking changes:

### Enterprise-First Reweight

1. Safe - 88
2. Coinbase Wallet / Base App - 85
3. MetaMask - 78
4. Ledger Wallet - 63
5. OKX Wallet - 62

### Sovereign-First Reweight

1. Safe - 92
2. Coinbase Wallet / Base App - 83
3. MetaMask - 75
4. Ledger Wallet - 61
5. OKX Wallet - 59

### Interpretation

- `Safe` is the clearest benchmark for enterprise policy and organizational control.
- `Coinbase/Base` is still highly important because it leads on passkeys, embedded onboarding, and smart-wallet experience.
- `MetaMask` remains critical as a compatibility target, not as the target end-state product.
- `Ledger` matters more when assurance and institutional trust are weighted correctly.
- `Keplr` should remain strategically important where Cosmos-style signing or validator workflows matter, even if it does not rank highest in a broad market model.

## Strategic Conclusion

The correct Aethelred strategy is not:

- "copy MetaMask"
- "copy Keplr"
- "copy Safe"
- "ship a consumer wallet and add institutions later"

The correct strategy is:

- build one Aethelred core
- expose multiple wallet interfaces
- deliver multiple assurance modes
- make enterprise, sovereign, and regulated controls foundational
- make the visible launch experience simple enough for retail and partner adoption

## The Product Aethelred Should Build

### Product Thesis

Aethelred Wallet should be the trust operating system for regulated digital value.

It should unify:

- identity
- custody
- policy
- approvals
- application access
- auditability
- connectivity

### Product Modes

The same core should power three modes:

1. Personal
2. Enterprise
3. Sovereign

These should not be separate products with separate codebases. They should be assurance and control layers on one platform.

### What "App of Apps" Means for Aethelred

The wallet should contain a curated application runtime, not just a token portfolio view.

Priority app domains:

- treasury and payments
- validator and staking operations
- governance and delegation
- compliance and approvals
- identity and credentials
- enterprise workflow apps
- sovereign administration apps
- ecosystem partner apps

Mini-apps should request intents, not direct key access.

The wallet must mediate each intent through:

- identity
- policy
- simulation
- approval routing
- signing
- logging

That is what makes it an operating layer instead of a simple signer.

## Architecture Principles

### 1. Enterprise-First Core

Even if the first launch is lighter, the architecture must support from day one:

- organizations
- roles
- delegated authority
- spend limits
- approval policies
- session controls
- audit trails
- deployment separation

### 2. Multi-Interface Compatibility

The wallet must speak the interfaces the market already uses.

Required compatibility targets:

- EIP-1193
- EIP-6963
- WalletConnect
- Cosmos-style signing compatibility where Aethelred apps require it
- hardware wallet integration

Compatibility is not the product. It is the adoption bridge.

### 3. One Identity, Many Execution Environments

Users should experience one Aethelred identity and one Aethelred wallet, even if the system internally handles:

- EVM-style accounts
- Aethelred-native accounts
- Cosmos-style signatures
- smart-account sessions
- institutional or policy-controlled accounts

### 4. Policy as a First-Class Primitive

Policy is the moat.

The wallet should eventually support:

- counterparty allowlists
- contract and app trust policies
- transaction class restrictions
- jurisdiction and business-rule constraints
- approval thresholds
- velocity and spend controls
- credential-gated actions
- agent permissions
- device and session trust

### 5. Auditability as a Default

Every material action should be reconstructable.

Audit requirements should cover:

- who initiated
- who approved
- which policy was applied
- which credentials were presented
- which device/session was used
- which app requested the action
- what was signed
- what evidence was exported

### 6. Sovereign Deployment Readiness

The platform should be designed so it can later support:

- dedicated tenant deployments
- sovereign cloud deployments
- self-hosted control planes
- regional key residency
- HSM and MPC integrations
- offline or air-gapped approval modes

## Benchmark Model for Aethelred

Use each market leader for a specific lesson rather than treating one wallet as the full model.

### Safe

Use as the primary benchmark for:

- shared custody
- policy modules
- organizational workflows
- approvals
- treasury controls

### Coinbase Wallet / Base App

Use as the primary benchmark for:

- passkey-first onboarding
- smart-wallet flows
- embedded wallet and developer growth
- reduced consumer friction

### MetaMask

Use as the primary benchmark for:

- provider compatibility
- extension-to-dApp norms
- ecosystem expectations
- delegated permissions and extensibility direction

### Keplr

Use as the primary benchmark for:

- Cosmos-style signing and chain-adapter patterns
- staking/governance operator experience
- cross-chain interoperability patterns in non-EVM contexts

### Ledger

Use as the primary benchmark for:

- high-assurance custody
- hardware trust story
- premium security tiers
- institutional credibility

### Rabby

Use as the primary benchmark for:

- transaction simulation
- approval safety
- power-user clarity
- pre-sign risk surfacing

### Phantom and Exodus

Use as the primary benchmarks for:

- polish
- mainstream clarity
- mobile and desktop usability
- discovery and portfolio presentation

## Recommended Strategic Path

### Phase 0: Compatibility and Trust Kernel

Timing: 0-3 months

Build:

- Aethelred Connect layer
- standards-compatible provider interfaces
- wallet compatibility test suite
- signing kernel abstraction
- account abstraction layer for multi-interface support
- initial device, session, and approval logging

Support:

- MetaMask
- WalletConnect
- Ledger
- Keplr where required

Goal:

First-party Aethelred apps work reliably from incumbent wallets while the first-party wallet foundation is being built.

### Phase 1: Aethelred Wallet Personal and Pro

Timing: 3-9 months

Build:

- browser extension
- mobile app
- passkeys
- clean approvals
- simulation and warnings
- hardware wallet support
- session permissions
- recovery
- polished portfolio, staking, governance, and app access

Architectural requirement:

The product surface may feel consumer-friendly, but the underlying model must already support organizations, policies, and audit.

### Phase 2: Enterprise Mode

Timing: 9-15 months

Build:

- spaces and teams
- roles and delegated authority
- approval queues
- spend limits
- vaults
- transaction policy engine
- admin console
- audit export and evidence views
- secure app catalog

This is where Aethelred begins to differentiate materially from mainstream wallets.

### Phase 3: Sovereign Mode and App Platform

Timing: 15-24 months

Build:

- sovereign deployment options
- jurisdictional controls
- advanced custody integrations
- offline approvals
- service and agent wallets
- private app catalogs
- regulated workflow apps
- compliance and credential presentation flows

This is where the wallet becomes the operating system for trust, not just a wallet with more settings.

## Build / Partner / Support Decisions

### Aethelred Must Own

- identity model
- policy engine
- approval model
- app runtime and permission model
- audit and evidence architecture
- admin console
- Aethelred-native user experience
- product strategy and roadmap

### Aethelred Should Support, Not Reinvent

- WalletConnect connectivity
- incumbent wallet compatibility
- hardware wallet integrations
- some swap and on-ramp rails
- selected custody and HSM vendor integrations

### Aethelred Should Evaluate Partnership Carefully

- embedded wallet infrastructure
- MPC vendors
- fiat rails
- transaction relay infrastructure
- selected treasury or policy modules where buying time-to-market is worth it

## What to Keep, Reject, and Upgrade

### Keep

- The newer workbook's staged launch logic
- The importance of compatibility-first adoption
- The benchmark roles for MetaMask, Coinbase/Base, Keplr, Ledger, Rabby, and Safe
- The critique that a big-bang trust operating system is too risky as a launch strategy

### Reject

- Any reading that enterprise and sovereign concerns can be bolted on later
- Any scoring model that treats sovereign and organizational controls as marginal dimensions
- Any strategy that reduces Aethelred to a forked retail wallet with branding

### Upgrade

- Reframe the product from "wallet" to "trust platform with wallet interfaces"
- Make policy, organizations, audit, and deployment part of the foundation
- Define a precise institutional and sovereign wedge for launch planning
- Add a proper build/partner/support map by subsystem

## Immediate Next Deliverables

Leadership should demand four follow-on artifacts:

1. A product requirements document for Aethelred Wallet Personal, Enterprise, and Sovereign modes.
2. A technical architecture RFC covering identity, custody, policy, app runtime, audit, and compatibility layers.
3. A build-versus-partner matrix by subsystem.
4. A first-year roadmap with staffing, security review gates, and adoption milestones.

## Final Recommendation

Do not throw away the consultant work.

Use workbook 2 as the base and workbook 1 only as supporting context.

Then upgrade the strategy to this principle:

Aethelred Wallet should launch in stages, but it must be architected from day one as a sovereign- and enterprise-grade trust platform that also delivers world-class consumer UX.
