# Shiora Event Taxonomy — Discovery Phase

Status: Discovery only. No Elixir runtime services.
Date: 2026-04-11

## Candidate Events (8)

| Event | Source Route | Current Implementation | Operational Weight |
|-------|-------------|----------------------|-------------------|
| alert.created | /api/alerts | In-memory state | Medium — frequent, latency-sensitive |
| alert.acknowledged | /api/alerts | In-memory state | Low — operator action |
| compliance.check_triggered | /api/compliance | Sync API call | Medium — regulatory |
| consent.updated | /api/consent | Database write | Low — infrequent |
| emergency.escalated | /api/emergency | Push notification | High — time-critical |
| records.access_requested | /api/records | Audit log write | Medium — compliance |
| care.escalation_triggered | /api/clinical | In-memory + notification | High — patient safety |
| clinical.insight_generated | /api/insights | Async computation | Low — background |

## Event Schema Definitions

All schemas defined in `ae_event_contracts/lib/ae_event_contracts/schemas/shiora.ex`.
These are for taxonomy completeness and contract testing — no runtime consumers exist.

## Workflow Candidate Assessment

### Strong Candidates (genuinely workflow-heavy)
1. **Care Escalation** — Multi-step: detect trigger -> notify care team -> track acknowledgement -> escalate if unacknowledged -> resolve. Has real timeout/escalation semantics.
2. **Compliance Review** — Multi-step: trigger check -> evaluate -> flag issues -> assign reviewer -> resolve. Has queue and assignment semantics.

### Moderate Candidates (could benefit from durable state)
3. **Emergency Routing** — Time-critical escalation chain. Currently relies on push notifications which can fail silently. Durable state would improve reliability.
4. **Records Access Review** — Has approval semantics (request -> review -> grant/deny). Could reuse approval_router.

### Weak Candidates (current implementation sufficient)
5. **Alerts** — Simple create/acknowledge lifecycle. In-memory state is acceptable unless volume or reliability requirements change.
6. **Consent Updates** — Stateless operations. No workflow needed.
7. **Clinical Insights** — Background async computation. No operator interaction.

## Notification Model Design

Current: Local assumptions with client-side notification hooks.
Proposed: Server-driven notification model with:
- Notification intents emitted as events
- notification_hub routes to correct channel (push, email, in-app)
- Delivery tracking and retry
- Priority routing for emergency/care escalation

This model would allow future Elixir connection without changing product code —
existing API routes would emit notification intents that the hub consumes.

## Metrics to Collect (Weeks 1-5)

- Alert creation rate (per hour)
- Average time-to-acknowledge for alerts
- Compliance check failure rate and time-to-resolution
- Emergency escalation frequency and response time
- Records access request volume and approval latency
- Care escalation frequency and outcome tracking

## Week 6 Decision Framework

Three options:

### Option A: Stay on Current Stack
Choose if: Alert volume < 100/hour, no reliability incidents, no operator queue need.
Effort: Zero. Continue with current Next.js API routes.

### Option B: Add Thin Elixir Alert Service
Choose if: Alert volume > 100/hour OR reliability issues with in-memory state OR operators need queue visibility.
Scope: Single `shiora_alerts` app consuming alert events, providing durable state and one live channel.
Effort: ~1 week using existing shared platform modules.

### Option C: Graduate to Workflow Adoption
Choose if: Care escalation and compliance review have measured latency/reliability problems AND operator review queues are genuinely needed.
Scope: 4-5 apps mirroring the ZeroID pattern (workflows, review_queue, notifications, ops_realtime, audit_ingest).
Effort: ~3 weeks using existing shared platform patterns.
