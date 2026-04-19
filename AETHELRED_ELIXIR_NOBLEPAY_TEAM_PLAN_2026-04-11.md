# Aethelred Elixir NoblePay Team Plan

Date: 2026-04-11
Status: Local execution draft
Scope: NoblePay Elixir adoption track

## 1. Mission

Use Elixir to make NoblePay the first production-grade workflow and operations platform in the Aethelred ecosystem.

The NoblePay Elixir team should not rebuild the app.

The team should build the workflow, case-management, notification, and real-time operations layer around the existing NoblePay services.

## 2. Why NoblePay Goes First

NoblePay already has the strongest fit for Elixir:

- payment lifecycle complexity
- compliance and review queues
- treasury and liquidity operations
- streaming and operator updates
- cross-border and cross-chain workflow orchestration

Current NoblePay backend seams already support this:

- `dApps/noblepay/backend/src/services/payment.ts`
- `dApps/noblepay/backend/src/services/compliance.ts`
- `dApps/noblepay/backend/src/services/audit.ts`
- `dApps/noblepay/backend/src/services/treasury.ts`
- `dApps/noblepay/backend/src/services/streaming.ts`
- `dApps/noblepay/backend/src/services/websocket.ts`

## 3. What Elixir Should Own

Build now:

- payment workflow orchestration
- compliance case queues
- approval and escalation routing
- real-time operator and treasury channels
- audit event ingestion and fan-out
- notification delivery and retry logic

Candidate Elixir services:

- `noblepay_workflows`
- `noblepay_case_queue`
- `noblepay_ops_realtime`
- `noblepay_notifications`
- `noblepay_audit_ingest`

## 4. What Stays In The Existing Stack

Do not move:

- Next.js frontend
- TypeScript REST API surface
- Go gateway
- Rust compliance engine internals
- payment domain rules already implemented in product-owned services

The NoblePay Elixir team should wrap and orchestrate existing services, not replace them blindly.

## 5. Immediate Build Plan

### Track 1: Event Contract

Define and instrument the initial NoblePay event set:

- `payment.created`
- `payment.screening_requested`
- `payment.screening_completed`
- `payment.flagged`
- `payment.approved`
- `payment.rejected`
- `payment.cancelled`
- `treasury.action_requested`
- `treasury.threshold_breached`
- `liquidity.update_detected`
- `crosschain.transfer_state_changed`
- `invoice.created`

### Track 2: Workflow Engine

Implement workflow state machines for:

- payment intake to screening
- screening to approval or rejection
- flagged payment to human review
- treasury action to review and notify
- cross-border settlement exception handling

### Track 3: Operator Queue

Implement case queues for:

- compliance review
- treasury review
- liquidity incidents
- payment exceptions

### Track 4: Real-Time Control Surface

Expose live channels for:

- compliance queue status
- payment status changes
- urgent alerts
- treasury and liquidity changes

## 6. Weeks 1-6

### Week 1

- lock event schema
- identify emission points in existing TypeScript services
- define command API between NoblePay backend and Elixir workflows

### Week 2

- stand up NoblePay Elixir service skeleton
- implement ingest of payment and compliance events
- persist workflow state

### Week 3

- build compliance case queue and review assignment model
- add escalation timers and retry-safe notifications

### Week 4

- build real-time operator channels
- connect flagged and approved payment updates to live dashboards

### Week 5

- integrate treasury workflow events
- add liquidity and cross-border exception routing

### Week 6

- run end-to-end pilot:
  `payment created -> screening -> review or approve -> notify -> audit evidence`

## 7. Team Boundary Rules

The NoblePay Elixir team owns:

- orchestration
- case routing
- notification reliability
- live operator channels
- workflow telemetry

The NoblePay product team keeps ownership of:

- payment semantics
- compliance decision policy
- treasury business rules
- user-facing product behavior

## 8. Deliverables

The first meaningful delivery is complete only if:

- the payment lifecycle can be tracked in Elixir state
- flagged payments enter a real review queue
- notifications are durable and retry-safe
- live ops channels update without polling-only hacks
- audit events can be replayed into a coherent case timeline

## 9. Do Not Do

- do not rewrite the NoblePay API first
- do not replace the Go gateway
- do not duplicate compliance logic in two places
- do not make Elixir the owner of every NoblePay backend concern
