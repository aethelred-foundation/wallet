# Aethelred Wallet — Observability Scope + Rollout Plan

> **Classification:** Internal / Auditor-shared
> **Owner:** Ramesh Tamilselvan (<rameshtamilselvan@gmail.com>)
> **Status:** Draft — ready for vendor RFP + Type 2 engagement
> **Target production-readiness:** Q3 2026
> **Complement to:** [`SOC2_SCOPE.md`](SOC2_SCOPE.md) §5 gap "observability
> stack not yet deployed" · [`SOC2_MOAT_CONTROL_MAPPING.md`](SOC2_MOAT_CONTROL_MAPPING.md)
> evidence-tier-3 (observational) · [`BCP.md`](BCP.md) incident detection
> paired with detection-to-recovery flow · [`../security/THREAT_MODEL.md`](../security/THREAT_MODEL.md)
> monitoring of the attack surfaces enumerated there
> **Last updated:** 2026-04-24

## 1. Purpose

This document is the observability scoping artifact for the Aethelred
moat stack. It serves four audiences:

1. **Internal engineering** — concrete implementation plan for when
   the observability stack lands.
2. **SOC-2 Type 2 engagement** — evidence-tier-3 control mapping
   (observational: "did the control operate during the observation
   window"). Closes the "observability stack not yet deployed" gap
   flagged in `SOC2_MOAT_CONTROL_MAPPING.md` §5.
3. **Enterprise procurement** — shows we've planned the "what
   happens when things break" dimension before customers deploy.
4. **Vendor RFPs** — structured brief a Datadog / Honeycomb / Grafana
   / CloudWatch integration partner can quote against.

This is the observability counterpart to `AUDIT_SCOPE.md` (security)
and `SOC2_MOAT_CONTROL_MAPPING.md` (compliance). Together they form
the runtime-readiness triangle.

## 2. Signal taxonomy

Four signal types, each with a distinct consumption pattern:

| Signal | Consumer | Retention | Examples |
|--------|----------|-----------|----------|
| **Metrics** | Dashboards + alerts | 13 months | Payment latency p99, TEE attestation verification rate, sponsor policy denial rate |
| **Logs** | Incident triage + audit | 18 months hot, 7 years cold | Structured JSON events per request, every policy-gate denial with reason code |
| **Traces** | Performance debugging | 30 days | End-to-end spans across custody → intent-router → x402 → sponsor → audit → notarization |
| **On-chain events** | Audit + reconciliation | Indefinite (on-chain) | `BatchAnchored` event indexing, `Spent` event reconciliation |

Design-time rule: **every signal carries a `tenantId` label and a
`moduleId` label** (one of 12 moat packages). Makes per-tenant slicing
+ per-package SLO tracking possible out-of-the-box.

## 3. Per-package observability requirements

Each of the 12 moat packages needs at least three metrics. The table
below enumerates the *critical* ones — the set a SOC-2 Type 2 auditor
asks about first.

### 3.1 `@aethelred/wallet-x402`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `x402.payment.latency` (p99) | metric | ≤ 500ms | p99 > 1000ms for 5 min |
| `x402.attestation.verification.rate` | metric | 100% success for non-excepted flows | any failure = P0 page |
| `x402.binding.mismatch` | metric (counter) | 0 tolerance | ≥ 1 in 1 min = P0 page |
| `x402.payment.requirements.response` | log (structured) | — | — (audit-only) |
| `x402.facilitator.status_codes` | metric | < 0.1% 5xx | > 1% 5xx for 5 min |

**Why:** x402 is the payment cornerstone. A binding-mismatch event
means either a compromised client OR a protocol bug — both warrant
immediate paging, not a dashboard glance. Verification-rate of 100%
is aspirational but achievable because every failure should be
either client-config (excepted via policy) or a genuine anomaly.

### 3.2 `@aethelred/wallet-mcp-server`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `mcp.tool.dispatch.latency` (p95) | metric | ≤ 200ms | p95 > 500ms for 10 min |
| `mcp.policy.denial.rate` | metric | < 5% in steady state | > 25% for 10 min = P1 (indicates broken policy bundle) |
| `mcp.handler.internal_error` | metric (counter) | — | > 0 in 1 min = P2 |
| `mcp.info_disclosure.sanitised` | metric (counter) | — | (observability of defense working) |

### 3.3 `@aethelred/wallet-custody-adapters`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `custody.sign.latency{adapter}` (p99) | metric | varies per adapter | LocalKey > 10ms, Nitro > 500ms, Ledger > 3s, Fireblocks > 10s |
| `custody.nitro.attestation.expired` | metric (counter) | — | > 0 in 5 min = P1 |
| `custody.shamir.reconstruction.failed` | metric (counter) | 0 tolerance | ≥ 1 = P0 page |
| `custody.adapter.disposed.after_use` | metric (counter) | — | (memory-hygiene health) |

### 3.4 `@aethelred/wallet-reputation`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `reputation.evaluate.latency` (p95) | metric | ≤ 150ms | p95 > 500ms for 10 min |
| `reputation.erc8004.lookup.latency` | metric | ≤ 100ms (cached), ≤ 500ms (uncached) | uncached p99 > 2s for 5 min |
| `reputation.gate.denial.by_rule` | metric | — | (business-health signal) |
| `reputation.vc.verification.failed` | metric (counter) | — | > 10/min = P2 |

### 3.5 `@aethelred/wallet-intent-router`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `router.intent.execution.outcome` | metric (gauge per outcome) | fulfilled > 95% | fulfilled < 80% for 10 min = P1 |
| `router.solver.quote.latency` (p95) | metric | ≤ 1s | > 3s for 10 min |
| `router.nonce.replay.detected` | metric (counter) | 0 tolerance | ≥ 1 = P0 page |
| `router.fill.mismatch` | metric (counter) | 0 tolerance | ≥ 1 = P0 page |

### 3.6 `@aethelred/wallet-agent-budget`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `budget.canSpend.latency` (p99) | metric | ≤ 100ms | p99 > 500ms for 5 min |
| `budget.spend.denial.by_reason` | metric | — | (by-reason histogram drives SRE investigation) |
| `budget.session.revocation.propagation` | metric | ≤ 1 block | > 1 block = P0 page (moat property violation) |

The revocation-propagation SLO is the moat property: any observable
delay means a user-op could slip through post-revocation.

### 3.7 `@aethelred/wallet-invoice`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `invoice.pay_surface.resolve.latency` (p95) | metric | ≤ 200ms | p95 > 500ms |
| `invoice.signature.verify.failed` | metric (counter) | — | > 10/min = P2 |
| `invoice.state_transition.rejected` | metric | — | (audit-only; state-machine violations) |

### 3.8 `@aethelred/wallet-paymaster-sponsor`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `sponsor.sponsorship.success.rate` | metric | > 95% of valid requests | < 80% for 10 min = P1 |
| `sponsor.oracle.quote.age` | metric (gauge) | ≤ 60s fresh | > 120s = P1 (oracle stall) |
| `sponsor.policy.denial.by_policy_id` | metric | — | (business-health) |
| `sponsor.request_id.reused` | metric (counter) | 0 tolerance | ≥ 1 = P0 |
| `sponsor.settlement.reconcile.lag` | metric | ≤ 5 min | > 30 min = P1 |

### 3.9 `@aethelred/wallet-sovereign-export`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `export.generate.latency{schema}` | metric | ≤ 10s per export | > 30s |
| `export.envelope.signature.failed` | metric (counter) | 0 tolerance | ≥ 1 = P0 |

### 3.10 `@aethelred/wallet-notarization`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `notary.batch.anchor.latency` | metric | ≤ 20 min from finalize to confirmed | > 30 min = P1 |
| `notary.batch.backlog.size` | metric (gauge) | ≤ 1 pending | > 3 = P1 |
| `notary.anchor.tx.reverted` | metric (counter) | 0 tolerance | ≥ 1 = P0 |
| `notary.confirmations` | on-chain event | — | (audit-trail index) |

### 3.11 `@aethelred/wallet-integration` + `@aethelred/wallet-rpc-adapters`

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `rpc.call.latency{chain, method}` (p95) | metric | ≤ 200ms | p95 > 1s for 10 min |
| `rpc.call.error_rate{chain, code}` | metric | < 0.5% | > 2% for 10 min |
| `rpc.transport.failed` | metric (counter) | — | > 10/min = P1 |

### 3.12 Cross-cutting — audit + contracts

| Signal | Type | SLO | Alert threshold |
|--------|------|-----|-----------------|
| `audit.event.emit.latency` | metric | ≤ 5ms | p99 > 20ms = P2 |
| `audit.chain_link_mismatch` | metric (counter) | 0 / day | ≥ 1 = P2 ([runbook](../runbooks/audit-trail-gap.md)); ≥ 5 in 5min OR within active SOC-2/GDPR window = P1 |
| `audit.chain_integrity_broken` | metric (counter) | 0 / quarter | ≥ 1 = P1 (tamper signal — escalate to Security Lead per [runbook](../runbooks/audit-trail-gap.md) §5) |
| `merkle.batch.build.time` | metric | ≤ 100ms for 256-leaf batch | > 500ms |
| `contracts.gas.actual.{function}` | metric (gauge) | matches budget | > budget = P1 (regression; CI should have caught) |

## 4. SLO definitions — production targets

### 4.1 Customer-facing availability

| Service | SLO | Error budget |
|---------|-----|--------------|
| x402 facilitator | 99.9% | 43 min/mo |
| `/pay/:slug` surface | 99.9% | 43 min/mo |
| Paymaster-sponsor | 99.95% | 21 min/mo |
| Notarization scheduler | 99.5% | 3.6 hr/mo (background — user-invisible) |
| Chrome extension build | 99% | 7.2 hr/mo (deploy-time only) |

### 4.2 Latency

p99 targets for critical user-facing operations:

| Operation | Budget |
|-----------|-------:|
| Sign x402 payment (LocalKey adapter) | ≤ 100ms |
| Sign x402 payment (Nitro adapter) | ≤ 800ms |
| Resolve `/pay/:slug` + verify signatures | ≤ 300ms |
| Full intent-router execute (2 quotes) | ≤ 3s |
| Sponsor approval sign | ≤ 500ms |

### 4.3 Correctness — zero tolerance

The seven events that are NEVER expected and ALWAYS page P0:

1. x402 binding-hash mismatch
2. Custody-adapter signature-recovery mismatch
3. Shamir reconstruction failure
4. Intent-router nonce replay
5. Intent-router fill mismatch
6. Paymaster request-id reuse
7. Notary anchor tx reverted

Every one of these is covered by a unit/fuzz test in the current
test suite. If one fires in production, it is either a latent bug
that escaped CI OR evidence of active compromise.

## 5. Tool selection

**Recommended stack** for the Q3 2026 rollout:

### 5.1 Primary: Datadog + CloudWatch

- **Datadog** for metrics, logs (structured JSON), traces, and
  dashboards. Reasoning: single pane of glass, good APM for Node.js +
  Elixir, already widely used in fintech (audit familiarity).
  Estimated cost at modest scale: **$500–$2,000/month**.
- **CloudWatch** for AWS-native infrastructure metrics + VPC flow
  logs + Nitro enclave parent logs. Cost: **$50–$300/month** at our
  footprint.

### 5.2 Specialised additions

- **Honeycomb** for distributed tracing if Datadog APM cost scales
  unfavourably. Swappable behind an OTel abstraction. **$130/month starter.**
- **PagerDuty** for P0/P1 escalation routing. **$30/user/month.**
- **Statuspage** (Atlassian) for customer-facing status communication.
  **$79/month.**

### 5.3 Vendor-neutrality criteria

Every signal emission uses **OpenTelemetry** (OTel) at the SDK level.
Vendor is swappable; the instrumentation isn't. This is the single
most-important design constraint. Vendor lock-in on metrics/traces
is expensive; OTel portability keeps the switching cost low.

### 5.4 Alternatives we considered

| Stack | Ruled out because |
|-------|-------------------|
| Self-hosted Grafana + Prometheus + Loki + Tempo | Ops overhead, needs a reliability engineer we don't have yet |
| New Relic | More expensive than Datadog at our scale; no procurement advantage |
| Splunk | Enterprise-heavy; overkill for our size |
| Honeycomb alone (no metrics tool) | Traces are great but dashboards + alerting are weaker |

Deferred to re-evaluate at Series B: ClickHouse + Grafana for
cost-effective high-cardinality metrics if Datadog billing becomes
painful.

## 6. Alert taxonomy

Four priority levels:

| Priority | Definition | Response SLA |
|----------|-----------|--------------|
| **P0** | Revenue-affecting or data-integrity customer-facing outage | Page immediately; 15-min ack; target 1-hr resolution |
| **P1** | Degraded service with fallback active, OR correctness signal requiring investigation | Page during business hours; non-urgent off-hours; 4-hr ack |
| **P2** | Internal anomaly, no customer impact | Business-hours Slack; 1-business-day response |
| **P3** | Informational, dashboard only | Review weekly |

**No alerts without runbooks.** Every P0/P1 alert links to a
[`docs/runbooks/<alert-name>.md`](../runbooks/) entry. Where no
runbook exists, the alert cannot fire in production — it sits in a
staging lane until the runbook is written.

Runbook templates + **all seven zero-tolerance runbooks shipped**:
[`TEMPLATE_POSTMORTEM.md`](../runbooks/TEMPLATE_POSTMORTEM.md),
[`TEMPLATE_ONCALL_FIRST_HOUR.md`](../runbooks/TEMPLATE_ONCALL_FIRST_HOUR.md),
and one P0 runbook per event in §4.3:
[`x402-binding-hash-mismatch`](../runbooks/x402-binding-hash-mismatch.md),
[`custody-signature-recovery-mismatch`](../runbooks/custody-signature-recovery-mismatch.md),
[`shamir-reconstruction-failed`](../runbooks/shamir-reconstruction-failed.md),
[`intent-router-nonce-replay`](../runbooks/intent-router-nonce-replay.md),
[`intent-router-fill-mismatch`](../runbooks/intent-router-fill-mismatch.md),
[`paymaster-request-id-reuse`](../runbooks/paymaster-request-id-reuse.md),
[`notary-anchor-tx-reverted`](../runbooks/notary-anchor-tx-reverted.md).
Each follows a 7-section pattern (what this means → impact →
first-hour actions → hypothesis-driven resolution → escalation
criteria → post-incident → sharp edges). Phase 2 of the rollout
is unblocked on the runbook dimension.

## 7. Data retention + residency

| Signal type | Hot retention | Cold retention | Residency |
|-------------|--------------|----------------|-----------|
| Metrics (aggregated) | 13 months | n/a | EU-west (Dublin preferred; GDPR) |
| Logs (JSON) | 18 months | 7 years (S3 Glacier) | EU-west |
| Traces | 30 days | Sampled 1% → 90 days | EU-west |
| On-chain events | Indexed indefinitely in our store; permanent on-chain | — | Chain-agnostic (canonical on-chain source) |
| PII in logs | **MUST be redacted at emission** | never stored | — |

PII redaction: we never log raw KYC / address / VC subject
commitment data. Redaction enforced at the OTel SDK via a sampling
processor — test coverage required for every new emission point.

## 8. Incident response integration

Links out, doesn't duplicate:

- **Alert → page** — PagerDuty.
- **Ack → triage** — runbook-specific. Every P0 runbook begins with
  "can the customer be served via a fallback?"
- **Triage → resolution** — BCP.md per-scenario playbooks cover the
  known-known failures (RPC provider outage, enclave unavailability,
  chain halt). Unknown-unknowns escalate to on-call SME rotation.
- **Resolution → postmortem** — every P0/P1 requires a blameless
  post-incident review within 5 business days. Template:
  [`docs/runbooks/TEMPLATE_POSTMORTEM.md`](../runbooks/TEMPLATE_POSTMORTEM.md).
- **Postmortem → learnings** — action items tracked as GitHub issues
  labelled `postmortem-action`. Target: all actions closed within
  30 days.

## 9. SOC-2 Type 2 alignment

Per-TSC alignment of the observability stack:

| TSC | Evidence from observability |
|-----|------------------------------|
| CC2.2 (internal comms of policies) | MCP policy-gate denial metrics + reasons show policies operated |
| CC4.1/4.2 (monitoring) | Dashboards + alert firings + response times — the primary evidence |
| CC5.3 (policy enforcement) | Every gate denial metric proves the gate ran |
| CC7.1 (security monitoring) | Zero-tolerance-counter metrics + alert history |
| CC7.3 (incident detection) | Alert-to-ack-to-resolve time distributions |
| CC7.4 (incident response) | Runbook-fired → triaged → resolved flow |
| A1.1/1.2 (availability + monitoring) | SLO attainment per service over observation window |
| PI1.2 (input validation) | Structured logs of every validation failure |
| PI1.4 (output accuracy) | Merkle-root-mismatch + gas-budget-actual metrics |

The observation window: **90 days minimum** of green SLO data is the
Type 2 gate. Type 2 engagement starts after the Q3 2026 deployment
window + 90 days — realistic target Q4 2026 / Q1 2027.

## 10. Phased rollout

### Phase 1 (Q3 2026, weeks 1–3): foundation

- OTel SDK wired into every moat package.
- Datadog + CloudWatch accounts provisioned.
- Primary dashboards (one per package) built from the metric list
  above.
- P0/P1 alerts armed with initial runbook stubs.
- **Deliverable:** "something is wrong" gets paged within 5 min of
  symptom.

### Phase 2 (Q3 2026, weeks 4–6): depth

- Honeycomb tracing if APM cost warrants.
- PII-redaction processor certified via test suite.
- Per-tenant dashboards.
- Runbooks for every P0/P1 alert.
- **Deliverable:** every expected failure mode has a playbook.

### Phase 3 (Q3 2026, weeks 7–9): SLO mechanics

- Error-budget reporting automated.
- Customer-facing Statuspage wired.
- SLO burn-rate alerts (vs absolute-threshold alerts) tuned.
- **Deliverable:** customer-visible reliability commitments measurable
  against real data.

### Phase 4 (Q4 2026): Type 2 engagement

- 90-day observation window begins after Phase 3 ships.
- Type 2 engagement launches when window completes with ≥ 95% SLO
  attainment.

## 11. Cost envelope

**Year-1 target:** $1k–$4k/month at modest production scale
(~10 enterprise tenants, ~10 rps sustained, ~100 gb/mo logs).

**Cost drivers to watch:**

- Datadog custom metrics (explodes with high-cardinality tags).
  Mitigation: `tenantId` is fine but `txHash` or `intentId` would
  not be — use logs for those.
- Log ingest at scale. Mitigation: structured JSON + sampling on
  non-P0 paths.
- Traces at 100% sampling. Mitigation: 1-10% tail-sampling for
  non-error traces.

## 12. Explicit non-goals

- **Real-time on-chain watchtower.** Not building a block-scraping
  infrastructure. On-chain events are reconciled through the
  operator's RPC provider (or a dedicated indexing service like
  Alchemy / Ankr / Covalent).
- **Cost-optimised open-source stack from day one.** The time
  savings from a managed vendor in year 1 outweigh the licence fees.
  Re-evaluate at Series B.
- **Machine-learning anomaly detection.** Not in Phase 1. Human-curated
  SLOs + fixed-threshold alerts are enough for the first 90 days.
- **Multi-region observability replication.** Single-region is
  enough at our scale; revisit when we're multi-region.

## 13. Vendor RFP checklist

When soliciting proposals from Datadog / Honeycomb / New Relic or
integration partners, include:

- [ ] OTel-native ingest (no vendor-proprietary SDK lock-in).
- [ ] Data residency options (EU-west at minimum).
- [ ] PagerDuty integration (or equivalent).
- [ ] PII-redaction processors.
- [ ] Role-based access (auditor read-only view distinct from
  engineering write).
- [ ] SOC-2 Type 2 report available under NDA.
- [ ] Volume-discount bands (so growth doesn't cause cost surprises).
- [ ] 90-day free trial so we can exercise Phase 1 before committing.

## 14. Document ownership + cadence

- **Technical owner:** Ramesh Tamilselvan (<rameshtamilselvan@gmail.com>).
- **Review cadence:** At the end of each rollout phase + semi-annually
  once in production.
- **Next review:** Q3 2026 kickoff (Phase 1 scoping finalisation).
