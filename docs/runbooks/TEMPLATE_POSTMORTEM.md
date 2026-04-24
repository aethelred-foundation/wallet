# Postmortem: [Incident title] — [YYYY-MM-DD]

> **Incident ID:** INC-YYYY-MM-DD-NNN
> **Severity at peak:** P0 / P1 / P2
> **Duration:** HH:MM UTC → HH:MM UTC (NN hours total)
> **Customer impact:** [One sentence. Be specific: how many users, which paths, what did they see.]
> **Blameless:** This postmortem is blameless. The goal is to understand *what conditions allowed this to happen*, not *who did the wrong thing*. Edit aggressively if anyone-blaming language creeps in.

## 1. One-paragraph summary

[2-4 sentences. What happened, what broke, what fixed it, what got
worse. Someone skimming the incident archive should understand the
entire shape of this incident from this paragraph alone.]

## 2. Impact

### 2.1 Customer-visible impact

- **Affected users:** [count or "all customers on chain X" etc.]
- **Affected operations:** [which paths/flows were broken]
- **Observable symptom(s):** [what customers saw — error codes,
  hung UIs, silent failures]
- **Workaround available:** yes/no — [what it was, if any]

### 2.2 Business impact

- **Revenue impact:** [estimate or "none" or "pending"]
- **SLA implications:** [which customer SLAs were breached]
- **Trust / reputational impact:** [public communications made, or
  not]

### 2.3 Compliance impact

- **Regulator notification:** [required? if yes, timeline + which
  regulator]
- **GDPR / breach disclosure:** [72h clock started? when?]
- **Audit trail integrity:** [was any evidence lost? how was it
  preserved?]

## 3. Timeline

All times UTC. Include BOTH detection events and decision points —
not just code deploys.

| Time | Event | Actor |
|------|-------|-------|
| HH:MM | First automated alert fires (`<alert name>`) | PagerDuty |
| HH:MM | On-call acknowledges | @engineer |
| HH:MM | Runbook opened, first triage step executed | @engineer |
| HH:MM | Incident Commander declared, severity set to P0 | @IC |
| HH:MM | Customer comms draft circulated to #support | @comms-lead |
| HH:MM | First hypothesis tested + ruled out: [hypothesis] | @engineer |
| HH:MM | Root cause identified: [cause] | @engineer |
| HH:MM | Mitigation deployed to staging | @engineer |
| HH:MM | Mitigation promoted to production | @engineer |
| HH:MM | Customer-visible symptom cleared | monitoring |
| HH:MM | Incident declared resolved | @IC |

## 4. What went right

Not a fill-in-the-blanks section — be specific.

- [Thing that detected the problem faster than expected]
- [Mitigation path that was already rehearsed and worked]
- [Customer comms that landed cleanly]

## 5. What went wrong

Again, specific.

- [Detection gap — thing that should have paged but didn't, or
  something that paged too late]
- [Runbook step that was wrong, missing, or obsolete]
- [Tooling that didn't exist / was broken / was too slow]
- [Decision that was made with incomplete information]
- [Cascading failure — a secondary system broke because of the
  primary]

## 6. Where we got lucky

Luck is neither a strategy nor a defense. List anywhere that luck
was load-bearing. Every luck entry is an action item.

- [Thing that happened to be true but might not next time]

## 7. Root cause analysis

### 7.1 Direct cause

[1-2 paragraphs: the specific code / config / data condition that
produced the observable failure.]

### 7.2 Contributing factors

- **Technical:** [architectural choices, test coverage gaps, deploy
  pipeline issues that allowed the direct cause to land]
- **Process:** [review process gaps, communication failures,
  oncall-handoff issues]
- **Environmental:** [upstream dep changes, provider outages,
  unusual traffic patterns]

### 7.3 Why the existing controls didn't catch it

The most expensive section. Every control the codebase claims
to have (tests, CI, code review, canaries, monitoring) should be
examined:

- **Unit / integration tests:** did any test exist for this path?
  If yes, why did it pass? If no, why not?
- **CI checks:** would this have been caught by typecheck / lint /
  security scan? If yes, why wasn't it? If no, could a new check
  catch the next one?
- **Code review:** was this part of the code reviewed? Was the
  reviewer trained on the relevant property?
- **Staging canary:** did this roll through staging? What did we
  miss?
- **Production monitoring:** did any metric drift leading up to
  the incident? Would a different alert have fired sooner?

## 8. Action items

Every action item follows the format:

- [ ] **[OWNER]** [ACTION] — target: [DATE]

Not vague goals. Concrete work.

Examples:

- [ ] **@engineer1** Add property test for `foo` that exercises
  the boundary case in §7.1 — target: +7 days
- [ ] **@engineer2** Update runbook `x402-binding-hash-mismatch.md`
  §3 to include the new rollback command — target: +14 days
- [ ] **@ops** Increase `x402.binding.mismatch` alert sensitivity
  from 1-per-minute to 1-per-5-minutes so we don't miss it during
  low-traffic hours — target: +30 days
- [ ] **@IC** Schedule a team-wide on-call drill that exercises
  this runbook — target: +60 days

Rule: every P0 produces ≥ 3 action items. Every P1 produces ≥ 1.
Close within 30 days for P0 items; 60 days for P1.

## 9. Lessons

2-3 paragraphs of narrative that future engineers will actually
read. Tell the story from the inside — what did you think you
knew that turned out to be wrong? What sharp edge do you wish
someone had told you about?

## 10. Appendix

- Relevant logs excerpts (redacted of PII).
- Relevant dashboards (at the time-of-incident).
- PR links for mitigation + follow-ups.
- Links to any upstream vendor advisories or shared-fault analysis.
