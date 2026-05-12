# Aethelred Wallet — Runbooks

> **What lives here:** alert-specific operational runbooks for every
> P0/P1 alert in the production observability stack. Also includes
> incident-response templates (postmortem, on-call first-hour) used
> across all incident classes.

## Structure

| File | Purpose |
|------|---------|
| [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md) | Generic response playbook — severity matrix, roles, escalation paths, regulator notification deadlines |
| [`TEMPLATE_POSTMORTEM.md`](TEMPLATE_POSTMORTEM.md) | Blameless postmortem template used for every P0/P1 within 5 business days of resolution |
| [`TEMPLATE_ONCALL_FIRST_HOUR.md`](TEMPLATE_ONCALL_FIRST_HOUR.md) | Generic first-hour framework for on-call engagement — reference before every alert-specific runbook |
| Alert-specific runbooks (below) | One file per P0/P1 alert. Linked from the alert definition itself |

## The no-alerts-without-runbooks rule

Per [`docs/compliance/OBSERVABILITY_SCOPE.md`](../compliance/OBSERVABILITY_SCOPE.md) §6,
every P0 and P1 alert MUST link to a runbook in this directory. An
alert without a runbook cannot fire in production — it sits in a
staging lane until the runbook is written.

This means: **adding a new alert is a two-PR process** — one to define
the alert, one to write the runbook. Or a single PR containing both.
The runbook must be operationally actionable (copy-pasteable commands
where possible, specific thresholds, clear escalation criteria).

## Alert-specific P0 runbooks

Runbooks for the seven zero-tolerance events from `OBSERVABILITY_SCOPE.md` §4.3:

| Alert | Runbook | Status |
|-------|---------|--------|
| `x402.binding.mismatch ≥ 1` | [`x402-binding-hash-mismatch.md`](x402-binding-hash-mismatch.md) | ✅ Written |
| `custody.sign.recovery.mismatch ≥ 1` | [`custody-signature-recovery-mismatch.md`](custody-signature-recovery-mismatch.md) | ✅ Written |
| `custody.shamir.reconstruction.failed ≥ 1` | [`shamir-reconstruction-failed.md`](shamir-reconstruction-failed.md) | ✅ Written |
| `router.nonce.replay.detected ≥ 1` | [`intent-router-nonce-replay.md`](intent-router-nonce-replay.md) | ✅ Written |
| `router.fill.mismatch ≥ 1` | [`intent-router-fill-mismatch.md`](intent-router-fill-mismatch.md) | ✅ Written |
| `sponsor.request_id.reused ≥ 1` | [`paymaster-request-id-reuse.md`](paymaster-request-id-reuse.md) | ✅ Written |
| `notary.anchor.tx.reverted ≥ 1` | [`notary-anchor-tx-reverted.md`](notary-anchor-tx-reverted.md) | ✅ Written |

**All seven zero-tolerance runbooks complete.** Every P0 alert
enumerated in [`OBSERVABILITY_SCOPE.md`](../compliance/OBSERVABILITY_SCOPE.md)
§4.3 has an operational playbook at production readiness. Phase 2
of the observability rollout is unblocked on the runbook dimension.

## Alert-specific P2 runbooks

High-frequency operational events — not correctness violations.
These runbooks help operators distinguish expected failure modes
(where the moat's defences fired correctly) from genuinely
unexpected ones requiring code or config changes.

| Alert | Runbook | Status |
|-------|---------|--------|
| `swap.solver.tx.reverted ≥ N` | [`swap-solver-tx-reverted.md`](swap-solver-tx-reverted.md) | ✅ Written |
| `transfer.solver.tx.reverted ≥ N` | [`transfer-solver-tx-reverted.md`](transfer-solver-tx-reverted.md) | ✅ Written |
| `x402.solver.facilitator.error ≥ N` | [`x402-facilitator-error.md`](x402-facilitator-error.md) | ✅ Written |
| `audit.chain_link_mismatch ≥ 1` | [`audit-trail-gap.md`](audit-trail-gap.md) | ✅ Written |
| `custodian_liability_unknown_rate ≥ 0.05` | [`custodian-oracle-degraded.md`](custodian-oracle-degraded.md) | ✅ Written |

Operational coverage now spans all three solver kinds —
**transfer + swap (chain-shaped failures) + x402 (HTTP-shaped failures)** —
plus the **audit-pipeline integrity** dimension and the **custodian-oracle
reliability** dimension. The x402 runbook is the only solver runbook with
a P0 path inside the P2 family (`receipt-amount-exceeds-commitment`)
because the facilitator is the single trust boundary that can
adversarially overcharge. The audit-trail-gap runbook has its own P1
escalation when `chain_integrity_broken` fires (tamper signal vs the
milder gap signal) or when a gap intersects an active GDPR/CCPA/SOC-2
evidence window. The custodian-oracle-degraded runbook escalates to P1
when `unknown_rate ≥ 0.25` for any single custodian, or when AUM > \$100M
on that custodian, or when an open regulator request intersects the gap
window.

## Writing a new runbook

1. Start from [`TEMPLATE_ONCALL_FIRST_HOUR.md`](TEMPLATE_ONCALL_FIRST_HOUR.md).
2. Fill in every section — no placeholders shipped to `main`.
3. Test the runbook by walking through it without consulting
   external docs. If a step requires you to know something not
   stated in the runbook, add that fact to the runbook.
4. Link the alert definition in the observability stack to the
   runbook URL.
5. In the same PR (or linked follow-up), update this README.

## Runbook freshness

Runbooks rot. Every runbook must be reviewed + re-validated at least
once per quarter. Add a `Last validated:` date at the top of every
runbook; anything over 90 days old during an incident triggers a
secondary escalation to re-check its accuracy before executing.
