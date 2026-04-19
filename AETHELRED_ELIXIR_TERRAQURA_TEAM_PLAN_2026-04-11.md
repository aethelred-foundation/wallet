# Aethelred Elixir TerraQura Team Plan

Date: 2026-04-11
Status: Local execution draft
Scope: TerraQura Elixir adoption track

## 1. Mission

Use Elixir to turn TerraQura into a workflow-governed verification and asset-operations platform.

The TerraQura Elixir team should own orchestration and operator-facing process control.

It should not replace the chain-facing or verification-sensitive cores.

## 2. Why TerraQura Is A Strong Fit

TerraQura already has explicit async workflow seams:

- BullMQ queue package in `dApps/terraqura/packages/queue/src/queues.ts`
- verification processor in `dApps/terraqura/apps/worker/src/processors/verification.processor.ts`
- minting processor in `dApps/terraqura/apps/worker/src/processors/minting.processor.ts`
- separate indexer and verifier runtimes

This is already a decomposed platform.

Elixir is best used to make the orchestration more durable, observable, and operator-friendly.

## 3. What Elixir Should Own

Build now:

- verification workflow orchestration
- mint-readiness workflow state
- KYC and sanctions case routing
- notification and alert routing
- real-time operations dashboards
- event ingestion for asset lifecycle tracking

Candidate Elixir services:

- `terraqura_verification_workflows`
- `terraqura_ops_realtime`
- `terraqura_notifications`
- `terraqura_review_queue`
- `terraqura_event_ingest`

## 4. What Stays In The Existing Stack

Do not move:

- Go indexer
- Rust verifier
- Python analytics
- on-chain mint execution logic
- product-specific carbon accounting rules

The TerraQura Elixir team coordinates those systems.

It should not subsume them.

## 5. Immediate Build Plan

### Track 1: Event Contract

Define and instrument these initial events:

- `verification.batch_submitted`
- `verification.source_completed`
- `verification.logic_completed`
- `verification.failed`
- `verification.ready_for_mint`
- `mint.requested`
- `mint.succeeded`
- `mint.failed`
- `kyc.requested`
- `kyc.completed`
- `sensor_batch.received`
- `sensor_batch.anomaly_detected`
- `notification.requested`

### Track 2: Workflow State Machine

Build workflow state for:

- source check
- logic check
- mint readiness
- mint completion
- remediation and manual review

### Track 3: Review Queues

Create operator queues for:

- failed verification review
- anomaly review
- compliance review
- mint exception handling

### Track 4: Real-Time Operations

Provide live channels for:

- verification progress
- minting outcomes
- queue depth and stuck-work alerts
- anomaly and compliance notifications

## 6. Weeks 1-6

### Week 1

- lock TerraQura event taxonomy
- define command and event boundary between worker package and Elixir
- map current BullMQ jobs to future workflow states

### Week 2

- stand up TerraQura Elixir workflow service
- consume verification and mint events
- persist workflow state transitions

### Week 3

- build verification review queue
- add escalation and retry policies for failed steps

### Week 4

- add real-time operator channels and queue visibility
- expose remediation and rerun controls

### Week 5

- wire KYC and sanctions workflow hooks
- connect notification fan-out

### Week 6

- run end-to-end pilot:
  `verification batch -> source -> logic -> mint ready -> mint success or exception queue`

## 7. Team Boundary Rules

The TerraQura Elixir team owns:

- orchestration
- review queues
- retries and escalations
- live operator channels
- workflow telemetry

The TerraQura product teams keep ownership of:

- core verification logic
- indexer behavior
- mint transaction code
- carbon asset business semantics

## 8. Deliverables

The first meaningful delivery is complete only if:

- TerraQura workflow state is visible outside BullMQ internals
- failed verification and minting paths enter explicit operator queues
- queue and alert status are visible live
- operator remediation does not require ad hoc scripts

## 9. Do Not Do

- do not rewrite indexer or verifier logic in Elixir
- do not move mint transaction execution first
- do not let the Elixir layer become the home for carbon business logic
