# Incident Response Runbook

> **Last updated:** 2026-04-19
> **Owner:** Ramesh Tamilselvan — `security@aethelred.org`
> **Classification:** Internal / Auditor-shared
> **Applies to:** `aethelred-foundation/wallet` (extension, mobile shell,
> Elixir control-plane, GitHub org)
> **Supersedes:** *Nothing — this is the first version. Subsequent revisions
> must list what they changed.*

This runbook is the operational procedure for security and reliability
incidents affecting the Aethelred Wallet. It closes
`docs/compliance/SOC2_SCOPE.md` §5 critical gap #2 (CC7.3). Every
on-call engineer must be able to find, read, and execute this document
under time pressure — keep it skimmable, with copy-paste-ready commands
where possible.

## 1. Severity matrix

Severity is set at triage (target within 5 business days per
`.github/SECURITY.md`, faster for obvious P0/P1). Re-classify if
investigation reveals higher or lower blast radius.

| Level | Name | Definition | Example | Response target |
|-------|------|------------|---------|-----------------|
| **P0** | Critical | Customer key material leaked, or an active exploit is draining funds, or the audit chain is being forged at scale. Service fundamentally broken for many customers. | Private key extraction from IndexedDB working in the wild. Signer returns keys in cleartext. Chrome Web Store listing replaced with malicious bundle. | **Page immediately, 24/7.** Incident Commander engaged within 15 min. Public advisory within 24h. Fix or safe-state within 72h. |
| **P1** | High | Imminent risk of P0. Compromise detected but not yet exploited at scale. Or: safety mechanism failed but did not cause loss yet. | Audit chain self-verification detects a `chain_break` event for one customer. Passkey clone-detection (WebAuthn §6.1.1) fires. Dependabot critical advisory on a signing-path dep. Control-plane auth token leak in a log. | Page during business hours (same-day). IC engaged within 2h. Fix within 14 days, interim mitigation within 48h. |
| **P2** | Medium | Degraded service or localised issue. Functional regression that blocks a workflow but has a workaround. | Signing deadlock for a specific quorum shape. Velocity tracker false-positive rejecting legitimate transactions. Popup UI freeze after specific dApp interaction. | Assign next business day. Fix within 30 days. |
| **P3** | Low | Cosmetic, UX, or hardening opportunity. No customer impact. | Misaligned button in settings. Typo in audit-export header. Unnecessary permission in manifest (harmless). | Next release or backlog. |
| **P4** | Trivial | Documentation, comment, or internal-tooling fix. | Broken link in CLAUDE.md. Dev-only log message regression. | Backlog. |

### 1.1 When in doubt, escalate

Triage errors should bias **up** the scale, not down. A P2 that turns
out to be P0 is much more expensive than a P0 that turns out to be P2.

## 2. Roles

Roles are logical — one person may wear multiple hats for small
incidents.

| Role | What they do |
|------|--------------|
| **Incident Commander (IC)** | Single decision-maker during the incident. Runs the timeline, makes tradeoff calls, approves external comms. Cannot also be the fix-implementer. |
| **Security Lead** | Classifies severity, advises IC on containment, authorizes disclosure and bounty actions. |
| **Compliance Officer** | Owns regulator notifications (GDPR 72h, state breach laws, MiCA §§) and customer contractual notifications. |
| **Scribe** | Writes the live incident timeline in the incident channel. Freezes it for the post-mortem. |
| **Communications Lead** | Drafts customer + public comms, coordinates with support. |
| **Engineering Responder** | Implements fixes, runs forensic commands, owns deployment. |

For P0/P1 the IC must be a distinct human from the Engineering Responder.

### 2.1 Paging matrix

| Level | Who is paged |
|-------|--------------|
| P0 | IC (primary + secondary on-call), Security Lead, Compliance Officer, Communications Lead, Engineering Responder. All simultaneously. |
| P1 | IC, Security Lead, Engineering Responder. Compliance Officer informed async unless regulator trigger (see §6). |
| P2 | Engineering Responder. IC informed async. |
| P3 / P4 | Ticket only. |

Until named roles are staffed (see SOC2_SCOPE §5 item 2), all roles fall
back to the owner (`security@aethelred.org`). This single-point-of-
failure is a tracked gap.

## 3. Detection mechanisms

Incidents arrive from several channels. Triage requires treating all of
them as credible until ruled out.

- **Inbound vulnerability reports** — `security@aethelred.org` per
  `.github/SECURITY.md`, or GitHub Security Advisory.
- **Dependabot alerts** — `.github/dependabot.yml` schedules weekly
  updates; critical vulns open a PR immediately. Review at
  `https://github.com/aethelred-foundation/wallet/security/dependabot`.
- **GitHub Advanced Security** — Secret scanning, code scanning
  (CodeQL). Fires on push; surfaces at
  `…/security/code-scanning` and `…/security/secret-scanning`.
- **Audit-chain self-verification** — The extension's audit package
  (`packages/audit/evidence-builder.ts`) verifies the hash chain on
  every export and at popup boot. A `chain_break` event is logged
  locally and shipped to the control-plane for enterprise tenants via
  `packages/compliance/alert-system.ts`.
- **Policy-engine anomaly logs** — `packages/policy/engine.ts` emits
  `policy_rejected` events with reason codes; a sudden spike is an
  indicator of compromise.
- **Passkey clone detection** — WebAuthn §6.1.1 counter-regression check
  in the popup enrol + authenticate flow; triggers a workspace-wide
  `passkey_clone_suspected` event and a forced re-enrolment prompt.
- **Chrome Web Store developer dashboard** — Alerts on rejected updates,
  malware findings, review escalations.
- **CI pipeline failures** — `.github/workflows/ci.yml` `ci-ok` job
  failing on `main` means an unexpected break on a protected branch.
- **User bug reports** — via support channel and public GitHub issues.
  Treat every "my transaction did something unexpected" as P1 candidate
  until proven otherwise.

## 4. Response playbooks

### 4.1 P0 playbook — active key exfiltration / audit-chain forgery / live exploit

**Target: contain in 1h, mitigate in 24h, fix in 72h.**

1. **T+0 — Page.** Declare P0 in `#wallet-incidents`. IC acknowledges.
   Scribe starts the timeline.
2. **T+5 min — Contain.** IC decides one of:
   - Unpublish the extension from the Chrome Web Store developer
     dashboard if the bundle itself is compromised.
   - Roll the control-plane auth signer keys if control-plane creds are
     implicated (`elixir/config/runtime.exs` env vars via Secrets
     Manager). Existing JWTs expire within 5 min.
   - Push an emergency policy to the control-plane that forces
     high-tier workspaces into read-only mode.
3. **T+30 min — Evidence preservation.**
   - Snapshot the GitHub repo at the current SHA: `git tag
     incident/YYYY-MM-DD-HHMM && git push --tags`.
   - Export control-plane logs for the last 24h from CloudWatch /
     Datadog (see `docs/compliance/VENDOR_LIST.md` for the current
     observability vendor) to a quarantined bucket.
   - Ask affected users (via the bug report thread or support) to
     export their audit bundle via `packages/audit/export.ts` before
     touching the extension further.
4. **T+1h — Root-cause investigation.** Engineering Responder works from
   a clean clone, not the incident branch. Writes findings into the
   timeline as a running log.
5. **T+2h — Customer advisory draft.** Comms Lead drafts using the
   template in §5.2. Compliance Officer reviews before it goes out.
6. **T+24h — Customer advisory out.** Goes to the affected customers
   and, if materially serious, to `https://aethelred.org/security`.
7. **T+72h — Fix shipped.** Patched extension passes CI, gets expedited
   Chrome Web Store review (the WebStore escalation channel is listed
   in the developer dashboard help; no public SLA but expedited for
   security issues).
8. **T+7 days — Post-mortem draft.** See §7.
9. **T+14 days — Post-mortem published internally.**
10. **T+30 days — Follow-up action items closed or re-scoped.**

### 4.2 P1 playbook — high-risk, not yet exploited

**Target: acknowledge within 2h, interim mitigation within 48h, fix in
14 days.**

1. IC acknowledges on `#wallet-incidents`. Scribe starts timeline.
2. Engineering Responder reproduces the issue in a local build. If not
   reproducible, upgrade to P0 (unreproducible active threats imply
   blast radius unknown).
3. Decide on interim mitigation: can it be closed with a policy change
   (push via control-plane without an extension update)? If yes, ship
   the policy within 48h.
4. Push a PR with the real fix. Normal review + CI. No expedite unless
   severity escalates.
5. Post-mortem within 14 days of fix shipping.

### 4.3 P2 playbook — signing deadlock, false-positive policy reject

**Target: fix in 30 days.**

1. File a GitHub issue with `severity:p2` label.
2. Engineering Responder investigates during next sprint.
3. If affected customer is waiting, Comms Lead provides a workaround
   via support (example: temporary policy exemption via
   `packages/policy/templates.ts`).
4. Fix ships in normal release cadence.
5. Post-mortem optional; required if the same class of bug recurs.

### 4.4 P3 / P4 playbook

1. File GitHub issue. Done.

## 5. Communication templates

All templates are drafts. Comms Lead must tailor to the specific
incident and get Compliance Officer sign-off before anything customer-
or regulator-facing goes out.

### 5.1 Internal Slack declaration (post this first)

```
[INCIDENT] <sev> — <one-line title>

IC: @<handle>
Security Lead: @<handle>
Scribe: @<handle>
Responder: @<handle>

Status: investigating
Declared: YYYY-MM-DDTHH:MM:SSZ
Timeline: pinned thread below

What we know: <3 bullets>
What we don't: <2 bullets>
Next update in: 30 min
```

### 5.2 Customer advisory (P0/P1 with user impact)

Subject: `[Security] Aethelred Wallet — <what happened> — <action
required>`

```
Dear <customer>,

On <date, UTC>, Aethelred Foundation identified <plain-language summary
of the issue>. We are writing to inform you of this incident, what we
have observed, what we are doing about it, and what we recommend you do.

Summary
-------
<three-sentence description of what was affected, including specific
wallet component names where honest to do so>

What we observed
----------------
<facts, not speculation. Dates, counts, affected scopes.>

What we have done
-----------------
- <containment action 1>
- <containment action 2>
- <follow-up action with target date>

What we recommend you do
------------------------
- <clear, numbered, specific>
- If you believe your workspace may be affected, please contact
  security@aethelred.org with your workspace ID.

We will post further updates at
https://aethelred.org/security/incidents/YYYY-MM-DD and notify you
directly if our understanding materially changes.

Ramesh Tamilselvan
Aethelred Foundation
```

### 5.3 Regulator notification (if GDPR / MiCA / state breach law triggers)

Use the relevant regulator's intake form; template below is the narrative
body you will paste in.

```
1. Identity of controller: Aethelred Foundation, <legal entity>,
   <registration #>, <registered address>.

2. Data Protection Officer / security contact:
   security@aethelred.org (Ramesh Tamilselvan).

3. Nature of incident: <plain description>. Data categories affected:
   <KYC records / signing metadata / audit events / none>. Approximate
   number of data subjects: <count or "undetermined, bounded at N">.

4. Likely consequences: <financial / privacy / reputational>.

5. Mitigation measures taken or proposed:
   - <containment>
   - <remediation>
   - <customer notification timeline>

6. Contact for further information: security@aethelred.org.
```

Compliance Officer owns the clock. GDPR is **72 hours from awareness**;
MiCA / VARA / MAS have their own clocks — check
`packages/compliance/jurisdiction-engine.ts` outputs for the applicable
regimes per workspace.

### 5.4 Public advisory (for materially public incidents)

Publish at `https://aethelred.org/security/incidents/YYYY-MM-DD`.
Mirror key points in the affected GitHub Security Advisory.

## 6. Regulator triggers

Automatic upgrade paths:

| Trigger | Escalate to | Clock |
|---------|-------------|-------|
| Any confirmed leak of data classified `pii` or `restricted` in `packages/compliance/data-classification.ts` | GDPR (EEA subjects) | 72h |
| Any leak of materials held as compliance evidence for a regulated VASP / CASP tenant | MiCA supervisor for the tenant's jurisdiction | Per tenant contract, usually 24h |
| Any signing-key extraction confirmed | All affected regulator jurisdictions + Chrome Web Store abuse team | 24h |
| US-resident data subject breach | State attorneys general per applicable state law | Varies by state |
| A bank-tier enterprise customer's audit trail is confirmed forged | Their compliance officer via contractual channel | 24h |

## 7. Post-mortem template (blameless)

Name the doc `docs/runbooks/post-mortems/YYYY-MM-DD-<slug>.md`.

```
# Post-mortem — <incident title>

- Date of incident: YYYY-MM-DD (UTC)
- Severity: P<n>
- Duration: <declared → mitigated>
- Customers affected: <count / scope>
- Data affected: <classification tier from data-classification.ts>
- Author: <name>

## What happened
<Narrative in past tense. Present facts, not blame. People acted with
the information they had; the system either made the right action easy
or made it hard.>

## Timeline (UTC)
| Time | Event |
|------|-------|
| ... | ... |

## Root cause
<Direct technical cause. Then one level of "why" above that — what
latent factor allowed this to happen.>

## What went well
<At least two items. This is not flattery; identifying what worked is
how we keep doing it.>

## What went poorly
<At least two items. Focus on systems and processes, not individuals.>

## Action items
| ID | Action | Owner | Due | Status |
|----|--------|-------|-----|--------|
| AI-1 | ... | @... | YYYY-MM-DD | open |

## Evidence + references
- Incident channel export
- GitHub tag: incident/YYYY-MM-DD-HHMM
- Commit(s): <sha>
- Logs bundle: <path in quarantined bucket>
- Threat model entries: <IDs from docs/security/THREAT_MODEL.md>
```

Post-mortems are **blameless**. Phrases to avoid: "X should have known",
"X was careless", "we forgot". Phrases to prefer: "our tooling did not
surface Y", "our review checklist did not include Z", "the build
pipeline allowed W".

## 8. Recovery objectives

| System | RTO (Recovery Time) | RPO (Recovery Point) | How |
|--------|---------------------|-----------------------|-----|
| Chrome extension (user device) | N/A — client software; user updates via Chrome Web Store auto-update, typically within hours of release. | 0 — no server-side state to lose. | Ship fixed bundle; Chrome auto-updates. |
| Control-plane service | 4 hours | 15 min | Managed Postgres PITR. Phoenix app from CI-built artifact. |
| Audit-chain storage (control-plane mirror) | Matches control-plane | 0 — every event is hash-linked and replayable from user devices that still hold it. | Re-mirror from client exports. |
| Source code (`github.com/aethelred-foundation/wallet`) | 1 hour | 0 | GitHub continuous backup + local encrypted mirror (see BCP §3). |
| Build pipeline | 2 hours | Rebuild from source | See BCP §4. |

## 9. Known gaps

These are called out explicitly so an auditor does not have to discover
them:

1. Named roles (IC, Security Lead, Compliance Officer) are currently all
   held by the sole owner. Hiring plan tracked in
   `AETHELRED_ELIXIR_*_TEAM_PLAN_2026-04-11.md`.
2. No on-call rotation yet — contributes to the SOC2_SCOPE §5 item 10
   availability metrics gap.
3. SIEM integration (CC7.2) is not yet in place; detection currently
   depends on GitHub Advanced Security + human review of audit
   exports.
4. Drills — this runbook has not been exercised in a tabletop yet.
   First tabletop scheduled for Q3 2026 per SOC2_SCOPE timeline.

## 10. Related documents

- `.github/SECURITY.md` — external vulnerability disclosure policy.
- `docs/security/THREAT_MODEL.md` — which threats this runbook is
  responding to.
- `docs/compliance/SOC2_SCOPE.md` — CC7.3 control that this runbook
  satisfies.
- `docs/compliance/BCP.md` — availability-class continuity procedures
  invoked from §4.1 step 2 and §8.
- `docs/compliance/VENDOR_LIST.md` — contact details for GitHub, Chrome
  Web Store, observability vendor escalations used during response.
