# Aethelred Elixir ZeroID Team Plan

Date: 2026-04-11
Status: Local execution draft
Scope: ZeroID Elixir adoption track

## 1. Mission

Use Elixir to make ZeroID a workflow-driven identity operations platform without disturbing its cryptographic trust boundary.

The ZeroID Elixir team should own lifecycle orchestration, review queues, notifications, and audit fan-out.

It should not own the cryptographic core.

## 2. Why ZeroID Is A Selective Fit

ZeroID already exposes lifecycle seams through:

- credential routes in `dApps/zeroid/backend/src/routes/credentials.ts`
- verification routes in `dApps/zeroid/backend/src/routes/verification.ts`
- credential signing and rotation in `dApps/zeroid/backend/src/services/credential.ts`
- TEE and proof services in `dApps/zeroid/backend/src/services/tee.ts` and `dApps/zeroid/backend/src/services/zkproof.ts`

This means ZeroID has real process flow, but its trust-sensitive internals already belong elsewhere.

## 3. What Elixir Should Own

Build now:

- credential issuance workflow
- revocation and status-change fan-out
- review queues for exceptions and operator actions
- verification request tracking
- live admin and audit event channels

Candidate Elixir services:

- `zeroid_credential_workflows`
- `zeroid_review_queue`
- `zeroid_notifications`
- `zeroid_audit_ingest`
- `zeroid_admin_realtime`

## 4. What Stays In The Existing Stack

Do not move:

- KMS signing and key rotation
- TEE services
- ZK proof generation and verification logic
- credential proof formats
- identity semantics and trust-boundary validation

The ZeroID Elixir team should orchestrate around these systems, not replace them.

## 5. Immediate Build Plan

### Track 1: Event Contract

Define and instrument these initial events:

- `credential.issue_requested`
- `credential.issued`
- `credential.revocation_requested`
- `credential.revoked`
- `credential.verified`
- `verification.zk_proof_generated`
- `verification.zk_proof_verified`
- `verification.tee_completed`
- `identity.review_required`
- `identity.exception_detected`

### Track 2: Workflow State

Build lifecycle workflows for:

- credential issuance
- credential revocation
- verification handling
- exception review and operator escalation

### Track 3: Review Queues

Create queues for:

- issuance exceptions
- revocation exceptions
- verification anomalies
- operator-led manual review

### Track 4: Audit And Live Admin

Provide:

- replayable audit timeline
- live operator queue visibility
- status channels for credential and verification state

## 6. Weeks 1-6

### Week 1

- define ZeroID event schema
- identify emission points in credential and verification routes
- define workflow command API

### Week 2

- stand up ZeroID Elixir workflow service
- ingest issuance and verification events
- persist workflow transitions

### Week 3

- implement review queue for issuance and verification exceptions
- add notification fan-out and escalation timers

### Week 4

- add live admin channels and case visibility
- expose case assignment and queue state

### Week 5

- add revocation propagation and audit replay support
- connect lifecycle state to operator tooling

### Week 6

- run end-to-end pilot:
  `credential requested -> issued -> verified or exception queue -> revoke -> fan-out`

## 7. Team Boundary Rules

The ZeroID Elixir team owns:

- lifecycle orchestration
- case queues
- notifications
- audit and live admin channels

The ZeroID core team keeps ownership of:

- credential cryptography
- proof logic
- TEE integration
- trust-sensitive identity validation

## 8. Deliverables

The first meaningful delivery is complete only if:

- credential lifecycle is externally visible as workflow state
- exceptions no longer disappear into backend logs
- operators can see and manage pending identity cases
- revocation and verification changes propagate reliably

## 9. Do Not Do

- do not rebuild proof generation in Elixir
- do not move KMS-backed signing
- do not blur the trust boundary between orchestration and credential issuance
