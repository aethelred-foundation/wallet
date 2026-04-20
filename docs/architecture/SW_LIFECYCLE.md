# MV3 Service-Worker Lifecycle — Engineer Runbook

> Authoritative reference for how the Aethelred Wallet extension
> background boots, rehydrates, and shuts down on Manifest V3. Read
> this before registering a new subsystem or debugging a "state
> mysteriously reset" bug.

## Why this document exists

MV3 service workers are **ephemeral**. Chrome evicts them after
~30 s of inactivity, at every browser restart, at every extension
update, and every reload. Anything the background keeps in
module-scoped memory is gone on the next wake. The wallet's compliance
posture (audit hash chain, Merkle notarization, velocity counters,
pending approvals, policy decisions) requires that state survives those
evictions.

We solve this with one orchestrator (`SwLifecycle`) plus one stage per
subsystem. The orchestrator runs stages in a deterministic order on
every lifecycle event, so boot is auditable and testable.

## Event → handler matrix

| Chrome event                   | When it fires                                        | What SwLifecycle does                                                                 |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `chrome.runtime.onInstalled`   | Fresh install, update, reload                        | `boot()` → run **`onInstalled`** for every stage (in priority order), then `onStartup` |
| `chrome.runtime.onStartup`     | Browser restart (first SW wake in a session)        | `boot()` → run `onStartup` for every stage                                            |
| `chrome.runtime.onSuspend`     | Chrome is about to evict the SW (~5 s grace)        | `shutdown()` → run `onSuspend` in **reverse** priority order                          |
| `chrome.runtime.onMessage`     | Any bridge message                                  | `ensureBooted()` → boot if not booted, then fire every stage's `onMessage`            |

## Priority ordering contract

Stages run in ascending `priority`. Lower-priority stages run FIRST.
The priority band reserved for the wallet subsystems:

```
  0  storage-persistence        schema migration, quota checks
 10  audit-chain-rehydration    restore sequence + previousHash
 20  merkle-batch-restoration   start coordinator, flush on suspend
 30  pending-approvals          rehydrate chrome.storage.session
 40  nonce-manager              restore per-account nonce HW mark
 50  pending-tx-tracker         reconcile receipts for in-flight txs
 60  credential-store           restore enrolled passkey descriptors
 70  walletconnect-session      re-establish relay subscriptions
 80  velocity-tracker           force-hydrate velocity cache
 90  workflow-engine            restore quorum workflow state
```

Why the ordering matters:

- **Storage stage runs first** so every later stage sees the correct
  schema version. If a migration fails, every downstream hydration
  stage sees the stale pre-migration data — that's OK because the
  storage stage refuses to advance the version marker on failure, so
  the next boot will re-attempt the migration.
- **Audit chain runs before Merkle**: the Merkle coordinator replays
  persisted raw events through a fresh `AuditCapture`, which must
  already be at the correct head before any replay happens or the
  chain forks.
- **Pending approvals before nonce**: the approval flow reads
  `activeAccountId` which reads from persisted wallet state. If the
  nonce stage ran first it would cache a nonce for the WRONG account.

`onSuspend` runs in REVERSE priority order — high-level stages
flush first so the low-level storage layer still has a live handle
when audit-chain writes the final meta blob.

## When should I register a new stage?

Every time you add a subsystem that:

- Holds state in module-scoped memory (Map / array / counter)
- Has "last seen" / "high-water mark" / "sequence number" semantics
- Subscribes to an external event (WebSocket / relay / alarm)
- Accumulates bookkeeping across requests (velocity, rate limits,
  dedup windows)

If the answer is yes to any of the above, the subsystem needs a stage.
Not registering one is the single most common cause of silent
production bugs on MV3.

## How to register a stage

```ts
import { buildMyStage } from "./stages/my-subsystem-stage";

swLifecycle.registerStage(
  buildMyStage({
    /* deps */
  }),
);
```

Stages are factories — `buildMyStage` takes subsystem handles and
returns a `LifecycleStage`. This keeps stages testable without
spinning up the full background. A stage with NO `onInstalled` / no
`onStartup` / no `onSuspend` is a valid (if useless) stage — partial
implementations are supported.

## Why does this subsystem need `onSuspend`?

Only subsystems that BUFFER state need `onSuspend`:

- **Merkle batch coordinator**: the open batch is not yet written to
  `merkle-batches` storage. Without `onSuspend`, up to 255 events per
  batch can be lost on SW eviction.
- **Workflow engine**: pending quorum decisions live in memory. Any
  reviewer who clicked "approve" just before eviction loses their
  decision on the next wake without `onSuspend`.
- **WalletConnect**: the active session map mutates on every request;
  `onSuspend` is our chance to serialize the current set.

Subsystems that persist on every mutation (`AuditStore.append`,
`PendingTxTracker.add`) don't strictly need `onSuspend` — they use the
hook only to emit a trace line for observability.

## Writing an idempotent stage

Every stage callback must be idempotent. The test suite triple-
invokes each stage and asserts the end state is identical. Idempotency
rules:

1. **NEVER increment a counter in `onStartup`.** Observe and
   restore — don't mutate.
2. **Check for already-hydrated state** before reading from storage.
   The stage may be invoked on `onInstalled` AND `onStartup` in the
   same boot.
3. **Use set semantics over push.** If you're restoring a list into a
   `Map`, key by the persistent id, not insertion order.
4. **Guard mutation inside your stage.** If `onStartup` is called
   twice (it shouldn't, but if strictBoot is false the stage might be
   retried on a partial failure), the second invocation must be a
   no-op.

## Performance: ensureBooted() budget

`ensureBooted()` runs on every bridge message. Budget:

- Target `< 50 ms` on a cold SW (first message after wake)
- Target `< 1 ms` on a warm SW (already booted)

Rules:

1. **Don't scan all historical data.** `AuditStore.initialize()` only
   reads the meta blob (head pointer); it does NOT load all events.
2. **Don't hit the network.** The pending-tx-tracker stage polls
   receipts but caps at 5 RPC calls per boot to stay inside budget.
3. **Avoid disk I/O in `onMessage`.** The hook fires on every message
   — put expensive work in `onStartup`.
4. **Prefer lazy initialization.** `WalletConnectManager` isn't
   instantiated until the first `wc-*` message arrives; its stage
   no-ops until the manager exists.

## Debugging guide

### Inspect the service worker console

1. Go to `chrome://extensions`
2. Find "Aethelred Wallet" → click **"Service worker"** ("Inspect views"
   section)
3. The Chrome DevTools console is bound to the SW

### Watch the boot trace

Every boot emits a structured log record:

```
[info] sw.boot.started        correlationId=sw-boot-<timestamp>
[info] sw.onStartup.stage…    for each stage
[info] sw.boot.completed      correlationId=sw-boot-<timestamp> elapsedMs=<N>
```

If `elapsedMs > 200` the cold-start budget is being blown — find the
stage with the longest `stage.duration_ms` attribute and investigate.

### "My subsystem's state is resetting on SW wake"

Checklist:

- [ ] Is the subsystem registered as a stage? (look in
      `background.ts` for `swLifecycle.registerStage`)
- [ ] Does the stage have an `onStartup` hook that calls a restore
      method?
- [ ] Does the subsystem persist on mutation (not just on `onSuspend`)?
- [ ] Is the persisted data JSON-serializable? (bigints are NOT — look
      for `JSON.stringify` throwing)
- [ ] Is the storage key stable across installs? (accidentally keying
      by random id generates a new bucket per boot)

### Triggering a simulated wake in unit tests

```ts
const lifecycle = new SwLifecycle(logger, tracer);
// ...register stages
await lifecycle.boot();          // simulate first wake
// ...make assertions
lifecycle.dispose();             // simulate crash

// Fresh wake
const l2 = new SwLifecycle(logger, tracer);
// ...register the SAME stages (new instances)
await l2.boot();                 // second wake re-hydrates from disk
```

See `apps/extension/src/test/sw-lifecycle.test.ts` for working
examples of every pattern.

## Known gaps / future work

- `VelocityTracker` is registered with a stub tracker — the policy
  package hasn't yet wired the real tracker into `evaluate()`. When
  that lands, swap the stub for a real `VelocityTracker` instance.
- `CredentialStore.loadFromSnapshot` accepts the identity package's
  `Credential[]` shape but the stage stores opaque records — the
  snapshot round-trips correctly but the typing is deliberately
  loose. When the identity package exposes a typed snapshot API,
  tighten the stage surface.
- `TxManager.loadNonceSnapshot` / `TxManager.exportNonceSnapshot` are
  not yet first-class APIs — the nonce-manager stage reaches through
  the private `nonceCache` field. When the chain package exposes the
  public surface, remove the reach-through.
- `WalletConnectManager.rehydrateSessions` is declared optional —
  when the SDK lands, implement it and the stage will light up
  automatically.

## Hard contract summary

- `boot()` is idempotent. Concurrent callers share one promise.
- `ensureBooted()` always resolves to the same `LifecycleContext` for
  the lifetime of the SW instance.
- `shutdown()` fires `onSuspend` in REVERSE priority order.
- Every stage callback MUST be idempotent — the test suite triple-
  invokes each stage and asserts end-state equality.
- Stages at the same priority run in registration order.
- A failing stage in non-strict mode is logged but does NOT abort
  the boot — a single broken subsystem must never brick the wallet.
