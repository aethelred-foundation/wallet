# Changelog

All notable changes to `@aethelred/wallet-compliance` will be documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Pre-1.0 policy: breaking changes MAY land on any minor release (0.1.x →
> 0.2.x). Once we cut 1.0.0, breaking changes will be confined to major
> version bumps with deprecation windows of at least one minor version.

## [Unreleased]

### Added

- Initial SDK README covering the 14 primitives, architecture diagram, and
  quick-start examples for KYC, transaction screening, and alert escalation.
- Subpath exports in `package.json` so consumers can import individual
  primitives (for example `@aethelred/wallet-compliance/screening`).
- Runnable examples under `examples/` for KYC, transaction screening, and
  alert escalation.
- JSDoc `@packageDocumentation` header and per-export JSDoc on the barrel.

### Changed

- `package.json` metadata expanded: `description`, `keywords`, `author`,
  `repository`, `homepage`, `bugs`, `license` set to `UNLICENSED` with an
  explicit TODO comment noting that the public-license decision (target
  MIT or Apache-2.0) is pending.

## [0.1.0] - 2026-04-19

Initial SDK scaffolding. Not yet semver-stable. The `0.1.x` series is
expected to see breaking changes as the public surface is finalized in
collaboration with design-partner VASPs and fintechs.

### Added

- `KycManager` — multi-level KYC, document management, risk scoring.
- `TransactionScreeningEngine` — OFAC, mixer, and FATF high-risk
  jurisdiction screening with `approve | review | escalate | block`
  decisions.
- `TravelRuleEngine` — FATF Travel Rule obligation engine for
  originator / beneficiary PII and VASP coordination.
- `ReportGenerator` — KYC, transaction, Travel Rule, audit-trail, and
  SOC 2 evidence report generation with SHA-256 integrity hashes.
- `DataClassificationEngine` — HIPAA / GDPR / defense classification
  with enforced handling instructions and consent lifecycle.
- `MachineIdentityManager` — AI / IoT / oracle / validator identity with
  rate limits, value caps, human-approval thresholds, and anomaly-based
  auto-suspension.
- `ProvenanceTracker` — chain-of-custody and third-party attestation
  records for supply chain, research, and credentials.
- `CaseManager` — investigation case lifecycle with hashed evidence
  chains, officer workload, escalation, and law-enforcement referral.
- `AlertSystem` — deduplicated alert routing with suppression rules,
  escalation ladder, and append-only audit history.
- `JurisdictionEngine` — ISO-3166 keyed AML thresholds, sanctions lists,
  KYC requirements, and data residency rules; seed configs for AE, US,
  GB, SG, EU, plus prohibited KP and IR.
- `VelocityMonitor` — count / volume / counterparty velocity tracking
  with default rules for daily, weekly, and monthly caps.
- `FilingTracker` — SAR / CTR / STR / MiCA / ADGM-DLT filing lifecycle
  with append-only `filingHistory`.
