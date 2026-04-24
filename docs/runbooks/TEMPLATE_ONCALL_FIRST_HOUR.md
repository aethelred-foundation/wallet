# On-Call First-Hour Framework

> **Read this BEFORE you need it.** Every alert-specific runbook assumes
> you already know this framework. The framework itself is short —
> under 5 minutes to skim cold.

## Minute 0–2: acknowledge + stabilize yourself

1. **Acknowledge the page in PagerDuty.** This stops the escalation
   timer and tells the team a human is engaged.
2. **Open the runbook** linked from the alert. If the alert has no
   runbook, escalate to the #oncall channel immediately — this is
   a process bug.
3. **Take a breath.** The first five minutes of an incident are
   where most mistakes happen. A calm 60-second read of the alert
   + runbook is strictly faster than five rushed minutes of fumbling.

## Minute 2–5: contain

Before diagnosing, ask: **can I reduce blast radius right now?**

Common containment actions (per-alert runbook specifies which):

- **Kill switch.** Sponsor service has `KillSwitchPolicy.arm()`;
  flipping it halts all sponsorship without a redeploy. Other
  services expose similar switches.
- **RPC failover.** Most chain-consumer packages accept multiple
  RPC endpoints; flip the primary to a secondary via ops config.
- **Rate-limit tightening.** Reduce the accepted request rate so
  the problem doesn't propagate.
- **Feature-flag rollback.** If the offending code is behind a
  flag, turn it off.
- **Rollback deploy.** Last resort — fast path is the kill switch
  if one exists for the surface area.

Containment is NOT a fix. It buys time to think.

## Minute 5–15: diagnose

Follow the runbook's triage section. Generic diagnosis questions:

1. **When did it start?** Exact timestamp of the first anomaly
   (not the first page — pages lag by design).
2. **What changed around that time?** Recent deploys, config
   changes, upstream dep updates, traffic spikes.
3. **Is it a subset or everyone?** Per-tenant, per-chain,
   per-custody-adapter, per-region — every cross-section narrows
   the hypothesis space.
4. **Does it correlate with a known external event?** Chain
   reorg, provider outage (status.alchemy.com / status.base.org /
   status.aws.amazon.com), Chainlink oracle stall.

## Minute 15–30: declare + communicate

Once you have a working hypothesis:

1. **Declare severity + IC.** Use the severity matrix in
   `INCIDENT_RESPONSE.md` §1. If P0, the IC role is mandatory and
   cannot be the person implementing the fix.
2. **Open an incident channel** (Slack / Discord per ops config)
   named `#inc-YYYY-MM-DD-NNN`. Pin the runbook, the dashboard,
   and the alert link.
3. **Initial customer comms** for P0: draft Statuspage entry
   within 15 minutes of declaration. Do NOT wait for root cause —
   "we're investigating, updates every 30 min" is correct.
4. **Regulator clock starts** for GDPR-affecting incidents:
   72-hour window from "became aware," which is the page-ack time,
   not the resolution time.

## Minute 30–60: mitigate

Mitigation > fix. A 5-minute containment that returns customers
to working state is better than a 5-hour fix.

Rank paths by:

1. **Safety first.** Any path that widens blast radius is wrong.
2. **Reversibility.** Prefer paths that can be undone if they
   don't work.
3. **Speed.** Among equally safe + reversible options, ship the
   fastest.
4. **Clarity.** Pick paths the runbook has documented. Unreviewed
   improvisation multiplies the postmortem length.

## After the first hour

If the incident isn't resolved in the first hour:

- **Rotate the IC role** if the current IC has been at it > 90
  minutes. Fatigue causes judgment errors.
- **Schedule the next update** at a specific time. "I'll update
  in 30 min" — and then do update, even if you're saying "no
  change, still investigating."
- **Consider a secondary on-call activation** for longer
  incidents.

## Sharp edges specific to Aethelred

- **Key material handling.** NEVER paste a suspected-compromised
  private key into Slack/Discord/Jira/anywhere. Incident channels
  are not secure-enough for key material. Use the secure-storage
  handoff process in `INCIDENT_RESPONSE.md` §7.
- **On-chain actions are irreversible.** Any action that produces
  an on-chain transaction during an incident (revoking a budget,
  anchoring a fake root, rotating an upgrade-admin) becomes
  permanent evidence. Document the intent BEFORE the transaction.
- **Audit chain integrity.** If the incident touched the audit
  trail, preserve the complete event store (via `audit:export`)
  before any mitigation that might alter it.

## After the incident

Every P0 / P1 produces a postmortem within 5 business days using
`TEMPLATE_POSTMORTEM.md`. Blameless. Action items have owners and
target dates.

Reference this framework whenever you update a specific runbook —
the runbook is the diff against this baseline, not a replacement.
