# Aethelred Elixir Shiora Team Plan

Date: 2026-04-11
Status: Local execution draft
Scope: Shiora Elixir adoption discovery track

## 1. Mission

Prepare Shiora for possible future Elixir adoption without forcing a premature runtime expansion.

This team should not start by building a large standalone Elixir backend.

It should prove whether Shiora truly needs workflow-heavy and operations-heavy infrastructure first.

## 2. Why Shiora Is Different

Shiora is currently still app-route and frontend heavy:

- API routes under `dApps/shiora/src/app/api`
- notification hook in `dApps/shiora/src/hooks/useNotifications.ts`
- shared fetch client in `dApps/shiora/src/lib/api/client.ts`

There are many product surfaces such as:

- alerts
- compliance
- consent
- emergency
- records
- insights
- chat

But that does not automatically mean Shiora should adopt Elixir now.

The right first step is instrumentation and workflow discovery.

## 3. What This Team Should Own Now

Build now:

- event taxonomy for Shiora operational flows
- outbox and event emission design
- notification and alert lifecycle mapping
- workflow candidate discovery
- thin prototype for live alerts if needed

Candidate future Elixir services if justified later:

- `shiora_alerts`
- `shiora_review_queue`
- `shiora_notifications`
- `shiora_ops_realtime`

## 4. What Stays In The Existing Stack

Keep in the current stack:

- Next.js app routes
- UI hooks and contexts
- current client API module
- product behavior and page flows
- health-specific application semantics

The Shiora team should not attempt a backend rewrite without clear operational evidence.

## 5. Immediate Build Plan

### Track 1: Event Discovery

Define and instrument candidate events:

- `alert.created`
- `alert.acknowledged`
- `compliance.review_requested`
- `consent.updated`
- `emergency.triggered`
- `record.access_requested`
- `record.access_granted`
- `clinical.insight_generated`

### Track 2: Workflow Candidate Mapping

Determine which of these are truly workflow-heavy:

- care escalation
- compliance review
- consent exception handling
- emergency routing
- records access review

### Track 3: Notification Model

Replace purely local assumptions with a server-driven notification model that can later connect to Elixir if needed.

### Track 4: Thin Prototype

Only if justified, build a small live-alert prototype:

- alert ingestion
- live operator channel
- acknowledgement state

## 6. Weeks 1-6

### Week 1

- inventory current API routes and alert surfaces
- define event schema and outbox shape

### Week 2

- add event emission to alerts, compliance, emergency, and consent routes
- define metrics for operational load and queue need

### Week 3

- build server-backed alert persistence model
- define acknowledgement and severity states

### Week 4

- evaluate whether live operator channels are genuinely needed
- if yes, prototype a narrow live-alert bridge

### Week 5

- identify top two workflow candidates for future Elixir adoption
- document exact latency, reliability, and review needs

### Week 6

- present decision:
  `stay on current stack`, `add thin Elixir alert service`, or `graduate to workflow adoption`

## 7. Team Boundary Rules

The Shiora team owns now:

- discovery
- event instrumentation
- alert model definition
- workflow qualification

The Shiora product team keeps ownership of:

- all current app flows
- health and compliance semantics
- product UI and route behavior

## 8. Deliverables

The first meaningful delivery is complete only if:

- Shiora has a structured event model
- alert and workflow candidates are measured instead of guessed
- the team can justify whether Elixir is warranted

## 9. Do Not Do

- do not build a large Elixir backend immediately
- do not rewrite the API routes just to match other teams
- do not force a platform decision without measured workflow evidence
