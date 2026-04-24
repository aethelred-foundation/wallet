# P0: `notary.anchor.tx.reverted ≥ 1`

> **Alert class:** Zero-tolerance correctness event
> **Severity:** P0 (pages immediately, 24/7)
> **Class:** On-chain infrastructure / audit trail integrity
> **Packages affected:** `@aethelred/wallet-notarization`
> **Last validated:** 2026-04-24

## 1. What this alert means

A `NotarizationScheduler` tick submitted an `anchor(merkleRoot,
eventCount)` transaction to the Notary contract, the RPC receipt
returned `status: "reverted"`, and the `OnChainAnchorAdapter`
surfaced `anchor-tx-reverted` to the scheduler.

Reverts on a pure-storage contract (Notary has no access control,
no pause, no external calls) are NOT expected under normal
operation. The three custom-error paths in the contract are:

1. `ZeroRoot` — submitted root is `bytes32(0)`.
2. `ZeroEventCount` — submitted `eventCount` is `0`.

The anchor-client pre-validates both of those before submitting,
so a revert in production means either:

1. **Pre-validation bypassed** — a code path submitted directly
   without going through `encodeAnchor()`.
2. **Contract was replaced** — the address in
   `contracts/deployments.json` now resolves to a different
   contract (either a malicious upgrade OR a CREATE2-address
   collision via honest deployment divergence).
3. **RPC-returned misleading receipt** — provider-side bug OR an
   intermediary modifying responses.

## 2. Impact

- **The specific batch did not land on-chain.** It remains in the
  scheduler's local `MerkleBatch` state with the `approved` →
  `failed` transition if the ledger tracks that.
- **The audit-trail continuity claim is at risk.** If the batch
  was finalized from `MerkleBatch.finalize()` (which removes the
  events from the pending queue), the events are now in limbo:
  the root was computed but never anchored. Downstream verifiers
  computing `AnchoredProof` against the root will fail.
- **Future batches continue independently.** The scheduler runs
  on a cadence; subsequent tick attempts may succeed. This
  doesn't auto-recover the failed one.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the notarization dashboard.
3. Pull the tx hash from the alert context:
   `alert.details.transactionHash`.

### 3.2 Minute 2–5: contain

**Pause the notarization scheduler.**

```bash
# Operator-config knob; specific command varies per deployment
ops:notarization pause --reason="investigating tx reverted"
```

Pausing prevents the next tick from firing while we're
investigating. Events continue to accumulate in the local
`MerkleBatch`; they'll be anchored once the scheduler resumes.

The per-package `notary.batch.backlog.size` gauge will climb
during the pause — that's expected. Alert on it crosses a
different threshold (P1, not P0); ignore that secondary page
until the root cause is resolved.

### 3.3 Minute 5–15: triage

Inspect the reverted transaction:

```bash
# Fetch full receipt + input data
cast tx <tx-hash> --rpc-url $PRODUCTION_RPC | tee /tmp/reverted-tx.json
cast receipt <tx-hash> --rpc-url $PRODUCTION_RPC | tee /tmp/reverted-receipt.json
```

Answer:

- **Was the `to:` address correct?** Compare against
  `contracts/deployments.json` `predicted.Notary`.
- **Was the calldata correctly-formed?** Decode:
  ```bash
  cast 4byte-decode 0x<calldata>
  # Should match: anchor(bytes32,uint32)
  ```
- **What's the revert data?** Decode the custom error selector:
  ```bash
  cast abi-decode 'ZeroRoot()' 0x<revert-data>
  cast abi-decode 'ZeroEventCount()' 0x<revert-data>
  ```

Cross-check the Notary contract's bytecode against the expected
compile output:

```bash
cast code <notary-address> --rpc-url $PRODUCTION_RPC | \
  shasum -a 256
# Compare against:
forge inspect Notary bytecode | shasum -a 256
```

If the hashes differ, the deployed contract has been replaced.
**This is a major incident.** Escalate to Security Lead
immediately — the tamper-evident audit anchor no longer points
at the audited bytecode.

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — calldata bug.** If `to:` is correct AND
bytecode matches AND the calldata decodes to
`anchor(bytes32(0), ...)` or `anchor(..., 0)`:

- Someone bypassed the `encodeAnchor()` validator OR there's a
  bug in the validator. Check recent changes:
  ```bash
  git log -p packages/notarization/src/calldata.ts
  ```

**Hypothesis B — contract replaced.** If the deployed bytecode
hash doesn't match the audited build:

- Immediate Security Lead escalation.
- Pause ALL anchor submissions across all chains until we know
  the scope.
- This is the adversarial case — the audit trail's integrity
  depends on the anchor contract being the one we audited.

**Hypothesis C — RPC provider bug.** If the bytecode matches
AND the calldata looks valid AND the revert data doesn't match
any known Notary error selector:

- Verify against a second independent RPC provider:
  ```bash
  cast tx <tx-hash> --rpc-url $BACKUP_RPC
  # Compare both receipts
  ```
- If the backup shows `status: "success"`, the primary RPC
  provider is returning a misleading receipt. Switch to the
  backup and file with the provider.

**Hypothesis D — gas estimation failure.** If the revert is
actually an out-of-gas error mis-classified (check `gasUsed ==
gasLimit`):

- Re-run gas-budget check: `npm run gas:check`.
- The budget enforcement should have caught this in CI. If it
  didn't, the budget file is stale — regenerate + bump.

## 4. Resolution paths

### Hypothesis A: calldata bug (most likely)

1. Identify the offending code path. The validator in
   `packages/notarization/src/calldata.ts` rejects zero-root and
   zero-event-count at encode time — the bug is either a bypass
   of the validator or a new entry point that doesn't use
   `encodeAnchor()`.
2. Fix the code path; ship with a regression test that
   asserts every write path goes through the validator.
3. Resume the scheduler:
   ```bash
   ops:notarization resume
   ```
4. Re-attempt the failed batch:
   ```bash
   ops:notarization reanchor --batch-id=<id>
   ```

### Hypothesis B: contract replaced

1. Security Lead takes over.
2. All anchoring halted across all chains.
3. Forensic analysis of the deployer address: who controlled it
   at the time of replacement? Was the CREATE2 salt re-used via
   a different factory?
4. Customer notification required; SOC-2 + regulator
   notifications per jurisdiction.

### Hypothesis C: RPC provider bug

1. Switch production RPC to backup provider immediately.
2. Resume scheduler.
3. File with the primary provider; share the transaction hash
   + both receipts.
4. Post-incident: evaluate if the provider should remain primary.

### Hypothesis D: gas budget stale

1. Regenerate gas-budgets.json from the current contracts.
2. Ship the budget bump with a commit message explaining the
   increase.
3. Resume the scheduler.
4. Re-attempt the failed batch.

## 5. Escalation criteria

Escalate to Security Lead immediately if:

- Deployed bytecode hash doesn't match audited build (Hypothesis B).
- > 1 tick reverts in a 1-hour window (systemic issue, not a
  one-off).
- Revert data doesn't decode to any known Notary custom error
  AND the contract address is correct.
- Any evidence that the audit trail has been truncated (batches
  finalized but not recoverable).

## 6. Post-incident

- [ ] If Hypothesis A: validator coverage. Is there any code path
  that bypasses `encodeAnchor()`? Audit the entire TS caller
  surface.
- [ ] If Hypothesis B: upgrade path hardening. Was the deployer
  address multisig? Should it be? Is there a time-lock?
- [ ] If Hypothesis C: multi-RPC strategy. Can we always call two
  providers and compare receipts?
- [ ] Audit trail continuity: confirm every failed batch was
  eventually anchored. Check the `AnchoredProof.record` for every
  `FinalizedBatch` produced since the incident.
- [ ] Gas-budget refresh: the revert surfaced a gap between
  enforced budgets + production behaviour. Revisit.

## 7. Sharp edges

- **Reverted anchor ≠ lost audit events.** The `MerkleBatch`
  retains the events + proofs after `finalize()`. Re-anchoring
  the same root is safe — the Notary doesn't dedupe, which
  means the same batch can produce multiple anchored records
  (different batchIds, same merkleRoot). Verifiers ignore
  duplicates via `requestId` equivalence.
- **Notary has no admin.** You cannot "fix" it remotely. If
  Hypothesis B is confirmed, the only remediation is deploying
  a new contract at a new address and migrating audit
  infrastructure to point at it.
- **CREATE2 collision is not preventable after-the-fact.**
  Pin the deployer multisig with a time-lock so re-deployment
  with the same salt cannot happen without a human review window.
