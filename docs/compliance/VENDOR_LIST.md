# Third-Party Vendor Register

> **Last updated:** 2026-04-19
> **Owner:** Ramesh Tamilselvan — `security@aethelred.org`
> **Classification:** Internal / Auditor-shared
> **Applies to:** `aethelred-foundation/wallet` vendor relationships.

Closes `docs/compliance/SOC2_SCOPE.md` §5 critical gap #4 (CC9.2).
Enumerates every third-party dependency the wallet relies on, with a
risk review per vendor. Rows marked **TBD** have not yet completed a
formal review — these are gaps the audit-readiness program will close
before SOC-2 Type-1 fieldwork.

## 1. Risk tier definitions

- **High** — Direct path to customer key material, customer PII, or
  production code. Compromise of this vendor materially compromises
  the wallet. Requires SOC-2 (or equivalent) and an executed MSA.
- **Medium** — Holds operational data or influences release integrity,
  but compromise does not directly expose customer funds. Requires
  SOC-2 or documented compensating controls.
- **Low** — Development, read-only, or easily substitutable. Best-effort
  review.

## 2. Vendor register

| Vendor | Service | Data shared | Risk tier | Review date | Their SOC-2 status | Contract status |
|--------|---------|-------------|-----------|-------------|--------------------|-----------------|
| **GitHub** (Microsoft) | Private source repo, Dependabot, GitHub Advanced Security, CodeQL, Secret Scanning, Actions CI | Source code, CI secrets, commit metadata, PR comments | High | TBD — pre-Type-1 | SOC-2 Type-2 (published) + ISO 27001 | Enterprise Cloud MSA in place |
| **Google — Chrome Web Store** | Extension distribution + signing | Production extension bundle, developer contact, listing metadata | High | TBD — pre-Type-1 | Google Cloud SOC-2 covers underlying infra; Chrome Web Store specifically governed by Developer Program Policies | Click-through developer agreement |
| **Google — Chrome MV3 runtime** | Service-worker + isolated-world sandbox the extension relies on | None (runtime only) | High — platform | N/A (not a contracted vendor) | Chrome security assurance via Google | N/A |
| **Apple — App Store Connect + iOS runtime** | iOS distribution for the mobile shell | Mobile app bundle, developer identity | High | TBD — pre-Type-1 | Apple Business SOC-2 N/A; App Store governed by Developer Program License Agreement | DPLA signed |
| **Google Play Console + Android runtime** | Android distribution for the mobile shell | Mobile app bundle, developer identity | High | TBD — pre-Type-1 | Google Cloud SOC-2 underlies; Play Console governed by Developer Distribution Agreement | DDA signed |
| **Expo / EAS (Expo Application Services)** | Mobile build pipeline and OTA update channel for `apps/mobile/` | Build configuration, signing credentials, minimal app metadata | Medium | TBD — pre-Type-1 | SOC-2 Type-2 (Expo publishes annually) | Expo Terms of Service; Enterprise plan TBD |
| **npm, Inc. / GitHub Packages** | Dependency registry for `package-lock.json` | None outbound; inbound package fetch only | High — supply chain | TBD — pre-Type-1 | GitHub's SOC-2 covers npm post-acquisition | Standard registry terms |
| **`@noble/secp256k1`, `@noble/hashes`** | Cryptographic primitives (zero-dep, audited) | N/A (code) | High — supply chain | Reviewed at adoption; re-review annually | N/A — open source; upstream audit reports on project site | Open-source license |
| **Ledger** | Hardware wallet integration via `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-eth` | None — local WebHID transport only | Medium | TBD — pre-Type-1 | Ledger publishes security posture; Donjon security team | Open-source SDK; no contract |
| **Trezor** | Planned hardware wallet integration (scaffolded) | None — local USB/WebUSB transport | Medium | TBD — pre-integration | SatoshiLabs security posture published | Open-source SDK; no contract |
| **Public RPC — LlamaRPC** | Ethereum + multi-chain JSON-RPC endpoint | Wallet addresses queried, transaction metadata | Medium — privacy | TBD — pre-Type-1 | None (community-run) | Public endpoint, no contract |
| **Public RPC — PublicNode** | Multi-chain JSON-RPC endpoint | Same as above | Medium — privacy | TBD — pre-Type-1 | None | Public endpoint, no contract |
| **Public RPC — Ankr** | Multi-chain JSON-RPC endpoint (free tier) | Same as above | Medium — privacy | TBD — pre-Type-1 | Ankr enterprise tier holds SOC-2; free tier does not | Free tier; enterprise upgrade TBD |
| **WalletConnect** (if integrated — see PRD) | dApp relay protocol | dApp-origin → wallet session metadata | Medium | TBD — pre-integration | SOC-2 Type-2 published by WalletConnect Inc. | Public relay; enterprise relay contract TBD |
| **Cloudflare** | Dev tunneling (`expo start --tunnel`) during mobile preview; potential production CDN for static assets | Development traffic only (today); production CDN scope TBD | Medium | TBD — pre-production | SOC-2 Type-2, ISO 27001, ISO 27018, PCI-DSS | Pro plan; Enterprise plan pending production traffic |
| **AWS** (planned hosting target) | Control-plane hosting, managed Postgres, Secrets Manager, S3 | Control-plane operational data, audit-chain mirror for enterprise tenants | High | TBD — pre-deployment | SOC-1 + SOC-2 + SOC-3 Type-2 | AWS Customer Agreement + DPA required |
| **GCP** (alternative hosting target) | Same as AWS, if selected | Same as AWS | High | TBD — pre-deployment | SOC-1 + SOC-2 + SOC-3 Type-2 | Google Cloud Customer Agreement required |
| **Datadog** (planned observability) | Logs, metrics, traces, APM for control-plane | Operational telemetry; no customer key material; audit-event metadata only | Medium | TBD — pre-deployment | SOC-2 Type-2, HIPAA, ISO 27001 | MSA + DPA required |
| **Sentry** (planned error tracking) | Exception telemetry from control-plane and extension | Stack traces; PII scrubbing via beforeSend hook must be configured | Medium | TBD — pre-deployment | SOC-2 Type-2, GDPR readiness docs published | Team plan + DPA required |
| **CloudWatch** (AWS alternative to Datadog) | As above | As above | Medium | Same as AWS parent review | Covered by AWS SOC-2 | Covered by AWS MSA |
| **Dependabot** (GitHub-native) | Automated dependency update PRs | Repo read access (built-in) | High — supply chain | Covered by GitHub review | Covered by GitHub SOC-2 | Covered by GitHub contract |
| **Docusign** (planned) | Training attestations for CC1.4; contractor agreements | Employee/contractor name, email, signature metadata | Low | TBD — pre-Type-1 | SOC-2 Type-2, FedRAMP, ISO 27001 | Standard SaaS agreement |
| **Slack** (incident communication per IR runbook) | Internal messaging, incident channels | Incident details; no customer keys; may contain customer names | Medium | TBD — pre-Type-1 | SOC-2 Type-2, ISO 27001 | Business+ plan; EKM for encryption key control under evaluation |
| **1Password / HashiCorp Vault** (one of these, selection TBD) | Team password + shared credentials manager | Internal credentials | High | TBD — pre-Type-1 | Both publish SOC-2 Type-2 | TBD on selection |
| **age / rage** (threshold encryption for sealed backups per BCP §3.2) | Offline secrets encryption | N/A (code) | Low | Reviewed at adoption | N/A — open source | Open-source license |
| **Vanta / Drata / Strike Graph** (planned — SOC2_SCOPE §5 item 11) | Continuous compliance dashboard | Evidence metadata (PR reviews, CI runs, access lists) | Medium | TBD — pre-Type-2 | All three publish SOC-2 Type-2 | Selection + MSA pending |

## 3. Contractual controls required for High-tier vendors

For any High-tier vendor, the following must be in place before
production traffic or customer data flows:

1. **Master Services Agreement (MSA)** signed with Aethelred
   Foundation as the customer entity.
2. **Data Processing Agreement (DPA)** aligned with GDPR Article 28 for
   any vendor touching EEA data.
3. **Current SOC-2 Type-2 report** or equivalent (ISO 27001,
   FedRAMP-Moderate, etc.) on file, refreshed annually.
4. **Security questionnaire response** recorded in
   `docs/compliance/vendor-questionnaires/` (to be created — action
   item for the Q3 2026 vendor-review cycle).
5. **Named technical + legal contacts** with escalation paths.
6. **Exit plan** — how we re-host or substitute this vendor if the
   relationship terminates. Documented in
   `docs/compliance/BCP.md` at a minimum for each High-tier vendor.

## 4. Review cadence

- **On initial engagement** — full review completed before any
  production data flows.
- **Annually** — all High and Medium vendors re-reviewed in Q3 of each
  year to align with the SOC-2 annual cycle.
- **On material change** — change in vendor ownership, loss of SOC-2,
  material breach at the vendor, or substantial price or scope change
  triggers an ad-hoc review.

## 5. Known gaps

Visible for auditor:
1. Every **Review date: TBD** row represents an open review. The first
   full review cycle is scheduled for Q2 2026 pre-Type-1 fieldwork.
2. The vendor-questionnaire storage directory referenced in §3 does
   not yet exist.
3. AWS-vs-GCP selection for the control-plane remains open; both rows
   remain in the register until a decision is recorded in
   `DECISION_LOG.md`.
4. Datadog-vs-CloudWatch / Sentry-vs-self-hosted-error-capture
   selections are similarly open.

## 6. Related documents

- `docs/compliance/SOC2_SCOPE.md` §5 gap #4 — the gap this doc closes,
  and §6 "Evidence collection" which references vendor SOC-2s.
- `docs/security/THREAT_MODEL.md` T2 — supply-chain tampering threat
  that this register mitigates.
- `docs/compliance/BCP.md` §4 — vendor-outage playbooks reference rows
  here.
- `docs/runbooks/INCIDENT_RESPONSE.md` §3 — vendor-sourced detection
  signals (Dependabot, GitHub Advanced Security).
