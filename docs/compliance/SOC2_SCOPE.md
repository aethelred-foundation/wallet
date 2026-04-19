# Aethelred Wallet — SOC-2 Scope Document

> **Classification:** Internal / Auditor-shared
> **Owner:** Ramesh Tamilselvan (<rameshtamilselvan@gmail.com>)
> **Status:** Draft — intended as the basis for Type 1 engagement scoping
> **Target report:** SOC-2 Type 1 (point-in-time), then Type 2 (observation period)

## 1. Executive summary

Aethelred Wallet is a compliance-native Web3 wallet built for regulated
enterprise clients (banks, VASPs, fintechs, asset managers) and sovereign
entities. This document scopes the environment, systems, and controls that
will be in the initial SOC-2 Type 1 audit engagement.

The path to certification:

1. **Type 1 (target: Q2 2026, ~3 months engagement)**
   Design-adequacy attestation. Proves the control environment is designed
   correctly as of the audit date. Required deliverable: signed Type 1
   report. Unblocks initial enterprise sales conversations.
2. **Type 2 (target: Q4 2026 / Q1 2027, min 3-month observation period)**
   Operating-effectiveness attestation. Proves controls worked as designed
   over the observation period. Required for most bank/VASP procurement.

## 2. Trust Service Criteria (TSC) in scope

| TSC | In scope | Rationale |
|-----|----------|-----------|
| **Security** (CC) | ✅ Mandatory | Foundational criteria; always required. |
| **Confidentiality** (C) | ✅ Yes | Wallet handles customer key material, transaction data, compliance records. Non-negotiable for this product. |
| **Availability** (A) | ⚠️ Type 2 only | Will be added once we have 90+ days of uptime metrics and an on-call rotation. Excluding from Type 1 keeps that engagement focused. |
| **Processing Integrity** (PI) | ❌ Out of scope (Type 1) | Will assess for Type 2 — covers signing correctness, audit-chain integrity, policy-engine determinism. |
| **Privacy** (P) | ❌ Out of scope | Not pursuing Privacy TSC initially; personal data handling is minimal (no marketing tracking, no third-party analytics). |

## 3. System boundary

### 3.1 In-scope systems

| System | Description | Hosting | Repository |
|--------|-------------|---------|-----------|
| **Chrome extension** | MV3 popup + service worker + content script + inpage provider. User-facing wallet UI. | Client-side (user's browser). Code signed by Google Web Store. | `aethelred-foundation/wallet`, `apps/extension` |
| **Mobile WebView shell** | Expo React Native wrapper that displays the extension popup on mobile for preview. | App Store / Play Store distribution. | `aethelred-foundation/wallet`, `apps/mobile` |
| **Wallet control-plane** | Elixir/Phoenix service that handles approval orchestration, audit log aggregation, push notifications. | Cloud (TBD: AWS eu-west-1 or equivalent). | `aethelred-foundation/wallet`, `elixir/` |
| **Package build pipeline** | GitHub Actions workflow that typechecks, tests, and builds the extension for Chrome Web Store submission. | GitHub-hosted runners. | `.github/workflows/ci.yml` |
| **Source code repository** | Private GitHub repo with branch protection, signed commits, and required CI status checks. | GitHub.com (enterprise plan). | `aethelred-foundation/wallet` |
| **Dependency supply chain** | npm + GitHub Actions dependencies, patched weekly via Dependabot. | GitHub-hosted. | `.github/dependabot.yml` |
| **Secrets management** | (Planned) GCP Secret Manager or AWS Secrets Manager for production RPC keys, signing credentials, alerting webhooks. | Cloud. | Runtime only — no secrets in repo. |
| **Observability** | (Planned) CloudWatch / Datadog for service logs, metrics, error tracking. | Cloud. | Runtime only. |

### 3.2 Explicitly out of scope

- **Aethelred L1 blockchain and its validators.** Separate attestation
  domain; governed by different engineering + compliance process.
- **Third-party dApps** (TerraQura, Cruzible, NoblePay, etc.) integrated
  via the wallet's dApp catalog. Each dApp is responsible for its own
  compliance posture.
- **User devices.** The wallet runs client-side; endpoint security is the
  user's responsibility. We do add controls (clone detection on passkey
  authenticator via WebAuthn §6.1.1, content-script isolation, etc.) but
  the device itself is not in scope.
- **External auditors' infrastructure.** Standard.

## 4. Control map (preliminary)

Mapping Aethelred Wallet's implemented controls to the SOC-2 Trust Services
Common Criteria (CC). Status legend: ✅ implemented, 🟡 partial/in-design,
❌ gap (to be closed before Type 1 audit date).

### CC1 — Control environment

| CC Ref | Control | Implementation | Status |
|--------|---------|----------------|--------|
| CC1.1 | Commitment to integrity and ethical values | Written code of conduct in repo; no AI/co-author attribution policy documented | 🟡 Need formal code of conduct |
| CC1.2 | Board oversight of internal control | Aethelred Foundation governance structure | 🟡 Document board approval process |
| CC1.3 | Management establishes org structure | Eng org chart; role definitions | 🟡 Document formally |
| CC1.4 | Commitment to competence | Role-specific onboarding, training on compliance primitives | ❌ Need training program |
| CC1.5 | Enforces accountability | Signed commits, PR review requirements via branch protection | ✅ Branch protection enforces review |

### CC2 — Communication and information

| CC Ref | Control | Implementation | Status |
|--------|---------|----------------|--------|
| CC2.1 | Objectives communicated | Master index doc, phased delivery plans (PHASE0–3) | ✅ |
| CC2.2 | Internal communication channels | Slack, repo discussions, design docs | 🟡 Document formally |
| CC2.3 | External communication | aethelred.org public site, support channels | 🟡 Document formally |

### CC3 — Risk assessment

| CC Ref | Control | Implementation | Status |
|--------|---------|----------------|--------|
| CC3.1 | Objectives with sufficient clarity | PRD + RFC docs | ✅ |
| CC3.2 | Risk identification and analysis | Threat modeling on wallet architecture (TBD) | ❌ Need formal threat-model doc |
| CC3.3 | Fraud risk | Policy engine + audit chain | ✅ Technical controls in place |
| CC3.4 | Changes in internal control | Branch protection + required status checks | ✅ |

### CC4 — Monitoring activities

| CC Ref | Control | Implementation | Status |
|--------|---------|----------------|--------|
| CC4.1 | Ongoing or separate evaluations | CI runs on every PR; quarterly pen-tests planned | 🟡 CI ✅, pen-tests ❌ |
| CC4.2 | Evaluates and communicates deficiencies | Issue tracker + Dependabot alerts | ✅ Dependabot enabled |

### CC5 — Control activities

| CC Ref | Control | Implementation | Status |
|--------|---------|----------------|--------|
| CC5.1 | Control activities selected | Branch protection + CI gates + audit chain | ✅ |
| CC5.2 | Controls on technology | Typecheck/test/build gated; lockfile sync enforced | ✅ |
| CC5.3 | Deploys controls via policies | Policy engine package (`@aethelred/wallet-policy`) | ✅ |

### CC6 — Logical and physical access

| CC Ref | Control | Implementation | Status |
|--------|---------|----------------|--------|
| CC6.1 | Logical access security | GitHub org access controls; 2FA required | ✅ 2FA enforced org-wide |
| CC6.2 | User registration and authorization | WebAuthn 2FA for wallet unlock | ✅ Passkey 2FA with clone detection |
| CC6.3 | Role-based access | Workspace roles: owner / treasury-admin / compliance-reviewer / operator | ✅ |
| CC6.4 | Physical access | Cloud provider (AWS/GCP) physical controls | ✅ Inherited from cloud vendor |
| CC6.5 | Logical access removed | Workspace member removal flows | 🟡 Document runbook |
| CC6.6 | Encryption of data in transit | TLS 1.3 for all external communication | ✅ |
| CC6.7 | Restricts transmission of sensitive data | Private keys never leave the user's device | ✅ Client-side only |
| CC6.8 | Malicious software | Dependency scanning via Dependabot; secret scanning via GitHub Advanced Security | ✅ Enabled |

### CC7 — System operations

| CC Ref | Control | Implementation | Status |
|--------|---------|----------------|--------|
| CC7.1 | Detection of security events | Audit event capture with SHA-256 hash chain | ✅ |
| CC7.2 | Monitoring of security events | Alert system package (`@aethelred/wallet-compliance`) | ✅ Code in place; on-call ❌ |
| CC7.3 | Response to security incidents | Incident response runbook | ❌ Need runbook |
| CC7.4 | Recovery from security incidents | Wallet recovery phrase + passkey re-enrollment | ✅ Technical, 🟡 UX flow |
| CC7.5 | Security of the system lifecycle | SDLC: design review → code review → CI → release | ✅ Enforced via branch protection |

### CC8 — Change management

| CC Ref | Control | Implementation | Status |
|--------|---------|----------------|--------|
| CC8.1 | Authorizes changes to system | Required PR reviews + signed commits | ✅ Branch protection |
| CC8.2 | Designs changes | RFC process (architecture doc) | ✅ |
| CC8.3 | Tests changes | 112 automated tests + CI gates | ✅ |
| CC8.4 | Deploys changes | Chrome Web Store review + staged rollout | 🟡 Document formally |

### CC9 — Risk mitigation

| CC Ref | Control | Implementation | Status |
|--------|---------|----------------|--------|
| CC9.1 | Business continuity plan | TBD — needs disaster recovery doc | ❌ |
| CC9.2 | Vendor risk management | Vendor list + reviews | ❌ Need formal list |

### C1 — Confidentiality

| Ref | Control | Implementation | Status |
|-----|---------|----------------|--------|
| C1.1 | Identifies confidential information | Data classification module (`@aethelred/wallet-compliance/data-classification`) | ✅ |
| C1.2 | Disposal of confidential information | Secure key deletion via WebCrypto | ✅ |

## 5. Gap remediation plan (pre-Type-1)

Ordered by audit risk and effort. These items must be closed before the
Type 1 attestation date (targeted Q2 2026).

### Critical (blocks Type 1)
1. **Threat model document** — Formal STRIDE analysis of the wallet
   architecture, with identified threats, mitigations, and residual risks.
   Estimated effort: 2-3 weeks.
2. **Incident response runbook** — Who is paged, how severity is triaged,
   communication templates, post-mortem process. Estimated effort: 1 week.
3. **Business continuity plan (BCP)** — Defines recovery time objectives
   (RTO) and recovery point objectives (RPO) for each in-scope system.
   Estimated effort: 1 week.
4. **Vendor list with risk reviews** — Document every third-party
   dependency (Cloudflare, GitHub, AWS/GCP, npm, Sentry, etc.) and
   justify its use. Estimated effort: 1 week.

### Important (Type 1 or immediate post-Type-1)
5. **Formal code of conduct** — Written policy covering ethics, conflict
   of interest, AI-attribution policy (already implemented but
   undocumented). Estimated effort: 2 days.
6. **Training program** — Onboarding content for new hires covering
   compliance primitives, secure-development practices. Estimated effort:
   1 week (reusing existing RFCs as training material).
7. **Formal change-management doc** — Codifies the PR → review → CI → merge
   flow that's already enforced technically. Estimated effort: 2 days.
8. **Offboarding runbook** — Revokes access within 24 hours of role
   change. Estimated effort: 2 days.
9. **Pen-test engagement** — Trail of Bits / Spearbit / Halborn for a
   comprehensive Web3 wallet audit. Estimated effort: 6 weeks + ~$150-300k.
10. **Availability metrics baseline** — 90 days of uptime data for the
    control-plane service (prerequisite for adding Availability to Type 2).

### Nice to have (Type 2)
11. Continuous compliance dashboard (Vanta / Drata / Strike Graph integration)
12. SIEM integration for CC7.2 monitoring
13. Annual pen-test rotation

## 6. Evidence collection

SOC-2 auditors require evidence. Our audit-chain and CI pipeline are
designed to produce it automatically:

| Evidence type | Source | Auditor acceptable? |
|---------------|--------|--------------------|
| Commit history with signed commits | GitHub `aethelred-foundation/wallet` | ✅ Standard |
| PR reviews with approvals | GitHub PR history | ✅ Standard |
| CI status for every commit | GitHub Actions history | ✅ Standard |
| Dependency vulnerability history | Dependabot alerts + closures | ✅ Standard |
| Audit events (per-wallet) | Wallet's own tamper-evident audit chain | ✅ Once notarized to L1 (Moat 1) |
| Access grants/revokes | GitHub audit log + GCP/AWS IAM logs | ✅ Standard |
| Incident post-mortems | (TBD — once runbook lands) | ✅ Standard |
| Training attestations | Docusign or similar | ✅ Standard |

## 7. Auditor shortlist (preliminary)

Qualified for SOC-2 Web3 wallet scope, ranked by familiarity with our
architecture:

1. **Prescient Assurance** — Strong Web3 + fintech practice
2. **Schellman** — Enterprise-grade, handles most Fireblocks-tier clients
3. **A-LIGN** — Mid-market friendly, faster turnaround
4. **Coalfire** — Deep enterprise CC6 + PCI crossover

Engagement letter templates + cost ranges:

- Type 1 engagement: $30-80k (~3 months)
- Type 2 engagement: $60-150k (~6-12 months)
- Remediation consulting (pre-audit readiness): $30-100k

## 8. Timeline

```
Q2 2026  ┌──────────────────────────────┐
         │ Gap remediation              │
         │   - Threat model             │
         │   - IR runbook               │
         │   - BCP                      │
         │   - Vendor list              │
         │   - Code of conduct          │
         │   - Training program         │
         └──────────────────────────────┘
         ┌──────────────────────────────┐
         │ Auditor selection            │
         │ Engagement letter            │
         └──────────────────────────────┘
         ┌──────────────────────────────┐
         │ Pen-test (parallel)          │
         │   - Trail of Bits / Spearbit │
         └──────────────────────────────┘

Q3 2026  ┌──────────────────────────────┐
         │ Type 1 fieldwork             │
         │ Observation period begins    │
         └──────────────────────────────┘

Q4 2026  ┌──────────────────────────────┐
         │ Type 1 report signed          │
         │ Type 2 fieldwork begins       │
         └──────────────────────────────┘

Q1 2027  ┌──────────────────────────────┐
         │ Type 2 report signed          │
         │ Enterprise sales unblocked    │
         └──────────────────────────────┘
```

## 9. Next actions

Immediate (this week):
- [ ] Review this scope doc with legal counsel
- [ ] Request auditor pricing proposals from the shortlist
- [ ] Begin threat-model document
- [ ] Create vendor inventory

Short-term (this month):
- [ ] Select Type 1 auditor + sign engagement letter
- [ ] Close 4 critical gap items
- [ ] Publish incident response runbook to `docs/runbooks/`
- [ ] Schedule pen-test

Medium-term (this quarter):
- [ ] Type 1 fieldwork kickoff
- [ ] Begin Type 2 observation period preparation
- [ ] Implement SIEM + continuous-compliance dashboard

---

*This document is a working draft. Every claim about implementation
status must be verified against the actual codebase and infrastructure
at audit time. Gaps marked `🟡` or `❌` are honest assessments of
where we stand today — auditors prefer repos with honest gap tracking
to repos that claim unearned maturity.*
