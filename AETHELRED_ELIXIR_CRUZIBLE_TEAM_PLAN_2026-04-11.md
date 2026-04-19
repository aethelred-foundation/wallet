# Aethelred Elixir Cruzible Team Plan

Date: 2026-04-11
Status: Local execution draft
Scope: Cruzible Elixir adoption track

## 1. Mission

Use Elixir to strengthen Cruzible operations, anomaly handling, and live monitoring without turning Cruzible into a workflow-heavy rewrite project.

This team should focus on reliability and operator tooling.

It should not try to migrate the whole backend.

## 2. Why Cruzible Is A Selective Fit

Cruzible has useful Elixir seams, but fewer than NoblePay or TerraQura.

The strongest current seams are:

- reconciliation engine in `dApps/cruzible/backend/api/src/services/ReconciliationScheduler.ts`
- alerting in `dApps/cruzible/backend/api/src/services/AlertService.ts`
- job and queue visibility in `dApps/cruzible/backend/api/src/services/JobsService.ts`
- websocket and route surfaces under `dApps/cruzible/backend/api/src/routes/v1`

The best Elixir leverage is on monitoring, alerts, reviewer operations, and incident workflows.

## 3. What Elixir Should Own

Build now:

- reconciliation event ingestion
- alert persistence and deduplication
- operator notification fan-out
- live ops channels
- anomaly and incident workflow state

Candidate Elixir services:

- `cruzible_reconciliation_ops`
- `cruzible_alerts`
- `cruzible_ops_realtime`
- `cruzible_incident_queue`

## 4. What Stays In The Existing Stack

Do not move:

- blockchain reads
- protocol SDK usage
- indexer-facing data access
- core jobs data model
- product-specific vault and staking semantics

The Cruzible Elixir team supports operations around the protocol.

It should not replace protocol-facing business logic.

## 5. Immediate Build Plan

### Track 1: Event Contract

Define and instrument these initial events:

- `reconciliation.tick_started`
- `reconciliation.tick_completed`
- `reconciliation.drift_detected`
- `validator.threshold_breached`
- `tvl.anomaly_detected`
- `exchange_rate.drift_detected`
- `stablecoin.circuit_breaker_triggered`
- `incident.created`
- `incident.resolved`

### Track 2: Alert Platform

Replace in-memory alert history with durable Elixir-owned alert tracking:

- deduplication
- severity routing
- rate limiting
- escalation timers
- operator delivery

### Track 3: Real-Time Operations

Provide live channels for:

- active incidents
- reconciliation failures
- validator and stablecoin warnings
- critical protocol alerts

### Track 4: Incident Workflow

Build incident state for:

- open
- acknowledged
- escalated
- mitigated
- resolved

## 6. Weeks 1-6

### Week 1

- lock Cruzible event taxonomy
- identify reconciliation and alert emission points
- define alert API boundary between TypeScript backend and Elixir

### Week 2

- stand up Cruzible Elixir alert service
- ingest reconciliation and anomaly events
- persist alert and incident state

### Week 3

- implement alert deduplication and escalation
- add critical-incident workflow state

### Week 4

- add real-time ops channels
- expose dashboard-friendly active incident feed

### Week 5

- integrate stablecoin and validator anomaly streams
- wire notification fan-out

### Week 6

- run end-to-end pilot:
  `reconciliation drift -> alert -> incident -> notify -> resolve`

## 7. Team Boundary Rules

The Cruzible Elixir team owns:

- operations alerts
- incident workflows
- live operator channels
- durable alert history

The Cruzible core team keeps ownership of:

- protocol and vault logic
- job semantics
- on-chain and indexed state interpretation

## 8. Deliverables

The first meaningful delivery is complete only if:

- alerts survive process restarts
- reconciliation anomalies become durable incidents
- operators can see live incident state
- critical conditions no longer depend on in-memory backend state

## 9. Do Not Do

- do not rewrite the API gateway
- do not turn Cruzible into a full workflow platform without evidence
- do not move chain or vault business logic into Elixir
