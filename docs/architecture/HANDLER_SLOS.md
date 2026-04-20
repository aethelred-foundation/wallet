# Handler Latency SLOs — Wallet Background Service Worker

## Why we measure

The browser-extension background service worker dispatches ~45
bridge message handlers. Each one is a discrete user-facing
operation — "unlock the wallet," "list pending transactions,"
"sign a transfer," "fetch balances." Perceived wallet responsiveness
is the sum of those handler latencies plus the native UI cost,
which means a handler that silently drifts from 15 ms to 300 ms
over three months degrades the product without tripping any alarm.

Mobile and desktop hardware variance makes the drift even harder
to catch: the developer laptop stays fast while the low-end Android
fleet grinds. Manual QA never sees the regression, the perf CI
benches only cover a handful of signing hot paths, and the "app
feels slow" escalation lands weeks after the code change that
caused it.

SLOs flip the incentive. Every handler declares a **latency budget**
(p50, p99, hard-max) at the same place it's defined, the service
worker measures against the budget in production, and breaches are
logged, audited, and surfaced in Developer Tools.

A handler that doesn't declare a budget is a handler whose owner
has not thought about how fast it should be. That is the failure
mode we want to prevent.

## Where the budgets live

`apps/extension/src/background/slo-defaults.ts` is the single
source of truth. Every `BridgeMessageKind` variant appears exactly
once; a compile-time exhaustiveness check fails the build if a new
kind is added to `packages/connect/src/bridge-types.ts` without a
matching entry.

Each entry carries four numbers:

| Field    | Semantics                                                    |
| -------- | ------------------------------------------------------------ |
| `p50Ms`  | Target median. Most users, most of the time.                 |
| `p99Ms`  | Tail budget. The slowest one-in-a-hundred call.              |
| `maxMs`  | Hard floor. Any sample above this is a breach — logged immediately and audit-stamped. |
| `category` | Rollup tag: `state`, `rpc`, `approval`, `passkey`, `walletconnect`, `credentials`, `deployment`, `audit`, `misc`. |

## The measurement pipeline

`apps/extension/src/background/slo-monitor.ts` implements
`SloMonitor`. The service worker's `chrome.runtime.onMessage`
listener wraps every dispatch:

```ts
const start = performance.now();
let success = false;
try {
  await swLifecycle.ensureBooted();
  const response = await handleMessage(msg, sender);
  success = true;
  sendResponse(response);
} finally {
  sloMonitor.record({
    kind: msg.kind,
    durationMs: performance.now() - start,
    at: Date.now(),
    success,
    correlationId: msg.correlationId,
  });
}
```

Each sample goes into a fixed-size ring buffer (default 200 entries
per handler). Steady-state `record` is O(1); percentile snapshots
sort the live prefix in O(n log n). The ring buffer bounds memory
across the service worker's long uptimes — an eviction strategy
that uses the *oldest* sample is exactly right for a freshness-first
use case.

## How to add a new handler

1. Add the new `BridgeMessageKind` variant to
   `packages/connect/src/bridge-types.ts`.
2. Add a matching row to `DEFAULT_SLOS` in
   `apps/extension/src/background/slo-defaults.ts`.
   - Pick a category that matches the handler's cost structure.
   - Start with conservative numbers — tighten after real telemetry.
   - `p50Ms` can never be larger than `p99Ms`, which can never be
     larger than `maxMs`. The `SloMonitor` constructor enforces this.
3. Wire the handler in `apps/extension/src/background.ts`. The
   dispatcher already wraps every handler in the SLO shim, so no
   per-handler code change is needed.
4. Add or update a test that covers the handler's happy path —
   the round-trip is automatically measured.

## How to respond to a breach

When a handler's p99 lands over its budget, the Developer Tools
"SLO monitor" panel highlights the row in red, and the background
writes a single `slo-breach` audit event per SW session (so the log
stays readable). The breach is real. The question is which kind:

1. **Budget wrong.** The first few weeks of real telemetry always
   surface handlers whose initial numbers were too tight. If the
   p99 is plausible for what the handler actually does — the RPC
   provider's tail is what it is — update the budget and commit the
   new values with a short rationale in the PR description.

2. **Code slow.** A sudden regression (p99 jumped from 25ms to
   250ms in the last two weeks) always means a recent change
   introduced a hot-path cost. Pull the last two weeks of commits
   on the handler's file and neighbor files, bisect, profile.

3. **Cold-start artifact.** The SW wakes up on every idle →
   message transition. The `ensureBooted` gate can run the
   full rehydration stage set (audit chain, pending approvals,
   Merkle batches) which legitimately takes tens of milliseconds.
   The SLO monitor includes boot cost in its measurement
   because that's what the user feels; if cold-start dominates
   your handler's p99, fix the boot path rather than carving
   out the handler.

4. **Fleet variance.** Low-end hardware produces a heavy tail the
   dev laptop never sees. This is an argument for widening `p99Ms`,
   not narrowing it. `maxMs` should stay strict — a 5-second
   handler is still a 5-second handler, regardless of CPU.

## Breach audit event shape

```json
{
  "kind": "slo-breach",
  "subjectId": "subject-…",
  "workspaceId": "ws-…",
  "detail": {
    "handler": "get-balances",
    "category": "rpc",
    "p99Ms": 1350,
    "budgetP99Ms": 800,
    "breaches": 4,
    "sampleCount": 47
  }
}
```

The event fires once per handler per SW session. The Developer
Tools panel is the live source of truth — the audit entry is a
durable marker for post-incident review.

## Examples

### Case 1 — the `rpc-request` tail doubled after a provider swap

*What we saw*: Developer Tools flagged `rpc-request` p99 at 1.2s
(budget 500ms). Breach count climbed every hour. Other RPC
handlers (`get-gas`, `get-balances`) were all within budget.

*Root cause*: A new RPC provider had a slower `eth_sendRawTransaction`
than the old one. The budget had been set against the old provider.

*Fix*: Retuned `rpc-request` p99 to 1500ms with a PR note citing
the measured new-provider baseline. `get-balances` stayed at 800ms
because its path doesn't touch the slow endpoint.

### Case 2 — `unlock-request` p99 climbed from 400ms to 1.1s

*What we saw*: Lock-unlock loop p99 breached the 500ms budget on
the `unlock-request` row.

*Root cause*: A recent PR bumped the PBKDF2 iteration count from
100k to 600k as part of a KDF hardening sweep. The extra 400–800
ms was the new KDF cost.

*Fix*: Widened `unlock-request` p99 to 1500ms. This is a correct
SLO loosening — the handler got slower on purpose, and the budget
has to reflect the new reality. A tighter budget would have paged
oncall for a change the team *wanted*.

### Case 3 — `passkey-list` regressed silently

*What we saw*: `passkey-list` p99 at 150ms (budget 25ms). No
recent changes to the handler or the CredentialStore.

*Root cause*: A storage-adapter change introduced a JSON parse on
every read, and the handler hit the adapter once per passkey.
Three passkeys × ~50ms parse = 150ms.

*Fix*: Cache the parsed credential list in `CredentialStore`.
Handler p99 dropped to 8ms. Budget kept at 25ms.

## Disable / reset

The monitor exposes `reset()` for the SW lifecycle hook that runs
on explicit unlock or on a Developer Tools "clear" action. A
fresh handler with zero samples returns `null` from `snapshot()`
rather than a zero-filled roll-up — this is deliberate, so the
panel can distinguish "never called" from "called fast."
