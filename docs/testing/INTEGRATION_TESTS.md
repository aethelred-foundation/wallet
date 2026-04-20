# Integration tests — the wallet's cross-package safety net

> **TL;DR.** Unit tests with `vi.mock()` prove the pieces work in isolation.
> Integration tests prove the wallet **actually signs and broadcasts a
> transaction when a dApp asks it to**. Every user-facing flow needs one.

## Why this exists

The wallet ships 38 test files that mock out modules under test to isolate
behaviour. That was the right call during the build-out phase: it let us
iterate on each package without worrying about cross-package wiring.

But every real incident we've seen in the audit trail was a **cross-boundary
bug**:

- The policy engine evaluated correctly in its own test, but the background
  never passed it `amountUsd`.
- The workflow engine accepted quorum correctly, but the dispatcher never
  called `submitDecision()`.
- The signer produced correct bytes, but the broadcast path swallowed the
  error.
- The audit chain verified in its own test, but nothing in the pipeline
  actually called `record()` at the right moment.

None of these would have been caught by the existing unit suite because they
all sit at seams the unit tests explicitly stub out. The integration suite
closes that gap.

## What the integration harness is

`apps/extension/src/test/integration/harness.ts` composes the exact
production classes the background service worker uses:

- `MasterKey` + `KeyManager` + `Signer` + `LocalCustodyBackend` — real
  secp256k1 signing, real keccak256 address derivation, real EIP-1559 RLP
  encoding.
- `AuditCapture` + `MerkleBatchCoordinator` — real SHA-256 hash chain,
  real batching.
- `RpcClient` + `TxManager` + `GasOracle` — real JSON-RPC request/response
  paths. The only thing swapped out is `fetch`, which is routed to a
  per-test-scripted handler map.
- `WorkflowEngine` + `getApprovalTemplate` — real quorum evaluation.
- `evaluate()` + `buildPolicyContext()` — real policy rule matching.

The harness then exposes a narrow `sendMessage(kind, payload, origin)` API
that routes bridge messages through a dispatcher which **mirrors the exact
switch in `background.ts`**. The dispatcher is deliberately a near-literal
copy of the production handler so any gap between the two is visible in
code review.

## What the harness is NOT

- **Not a full `background.ts` import.** `background.ts` has ~3,800 lines of
  top-level side effects — it registers a global `chrome.runtime`
  listener, spawns timers, initialises the WalletConnect singleton, and
  mutates module-level state. Importing it 60× across a test suite would
  leak state between tests and make failures non-reproducible.
- **Not a headless Chrome test.** Those live in `apps/extension/e2e/` and
  exist for end-user flow verification. Integration tests here are
  in-process, run in CI under 30 seconds, and can check post-conditions
  (e.g. "the audit chain hash is this specific value") that a headless
  browser can't.

## How to add a new integration scenario

1. **Pick a flow.** Every flow a user can trigger from the UI or a dApp
   should have at least one integration test. Read
   `apps/extension/src/background.ts` and identify the top-level
   `handleMessage` branch that owns the flow.
2. **Extend the harness if the flow uses a kind not yet covered.** Add a
   new case to the `dispatch()` switch; prefer composing the existing
   production classes over duplicating their logic.
3. **Drop a new file into
   `apps/extension/src/test/integration/<scenario>.integration.test.ts`.**
   Each file should describe ONE flow in its filename (e.g.
   `send-transaction`, `workflow-quorum`).
4. **Mirror the background code path exactly.** If production records
   `policy-evaluated` then `approval-requested` then `signing-executed`,
   the test should assert on that exact sequence. Any deviation is a real
   bug.
5. **Assert on observable state, not implementation details.** Prefer
   `harness.getAuditEvents()`, `harness.recordedRpcCalls()`, and
   `harness.getPendingApprovals()` over poking at internal fields.

## How to diagnose a failing integration test

1. **Read the audit chain first.** Every flow leaves a trail of
   `AuditEvent`s. `harness.getAuditEvents()` returns the full chain in
   order — it tells you which stage of the pipeline the flow got stuck
   at.
2. **Check `recordedRpcCalls()`.** If a signing test fails and no
   `eth_sendRawTransaction` call was made, the signer either rejected or
   the approval wasn't granted.
3. **Inspect pending approvals.** A flow that hangs waiting for the user
   usually means the test forgot to call `approval-response`.
4. **Use `verifyChain()` to check for mutation.** If the audit chain is
   corrupted mid-test, something is mutating events after they were
   recorded (which should be impossible under the current contract — treat
   it as a bug, not a test flake).

## The review rubric

When reviewing a PR that adds a new user-facing flow:

- [ ] Does the flow have at least one integration test in
      `apps/extension/src/test/integration/`?
- [ ] Does the test drive the real background dispatcher, not a mock of
      it?
- [ ] Does the test assert on the full audit chain sequence produced by
      the flow, not just the final return value?
- [ ] Does the test cover both the happy path and the rejection path?
- [ ] Does the test assert that no unexpected RPC calls are made (e.g.
      a dry-run flow shouldn't hit `eth_sendRawTransaction`)?

If any answer is "no", ask for the integration test before approving.

## Inventory

| File | Flow | Test count |
|---|---|---|
| `send-transaction.integration.test.ts` | eth_sendTransaction full pipeline | 13 |
| `eth-rpc-dispatch.integration.test.ts` | Read-only EIP-1193 RPC surface | 23 |
| `policy-gate.integration.test.ts` | Policy engine gating | 11 |
| `workflow-quorum.integration.test.ts` | Multi-reviewer approval quorum | 9 |
| `lock-unlock.integration.test.ts` | Wallet lock/unlock lifecycle | 8 |
| `sw-restart-recovery.integration.test.ts` | MV3 SW eviction survival | 7 |
| `passkey-verify.integration.test.ts` | WebAuthn passkey lifecycle | 11 |
| `audit-chain-integrity.integration.test.ts` | Hash-chain tamper evidence | 12 |
| `session-and-export.integration.test.ts` | Session / workspace / export | 9 |

**Total: 103 integration tests.**

## Known gaps (future work)

- **`eth_getLogs` is in the `background.ts` switch but NOT in the
  `request-validator.ts` `KNOWN_METHODS` set.** The validator rejects
  every `eth_getLogs` call with `-32601` before the switch sees it, so
  the method is effectively broken for dApps. The
  `eth-rpc-dispatch.integration.test.ts` suite asserts today's (broken)
  behaviour; fix = add `"eth_getLogs"` to `KNOWN_METHODS` in
  `packages/connect/src/request-validator.ts`.
- **Subscription tests (`eth_subscribe` / `eth_unsubscribe`).** The
  polling shim in `background.ts` isn't yet exercised by integration.
- **WalletConnect v2 pairing.** The harness currently boots without the
  WalletConnect singleton; pairing flows need a dedicated scenario.
- **`aethelred_requestIntent` legacy path.** Same as WalletConnect —
  covered by `approval-flow.integration.test.ts` but not from the
  dispatcher side.
