# Business Continuity + Disaster Recovery Plan

> **Last updated:** 2026-04-19
> **Owner:** Ramesh Tamilselvan — `security@aethelred.org`
> **Classification:** Internal / Auditor-shared
> **Applies to:** `aethelred-foundation/wallet` and its operational
> dependencies.

Closes `docs/compliance/SOC2_SCOPE.md` §5 critical gap #3 (CC9.1).
Defines recovery objectives, backup strategy, and per-scenario
playbooks so the business can continue operating through foreseeable
disruptions.

## 1. Scope + assumptions

- In-scope systems match `docs/compliance/SOC2_SCOPE.md` §3.1.
- Out-of-scope: the Aethelred L1 chain itself (separate BCP), user
  devices, and third-party dApps.
- This plan assumes the wallet has not yet entered the Type-2
  observation period; availability metrics therefore inform, rather
  than constrain, the targets below. Targets tighten once the on-call
  rotation and multi-region deploy land (SOC2_SCOPE §5 item 10).
- Targets expressed in UTC. "RTO" is the maximum tolerable downtime;
  "RPO" is the maximum tolerable data loss measured in wall-clock
  time.

## 2. Critical systems — RTO / RPO

| System | RTO | RPO | Impact if down | Rationale |
|--------|-----|-----|----------------|-----------|
| **Chrome extension** (`apps/extension/`) at user device | N/A | N/A | Users cannot sign new transactions; existing held assets safe. | Client software. Once installed, the extension runs entirely on the user's browser. "Down" in the BCP sense means "the Chrome Web Store has delisted the extension or the latest release is broken." The mitigation is to ship a fixed build, not to run a hot-standby. |
| **Wallet control-plane** (`elixir/`) | 4 hours | 15 minutes | Cross-device approval push delayed; enterprise-tier quorum still evaluates client-side. | Managed Postgres with continuous PITR; Phoenix app redeployable from CI artifact. 4h reflects realistic cold-region redeploy given today's team size. |
| **Source code repository** (`github.com/aethelred-foundation/wallet`) | 1 hour | 0 | No new merges, no CI runs, no release cuts. Existing clones still operational. | GitHub outage is rare (<1h annually). Local encrypted mirror is hourly; a fork on a secondary provider is restorable within 1h. |
| **CI + build pipeline** (`.github/workflows/ci.yml`) | 2 hours | 0 | Cannot cut a release; cannot merge PRs (because CI is required by branch protection). Security fixes can still be committed against a local mirror and released through a side-channel. | Rebuilding the pipeline on a secondary CI provider (GitLab, Buildkite) is scripted; 2h reflects one engineer executing the runbook. |
| **Secrets manager** (planned: GCP Secret Manager or AWS Secrets Manager) | 2 hours | 0 | Control-plane cannot authenticate to downstreams; signing of server-side artifacts blocked. | Secrets are mirrored to a sealed backup bundle (§3.2). |
| **Observability** (planned: CloudWatch / Datadog / Sentry) | 24 hours | 1 hour | Reduced forensics capacity during an outage. | Non-critical to customer signing; high RTO acceptable. |
| **Package registry** (npm + GitHub Packages) | Depends on registry operator | N/A | Cannot run `npm ci` — blocks new builds only; installed extensions unaffected. | Covered by the dual-origin strategy in §4.3. |
| **Chrome Web Store** | Set by Google — typically 24h for outages, weeks for review escalation | N/A | Cannot ship new releases; existing users unaffected. | Out of our control. See §4.6. |

## 3. Backup strategy

### 3.1 Source code

- **Primary:** `github.com/aethelred-foundation/wallet` (private, Enterprise plan).
- **Secondary mirror:** hourly `git fetch --all --prune` into a
  maintained mirror on `gitlab.com/aethelred-foundation/wallet-mirror`
  (planned; tracked as a BCP action item). Mirror-only access; no
  writes.
- **Offline cold copy:** encrypted tarball of the repo + dependency
  cache kept on the owner's workstation, refreshed nightly via a
  scripted `git bundle` + age-encrypt. Rotation: 14 days. Access
  control: age recipient key stored in a hardware authenticator.

### 3.2 Infrastructure configs and secrets

- Terraform / IaC configs versioned in a separate private repo with the
  same backup strategy as §3.1.
- Secrets (control-plane env values, RPC API keys, Sentry DSNs) are
  stored in the cloud secret manager. A sealed backup bundle —
  encrypted with a threshold-shared key (three custodians, quorum of
  two) — is refreshed quarterly and stored in an S3-compatible
  off-account bucket.

### 3.3 Control-plane database

- Managed Postgres with **continuous PITR** (point-in-time recovery)
  covering 7 days.
- **Daily snapshots** retained 35 days, cross-region replicated.
- **Weekly logical dumps** encrypted and written to an off-account
  bucket; retained 1 year.
- Recovery rehearsal: quarterly restore of the most recent weekly dump
  into a sandbox environment, documented in the BCP test log (see §6).

### 3.4 Audit-chain evidence bundles

- Per `packages/audit/evidence-builder.ts`, audit bundles are
  self-contained and cryptographically self-verifying. Enterprise
  tenants upload bundles to the control-plane mirror; personal tier
  keeps bundles on the user device.
- The **chain head hash** is the minimum backed-up item: notarization
  to Aethelred L1 (Phase 2 "Moat 1", currently planned) makes the
  bundle's integrity independently verifiable even if the control-plane
  mirror is destroyed.

### 3.5 Documentation

All `docs/**` and root-level `AETHELRED_WALLET_*` documents live in
the repo and are backed up with it (§3.1).

## 4. Disaster scenarios and playbooks

Each scenario links to the most applicable
`docs/runbooks/INCIDENT_RESPONSE.md` severity.

### 4.1 GitHub outage

**Severity trigger:** entirety of `github.com` inaccessible > 30 min, or
`aethelred-foundation/wallet` specifically down.

Playbook:
1. Confirm with `https://www.githubstatus.com`.
2. Short outage (< 1h): wait it out; announce in `#wallet-eng`. No
   customer comms required.
3. Prolonged outage (> 1h): activate the secondary mirror (§3.1) as the
   read source. New commits queue locally until GitHub returns; do not
   attempt to re-parent history.
4. If GitHub is down for > 24h, re-host CI on the backup CI provider
   (§4.2) pointing at the secondary mirror.

RTO: 1h for read; CI may take an additional 2h to reconstitute.

### 4.2 CI pipeline failure

**Severity trigger:** `main` pipeline red for > 4h with no obvious fix,
or GitHub Actions itself is down.

Playbook:
1. If failure is a transient runner issue, retry. Do not merge with a
   failing `ci-ok` check — branch protection enforces this.
2. If GitHub Actions is down, cut the release locally:
   - `npm ci --ignore-scripts && npm run type-check && cd
     apps/extension && npx vitest run && cd ../.. && npm run build
     --workspace @aethelred/wallet-extension`.
   - The build artifact goes through the normal Chrome Web Store
     submission; two-human review of the diff is still required.
3. Longer outage: reconstitute CI on the backup provider using the
   workflow in `.github/workflows/ci.yml` as the source of truth.

RTO: 2h.

### 4.3 Cloud region outage (AWS / GCP)

**Severity trigger:** primary region unavailable > 15 min for a
managed service the control-plane relies on.

Playbook:
1. Monitor the provider's status page.
2. For short outages (< RTO), wait. The extension itself is unaffected;
   customer signing continues client-side.
3. For long outages, redeploy the control-plane to a secondary region
   from the latest CI artifact. Restore the database from the most
   recent cross-region snapshot (§3.3). Cutover time dominated by DNS
   propagation (~15 min with low TTL in place).
4. Update the customer status page.

RTO: 4h.

### 4.4 Insider threat

**Severity trigger:** evidence of a current or former contributor
exfiltrating code, secrets, or customer data.

Playbook:
1. Declare **P0** in `docs/runbooks/INCIDENT_RESPONSE.md` terms.
2. Security Lead revokes all GitHub org access for the individual —
   within 1h per CC6.5. Audit-log the revocation.
3. Rotate any secrets the individual had access to (§3.2).
4. Engage legal counsel before any customer or regulator comms.
5. Investigate scope using GitHub Audit Log, cloud provider CloudTrail
   / Cloud Audit Logs, and the wallet's own audit-chain export for any
   workspace the individual had access to.
6. Post-mortem must specifically address how privileged access is
   monitored going forward.

RTO: access revocation 1h; full investigation up to 30 days.

### 4.5 Signing-key leak (customer-impacting)

**Severity trigger:** any confirmed or high-confidence-suspected
exposure of a production customer signing key.

Playbook:
1. Declare **P0**.
2. Run §4.1 of `docs/runbooks/INCIDENT_RESPONSE.md` in parallel:
   - Contain (pull extension if the extension itself is at fault).
   - Engage regulator-notification clock per jurisdiction engine.
   - Direct customer comms to help them move assets before attackers
     can drain.
3. Ship a patched extension, mandatory re-unlock + passkey re-verify
   on next open.
4. Root-cause + post-mortem with an RR entry added to
   `docs/security/THREAT_MODEL.md` §5 for any new residual.

RTO: mitigation within 24h; fix within 72h.

### 4.6 Chrome Web Store delisting

**Severity trigger:** extension removed from the store by Google for
policy or security reasons, or mistakenly.

Playbook:
1. Check the developer dashboard for the reason code.
2. If false positive: appeal via the dashboard. Typical turnaround 3–7
   business days. Customers on the current version keep working.
3. If legitimate concern: treat as **P1** if a fix exists, **P0** if
   the current version is actively unsafe. Push a fix, re-submit.
4. If prolonged, provide side-load instructions for regulated
   enterprise customers via the support channel — never in public
   docs, since side-loaded builds bypass Web Store review.

RTO: appeal decision 3–7 business days; fix-and-resubmit 72h.

### 4.7 Ransomware / malware on an employee endpoint

**Severity trigger:** endpoint detection fires, or suspicious behaviour
observed on a device with access to the wallet org.

Playbook:
1. Isolate the endpoint from the network immediately.
2. Revoke GitHub org access, cloud credentials, Chrome Web Store
   developer access for the user.
3. Rotate any secrets the endpoint had cached.
4. Re-issue the employee a clean device before re-granting access.
5. Post-mortem — was any customer data on that endpoint? If yes,
   compliance-officer notification path kicks in.

RTO: access revocation 1h.

### 4.8 Loss of the sole owner (bus factor)

**Severity trigger:** owner unreachable for > 72h with no pre-notified
absence.

This is an acknowledged single-point-of-failure today (see SOC2_SCOPE
§5 item 10 and IR runbook §9). Interim mitigation:
- Escrow of the sealed infrastructure-secrets bundle (§3.2) with a
  legal custodian.
- GitHub org ownership held by two humans (owner + backup); backup may
  appoint an interim lead.
- Once a second FTE is hired, this scenario is replaced by the §4.4
  insider-threat playbook logic for dual-control.

## 5. Communication + coordination

During BCP-scale events:
- Primary coordination channel: `#wallet-incidents` Slack.
- Backup channel: a pre-created Signal group for the roles in IR §2.
- Status page (planned): `https://aethelred.org/status` — sourced from
  a tiny static repo independent of the main control-plane.

## 6. Testing + rehearsal plan

| Activity | Frequency | Owner | Evidence |
|----------|-----------|-------|----------|
| Database restore drill (§3.3) | Quarterly | Platform lead | Screenshot + command log in the BCP test log. |
| GitHub-outage tabletop (§4.1) | Annually | IC | Written summary. |
| Region-outage failover rehearsal (§4.3) | Annually | Platform lead | Runbook execution log. |
| Secrets-bundle restore (§3.2) | Annually | Security Lead | Log of successful decrypt in sealed environment. |
| Insider-threat tabletop (§4.4) | Annually | Security Lead + legal counsel | Written summary. |
| Full DR drill (all scenarios in sequence) | Annually before SOC-2 fieldwork | IC | Evidence package for auditor. |

The BCP test log lives at `docs/runbooks/bcp-tests/` and is one of the
deliverables for SOC2 Type-2.

## 7. Known gaps

Declared openly for auditor:
1. Secondary GitLab mirror (§3.1) not yet populated; tracked as a BCP
   action item.
2. Off-account secrets-bundle backup (§3.2) custodians not yet
   designated — single-owner issue carries here too.
3. Status page (§5) not yet built.
4. None of the rehearsals in §6 have run yet; first full cycle
   scheduled Q3 2026.

## 8. Related documents

- `docs/compliance/SOC2_SCOPE.md` §5 gap #3 — the gap this doc closes.
- `docs/runbooks/INCIDENT_RESPONSE.md` — scenario-specific escalation
  procedures referenced from §4.
- `docs/compliance/VENDOR_LIST.md` — current identity of the "planned"
  observability / secrets / DB vendors once selected.
- `docs/security/THREAT_MODEL.md` — D1–D3 availability threats whose
  residual risk is owned by this BCP.
