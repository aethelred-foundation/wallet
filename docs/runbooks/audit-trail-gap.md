# P2: `audit.chain_link_mismatch ≥ 1` (audit-trail gap)

> **Alert class:** Audit-pipeline integrity / observability completeness
> **Severity:** P2 (paginate during business hours; **escalate to P1
> if `chain_integrity_broken ≥ 1` OR `chain_link_mismatch ≥ 5` in any
> 5-min window OR any gap is observed within an active SOC-2 audit
> evidence window**)
> **Class:** Audit append + persistence pipeline
> **Packages affected:** `@aethelred/wallet-audit`,
> `@aethelred/wallet-observability` (metric pipeline),
> downstream consumers of `EvidenceRecord` /
> `AuditCapture.verifyChain`
> **Last validated:** 2026-04-29

## 1. What this alert means

`AuditCapture.verifyChain(events)` ran across an event sequence
and returned `false`. One of two integrity properties failed:

1. **`chain_integrity_broken`** — an event's stored `eventHash`
   did not match the SHA-256 recomputed from its other fields.
   Indicates the event was modified after capture (tamper) OR
   a serialization bug corrupted it on persist/load.

2. **`chain_link_mismatch`** ("audit-trail gap") — `event[n].previousHash`
   did NOT equal `event[n-1].eventHash`. Indicates one of:
   - An event was lost between capture and persist (storage write
     dropped silently)
   - An event was deleted out-of-band from storage after persist
   - A FIFO eviction occurred without inserting the synthetic
     marker that preserves chain continuity
   - Two `AuditCapture` instances raced and produced conflicting
     sequence numbers

Unlike the seven zero-tolerance P0 runbooks, **a single audit-trail
gap is NOT a correctness violation of the moat itself** — the moat's
on-chain contracts and intent-router state machine are independent
of audit chain validity. The gap is a *blind spot in the evidence
record*; the system continues to operate correctly while ops
investigates.

A gap escalates to P1 the moment it threatens evidence available
to an external auditor — see §5.

## 2. Impact

- **The specific evidence record is rejected.** `EvidenceRecord.chainValid`
  returns `false` for any range that includes the gap. Downstream
  consumers (export packages, regulator submissions, agent receipt
  views) get a payload with `chainValid: false` — they may surface
  this as a warning to the user, refuse to render, or block the
  export entirely depending on configuration.
- **Existing fulfilled intents are NOT invalidated.** The intent-
  router's settlement decisions don't depend on audit chain
  validity. Money already moved correctly; the audit record has a
  hole, but the on-chain state is correct.
- **New events still capture and persist.** `AuditCapture.append`
  doesn't read the chain to write — gaps don't cascade into
  future events. The chain self-heals from the next valid link
  forward.
- **Merkle batches MAY be affected.** If the gap fell within an
  in-progress Merkle batch (`MerkleBatch.add` was called for the
  affected events), the batch root won't match expected on
  notarization. `merkle.batch.build.time` may also spike if the
  batch logic retries assembly across a now-inconsistent input set.
- **Regulator-clock implications.** Per `INCIDENT_RESPONSE.md` §6,
  an audit chain gap that prevents reconstruction of a specific
  user's session WITHIN AN ACTIVE GDPR/CCPA request window is a
  separate notification trigger. See §5.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the audit-pipeline dashboard (Grafana →
   Audit / Compliance row).
3. From the alert context pull:
   - `error_code` (`audit.chain_link_mismatch` vs
     `audit.chain_integrity_broken`)
   - `subject_id` / `workspace_id` of the affected chain
   - `sequence_range` — the [start, end] of the broken segment
   - `failed_event_id` — the specific event whose hash check failed
   - `host` / `process_id` — which `AuditCapture` instance
     surfaced the gap

### 3.2 Minute 2–5: classify

The runbook's first decision: **was the gap detected on read or
captured live?**

- **On read** (most common): an export, evidence builder, or
  background verifier called `verifyChain` and got `false`. The
  gap predates the alert by an unknown amount of time; data may
  already have been observed in the broken state by external
  parties.
- **Live** (rarer): the `audit.chain_link_mismatch` counter
  incremented from a check inside the append path itself — means
  a write attempt is being rejected RIGHT NOW. Stop the workspace's
  audit ingest immediately to prevent further drift:

  ```bash
  ops:audit ingest-pause --workspace-id=<id> \
                         --reason="chain link mismatch detected at append"
  ```

If the alert fires at `chain_integrity_broken` instead of
`chain_link_mismatch` — the hash itself is wrong, which is a
**stronger** signal (an event was modified, not just lost).
**Escalate to P1** before continuing — see §5.

### 3.3 Minute 5–15: triage

Pull the broken segment in raw form:

```bash
# Extract the sequence range — DO NOT modify, just read
node -e '
const { AuditStore } = require("@aethelred/wallet-audit");
const store = new AuditStore({ /* operator-supplied storage adapter */ });
store.initialize().then(() => {
  const events = store.query({
    workspaceId: process.env.WORKSPACE_ID,
    fromSequence: process.env.SEQ_START - 5,
    toSequence: process.env.SEQ_END + 5,
  });
  console.log(JSON.stringify(events, null, 2));
});
' WORKSPACE_ID=<id> SEQ_START=<n> SEQ_END=<m> | tee /tmp/audit-gap-events.json
```

Expand the range by ±5 events on each side — the surrounding
events tell you whether the gap is "missing rows entirely" vs
"hash drift starting at sequence N."

For each event in the broken segment, recompute the expected hash
locally:

```bash
# Verify which side of the gap is correct
node -e '
const { AuditCapture } = require("@aethelred/wallet-audit");
const events = require("/tmp/audit-gap-events.json");
console.log("chain valid:", AuditCapture.verifyChain(events));
' 
```

The recomputation tells you exactly which event is the first to
fail — that's `event[gapStart]`. Examine its `previousHash` vs the
preceding event's `eventHash` and decide which hypothesis matches.

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — silent storage write loss.** A persist call
returned success but the storage backend lost the event. Pattern:

- `event[n-1].eventHash` valid; `event[n+1]` exists and its
  `previousHash` matches a hash that's NOT `event[n-1].eventHash`
  (it matches `event[n].eventHash`, but `event[n]` itself is
  absent in storage).
- Sequence numbers have a HOLE: events go `n-1`, `n+1`, `n+2`…
- Application logs (NOT audit logs) show `event[n]` was emitted
  successfully — the loss is between `AuditCapture.append`'s
  return and the next read.

  ```bash
  dd logs query "service:audit subject:<id> sequenceNumber:<n>" --from=24h
  ```

This is the most common gap class. Storage backends with
write-behind caches (IndexedDB pre-flush, SQLite WAL with a
`fsync` regression) drop events in flight under power loss /
process crash.

**Hypothesis B — out-of-band deletion.** A row was removed from
storage after it was persisted, by a tool other than
`AuditCapture`. Pattern:

- Sequence numbers AND chain hashes both indicate exactly one
  event missing.
- Storage backend's own audit log (if it has one — Postgres WAL,
  S3 versioning, IndexedDB doesn't) records a DELETE on that key
  outside the wallet's process.

  ```bash
  # Postgres-backed audit storage
  SELECT * FROM audit_events_audit_log
  WHERE event_id = '<failed_event_id>'
    AND op = 'DELETE'
  ORDER BY ts DESC LIMIT 5;
  ```

This is severe — implies an actor with storage-level write access
removed evidence. **Escalate to Security Lead immediately.**

**Hypothesis C — racing AuditCapture instances.** Two processes
both calling `AuditCapture.append` against the same workspace
without coordinated sequence assignment. Pattern:

- Two events with the SAME `sequenceNumber` exist (or did exist
  pre-deduplication).
- `previousHash` values diverge — a fork in the chain rather than
  a hole.
- Application logs show overlapping `process_id` /
  `instance_id` for the affected workspace within a millisecond
  window.

```bash
# Look for duplicate sequence numbers
jq '[.[] | select(.workspaceId == "<id>") | .sequenceNumber] | group_by(.) | map(select(length > 1))' \
  /tmp/audit-gap-events.json
```

Resolution requires picking one branch as canonical and discarding
the other (post-mortem evidence loss for the discarded branch).

**Hypothesis D — eviction without marker.** FIFO eviction occurred
but the synthetic eviction marker (see `event-store.ts:128`) was
NOT inserted. Pattern:

- Sequence numbers jump (`maxEvents` worth) without an
  `eviction: true` detail field on the event at the boundary.
- Event count at the gap boundary equals
  `EventCaptureConfig.maxEvents`.

This is a code bug in the eviction path. The event-store invariant
"FIFO eviction inserts a marker" is regression-tested
(`audit-event-store.test.ts` covers it) but a config path that
bypasses `event-store` (e.g., direct Map clears in a test fake
leaking into prod) could trigger it.

**Hypothesis E — schema drift across deploy.** Events captured
under schema version A, hash recomputed by code at schema version
B. Pattern:

- `chain_integrity_broken` (NOT link mismatch — the hashes
  themselves are off).
- All events captured BEFORE a specific deploy timestamp fail
  hash check; events after pass.
- The `hashInput` join order in `verifyChain` (currently:
  sequence | timestamp | kind | detail | previousHash) was
  changed in the deploy.

  ```bash
  git log --all -p packages/audit/src/event-capture.ts \
    | grep -E '^(diff|hashInput|join)' | head -20
  ```

Resolution: revert the schema change OR ship a one-shot migration
that recomputes pre-deploy hashes under the new schema with a
documented audit-trail fork point.

## 4. Resolution paths

### Hypothesis A: silent storage write loss

1. **Acknowledge unrecoverable.** The lost event's content is
   gone unless application logs preserved enough detail to
   reconstruct it. Check both:
   ```bash
   dd logs query "service:audit subject:<id> sequenceNumber:<n>" --from=24h
   dd logs query "service:* intentId:<id>" --from=24h --format=json | jq '.[] | select(.audit_event_emitted == true)'
   ```
2. **Insert a documented gap marker.** A synthetic event
   acknowledging the loss preserves chain continuity going forward
   — operators MUST NOT splice in a fabricated reconstruction even
   if they have the data, because that breaks the cryptographic
   property that audit content was attested at the time of capture.
   ```bash
   ops:audit insert-gap-marker --workspace-id=<id> \
                               --sequence-start=<n> \
                               --sequence-end=<n> \
                               --reason="storage-write-loss <ts>"
   ```
   The marker's `eventHash` is a SHA-256 of its declared content;
   subsequent events chain off the marker normally.
3. **Fix the storage backend.** Audit which backend dropped the
   write. For IndexedDB-backed storage, this usually means
   tightening the `transaction.oncomplete` ack semantics; for
   server-backed Postgres, ensure `synchronous_commit = on`.
4. **Validate.** Run the background verifier across the affected
   range:
   ```bash
   ops:audit verify --workspace-id=<id> --since-sequence=<n-1>
   ```

### Hypothesis B: out-of-band deletion

1. **Treat as security incident.** Page Security Lead via the
   mandatory escalation in §5.
2. Lock storage backend writes for the affected workspace.
3. Identify the actor — storage-level audit logs, IAM history,
   physical-access logs depending on backend.
4. **Preserve forensic state.** Snapshot the storage backend
   (LVM snapshot, S3 versioned-object enumeration) BEFORE any
   recovery action overwrites evidence about the deletion itself.
5. Reconstruction via the gap marker pattern from Hypothesis A
   ONLY after Security Lead has cleared the snapshot for analysis.

### Hypothesis C: racing AuditCapture instances

1. **Pick the canonical branch.** Usually the one with the
   highest event-count tail OR the branch whose final event
   joined to a known-good downstream record (e.g., a settlement
   tx hash that exists on-chain).
2. **Discard the other branch.** Affected events become
   reconstructable only via app logs:
   ```bash
   dd logs query "service:audit workspaceId:<id>" --from=<gap_ts>-1h --to=<gap_ts>+1h
   ```
3. **Fix the coordination bug.** Two `AuditCapture` instances
   for one workspace is a deploy bug — only ONE writer per
   subject is correct. The intent-router's session-scoping
   should have prevented this; audit how it was bypassed.
4. Insert a single gap marker spanning the discarded branch's
   sequence range.

### Hypothesis D: eviction without marker

1. **Reproduce in staging.** The buffer-full + eviction path
   should now land an `eviction: true` marker; if it doesn't,
   the regression is in the deployed code.
2. **Patch the eviction logic** to match `event-store.ts:128`
   shape exactly. Add a test case that asserts the marker is
   present immediately after `maxEvents + 1` appends.
3. **Reconstruct chain validity** via a one-shot ops job that
   inserts retroactive markers at every gap caused by this bug.

### Hypothesis E: schema drift across deploy

1. **Revert the schema change** if recent — re-run the verifier
   to confirm hashes match. Document the failed migration.
2. **Or roll forward** with a documented migration job that
   inserts a one-time `schema-fork` event at the deploy boundary,
   recomputes downstream hashes under the new schema, and stamps
   all pre-deploy events as `chainValid: schema_version_a`.
3. Fix the missing migration in CI: any change to
   `event-capture.ts:hashInput` must trigger a schema-version
   bump.

## 5. Escalation criteria

**Escalate to P1** (page primary on-call directly, even outside
business hours) if any of:

- `chain_integrity_broken` fired (NOT just link mismatch).
  Implies tamper.
- ≥ 5 chain link mismatches in any 5-minute window. Implies a
  systemic issue, not a one-off storage flake.
- Any gap occurs within an active GDPR / CCPA / SOC-2 evidence
  window for the affected subject. Notification clocks have
  already started (72-hour GDPR window from "became aware").
- Out-of-band deletion (Hypothesis B). Always P1 — this is
  always a security incident.

**Escalate to Security Lead** (in addition to P1) if:

- Hypothesis B or any pattern resembling it.
- Multiple workspaces affected concurrently — implies a
  cross-tenant infrastructure compromise.
- The loss involves events with `kind: "signing-executed"`,
  `kind: "session-revoked"`, or
  `kind: "credential-verification-failed"` — these are
  forensically critical.

## 6. Post-incident

- [ ] Did `verifyChain` testing cover the actual failure mode?
  Add a regression test for the specific hypothesis you confirmed.
- [ ] Storage backend SLA: does it match the audit-pipeline's
  durability requirements? Ops MUST NOT use a backend with
  best-effort durability (Redis without RDB+AOF, ephemeral
  IndexedDB, etc.) for production audit storage.
- [ ] Background verifier coverage: should run hourly minimum
  across all subjects. Confirm the cron is healthy and the
  verifier covers the entire stored range, not a sliding tail.
- [ ] If Hypothesis A: enable storage-backend write-receipts at
  the wallet layer (currently best-effort in extension contexts).
  Reject events without a confirmed-persisted ack.
- [ ] If Hypothesis B: review IAM scoping for the storage backend.
  No human should have direct delete rights against audit storage
  in production; the only legitimate writer is `AuditCapture`.
- [ ] If Hypothesis E: codify the "schema-version → hashInput
  shape" mapping in a manifest file checked at startup, so a
  schema-mismatched build refuses to boot rather than silently
  corrupting hashes.

## 7. Sharp edges

- **Do NOT splice fabricated events into the chain.** Even if
  application logs preserved the lost content perfectly, inserting
  a "reconstruction" event that pretends to have been captured
  at the original time breaks the cryptographic property that
  audit events were attested at capture. Use gap markers instead;
  they're explicit acknowledgements that something was lost.
- **Do NOT regenerate `eventHash` values.** Recomputing hashes
  to "fix" a chain creates a chain that looks valid but signals
  to any future verifier that the entire range is suspect.
  Re-validation is a read-only operation by design.
- **The `EvidenceRecord.chainValid` boolean is downstream-relied.**
  Export packages, regulator submissions, and the
  `audit:export` CLI all branch on this flag. A `false` here is
  semantically meaningful to consumers — operators must NOT
  hide a `false` to "preserve UX." Surface it; document the
  cause.
- **Sequence numbers are per-subject, not global.** A gap in
  workspace A's chain doesn't imply anything about workspace B's
  chain. Run `verifyChain` per subjectId — global verification
  is meaningless.
- **Gaps within active SOC-2 audit windows are reportable.**
  An auditor's request for evidence is the regulator-clock
  trigger, not the gap itself. If a `chainValid: false` evidence
  package was already shipped to an auditor, ops MUST disclose
  the gap to the auditor proactively — concealment compounds
  the finding.
- **Merkle batches lock evidence.** Once `MerkleBatch.finalize`
  has run on a range and the batch was notarized on-chain, the
  contents of that range are pinned to the batch root. A gap
  that appears AFTER notarization can't be "patched" without
  invalidating the on-chain root — at that point the batch is
  evidentiary regardless of the chain validity flag, and ops
  must document the gap as a known-issue annotation against
  that batch's id rather than try to fix it in storage.

## 8. Wiring the metrics (PRs #107, #108, #110, #111)

The four alert metrics referenced throughout this runbook are
emitted by the `@aethelred/wallet-audit` package via a pluggable
`AuditMetricsRecorder` interface. The wallet extension's
background service worker wires these IN PRODUCTION via the
`buildAuditMetricsRecorder` factory in
`apps/extension/src/lib/audit-metrics-bridge.ts` (PR #110):

```ts
import { InMemoryMeter } from "@aethelred/wallet-observability";
import { AuditCapture, AuditStore } from "@aethelred/wallet-audit";
import { buildAuditMetricsRecorder } from "./lib/audit-metrics-bridge";

const meter = new InMemoryMeter();
const recorder = buildAuditMetricsRecorder({
  meter,
  defaultLabels: { service: "wallet-extension-background" },
});

// AuditStore wires storage-failure metrics automatically:
const store = new AuditStore(storage, undefined, null, recorder);

// Chain-integrity metrics fire when verifyChain or
// buildEvidenceRecord is invoked with the recorder:
const valid = AuditCapture.verifyChain(events, recorder);
const evidence = buildEvidenceRecord("intent-evidence", events, recorder);
```

The factory builds four counters with the canonical names from
`OBSERVABILITY_SCOPE.md` §3.12 and merges per-event labels
(`subject_id`, `workspace_id`, `operation`) with the
service-level `defaultLabels` at increment time.

For operators who want to wire the recorder manually (without
the factory — different meter package, different label scheme,
etc.), the underlying interface is straightforward:

```ts
import type { AuditMetricsRecorder } from "@aethelred/wallet-audit";

const recorder: AuditMetricsRecorder = {
  recordChainIntegrityBroken: ({ subjectId, workspaceId }) => { /* ... */ },
  recordChainLinkMismatch: ({ subjectId, workspaceId }) => { /* ... */ },
  recordStorageWriteFailed: ({ operation, sequenceNumber }) => { /* ... */ },
  recordStorageReadFailed: ({ operation }) => { /* ... */ },
};
```

### Export pipeline (PR #111)

By default, the in-memory `Meter` accumulates counters until
service-worker eviction wipes them. To push counters to a
remote OTLP collector, operators set the build-time env var
`VITE_AUDIT_METRICS_OTLP_URL` to their endpoint (the wallet
extension reads this in `background.ts` at instantiation):

```bash
# operator's build-time config
VITE_AUDIT_METRICS_OTLP_URL=https://otlp.example.com/v1/metrics \
  npm run build:extension
```

The extension constructs a `PeriodicMetricsExporter` (also from
`@aethelred/wallet-observability`) that pushes the meter's
accumulated state every 60 seconds. Counters use cumulative
semantics (`aggregationTemporality: 2` in the OTLP payload);
the receiver handles cumulative-vs-delta resampling.

When `VITE_AUDIT_METRICS_OTLP_URL` is unset (default OSS build),
the exporter is null and counters accumulate purely in-memory.
Debug visibility comes from `auditMeter.toPrometheus()` invoked
from a popup-side debug surface or a test harness.

**Service-worker eviction trade-off:** counters accumulate from
SW instantiation. Eviction loses in-flight increments since the
last successful tick. The 60s interval minimizes the window;
pre-eviction `chrome.runtime.onSuspend` flush is documented as
a follow-up.

All surfaces (`AuditCapture.verifyChain`, `buildEvidenceRecord`,
`AuditStore` constructor) accept the recorder as a final,
optional argument — the noop default preserves pre-PR-#107
behavior when the recorder is omitted.

**Chain-integrity recorder (PR #107)** fires at the FIRST detected
failure per `verifyChain` invocation. Full-chain audits iterate
verifyChain over progressively larger windows or partition by
sequence range. Methods receive `AuditChainBreakDetails`:
`failedEventId`, `sequenceNumber`, `workspaceId`, `subjectId`.

**Storage-durability recorder (PR #108)** fires at three call
sites in `AuditStore`:

| Method | Call site | When |
|--------|-----------|------|
| `recordStorageWriteFailed({ operation: "persist", sequenceNumber })` | `persist()` | A new event was appended in-memory but the underlying storage `set()` threw. **Leading indicator of Hypothesis A** in §3.4 (silent storage write loss → eventual chain gap on reload). |
| `recordStorageWriteFailed({ operation: "rotateKey" })` | `rotateKey()` | Master-key rotation tried to write the event list under a new encrypted store; old store is preserved. |
| `recordStorageReadFailed({ operation: "initialize" })` | `initialize()` | Both encrypted and plain reads failed. The wallet starts with an EMPTY in-memory event list; first new event will overwrite genesis chain links if the backing store recovers. |

The encrypted-fallback-only failure (encrypted read fails BUT
plain read succeeds — the documented migration path) does NOT
fire `recordStorageReadFailed` — that's a soft warning logged via
`console.info`, not a metric event.

**Where the recorder doesn't fire (yet):**
- **Background verifier outside `verifyChain`** — operator-
  implemented; wire the same recorder to your background job.
- **Merkle-batch root mismatches** — separate concern;
  `audit.merkle_batch_failed` is a distinct alert wired in a
  future PR if/when batch observability is needed.
- **Eviction-marker emission failures** — `event-store.ts:128`
  inserts the synthetic eviction marker synchronously (no async
  storage call), so there's no failure path to instrument.
