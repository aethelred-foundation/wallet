# P0: `custody.shamir.reconstruction.failed ≥ 1`

> **Alert class:** Zero-tolerance correctness event
> **Severity:** P0 (pages immediately, 24/7)
> **Class:** Custody / key material integrity
> **Packages affected:** `@aethelred/wallet-custody-adapters`
> **Last validated:** 2026-04-24

## 1. What this alert means

A `ShamirTwoOfTwoAdapter` attempted to reconstruct a private key
from two additive shares and produced either:

- A key that's not a valid secp256k1 private key (failed curve
  validation), OR
- A signature that doesn't recover to the expected address.

Under correct operation, two valid shares over GF(n) always
reconstruct a valid key. A failure means one of three things:

1. **Share corruption.** Either share was modified in storage or
   in transit.
2. **Share mismatch.** The fetched remote share doesn't belong to
   the agent's local share (wrong pairing, cross-tenant leak).
3. **Active compromise.** The sharing coordinator was tampered
   with OR the fetcher is being impersonated.

## 2. Impact

- The affected agent cannot sign transactions until the issue is
  resolved. They see a typed `CustodyError`
  (`shamir-reconstruction-failed`).
- **No funds are at risk** from the failure itself — the
  reconstruction rejects the output before signing happens. The
  adapter `dispose()`s the shares on failure to prevent memory
  scraping.
- **Funds MAY be at risk** from whatever caused the failure: if
  a share has been modified, an attacker may have the pre-mod
  version.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + the custody-adapter dashboard.
3. Identify the affected agent: `agentId` + `controlAddress` from
   the alert context.

### 3.2 Minute 2–5: contain

**Revoke outstanding access for the affected agent.**

1. If the agent has an on-chain `AgentBudget`: revoke the session
   key immediately via `budgetClient.prepareRevokeSession` +
   submit. This is a single-block guarantee.

   ```
   Revocation is atomic in AgentBudget — every subsequent spend()
   reads the Session state. See contracts/src/AgentBudget.sol
   §revokeSession + the test_revocation_race_atomic property
   test.
   ```

2. If the agent has active x402 session signers in memory, ensure
   those sessions are not reusable — in practice they are
   short-lived and already expire quickly.
3. **Do NOT rotate the agent's master key yet.** We need both
   shares intact for forensics.

### 3.3 Minute 5–15: triage

Pull the diagnostic context:

```bash
dd logs query "service:custody event:shamir-reconstruction-failed \
   agentId:<the-id>" --limit=20 --format=json
```

For each event you need:

- **`localShareFingerprint`** — hash of the local share (do NOT
  log the share itself).
- **`remoteShareFingerprint`** — same, for the fetched share.
- **`reconstructionErrorCode`** — which specific validation failed
  (zero-sum / not-on-curve / signature-mismatch).
- **`shareFetcherImpl`** — which remote fetcher was in use
  (HTTPS / Nitro-sealed / keychain).

Compare fingerprints against the last known-good value from the
agent's audit trail:

```bash
# Pull agent's last successful sign event
audit:query --agentId=<id> --event=signing-executed --limit=1
```

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — local share corruption.** If the local
fingerprint has changed since the last known-good:

- Did the client storage layer corrupt it? Check browser
  storage-quota-exceeded logs + IndexedDB integrity.
- Did a client update overwrite it? Check Chrome Web Store
  bundle version at the time of the failure.

**Hypothesis B — remote share corruption.** If the remote
fingerprint changed:

- Contact the share fetcher provider (coordinator service,
  keychain vendor, Nitro enclave operator).
- Check the provider's own audit log for writes to this agent's
  share around the failure time.

**Hypothesis C — share cross-pairing.** If both fingerprints
look valid in isolation but reconstruction still fails:

- This is the scariest class — it means a correct-looking share
  has been swapped for a share belonging to a different agent.
- Check the fetcher's agentId → share lookup for any recent
  writes / migrations that could have cross-wired IDs.

**Hypothesis D — active compromise.** If neither side's
fingerprint matches the expected value AND there's no legitimate
reason either changed:

- Treat as a security incident. Escalate to Security Lead.
- Preserve BOTH shares (encrypted, in separate secure storage)
  for forensics. Do NOT dispose them.

## 4. Resolution paths

### Hypothesis A: local corruption

1. Migrate the agent to a new custody backend (prefer Nitro or
   Ledger for high-value agents) or re-provision via fresh
   shares.
2. Investigate the corruption cause — storage driver, update
   flow, race between tabs.

### Hypothesis B: remote corruption

1. Coordinate with the fetcher-provider to restore from backup.
2. Test reconstruction offline with the restored share before
   re-enabling the agent.
3. Post-incident: enforce HMAC'd share storage on the provider
   side if not already.

### Hypothesis C: cross-pairing

1. Identify the affected agent pair(s) — there's at least a pair,
   possibly a cluster.
2. Audit every share-write in the provider for the past 30 days
   looking for mis-keyed writes.
3. Rotate ALL potentially-affected agents' keys (belt + braces).

### Hypothesis D: active compromise

1. Engage Security Lead per `INCIDENT_RESPONSE.md` §2.
2. Agent's control-plane access frozen; budget revoked on-chain.
3. Preserve all forensic state (shares, fetcher logs, audit
   events) in secure storage.
4. Customer notification within 24 hours for P0 security
   incidents per `INCIDENT_RESPONSE.md` §1 "P0 response target."
5. Regulator notification: GDPR 72-hour window if the agent's
   subjectCommitment is involved (it usually is for KYC'd
   agents).

## 5. Escalation criteria

Escalate immediately if:

- ≥ 2 agents affected simultaneously (shared-fault with
  provider or fetcher).
- The affected agent is an enterprise tier ($10k+ daily spend
  cap).
- Share fingerprint chain shows modification that doesn't match
  any known legitimate write.

## 6. Post-incident

- [ ] Property test coverage: add a fuzz test for the specific
  corruption mode discovered.
- [ ] Fetcher-provider SLA: validate the provider's share-
  integrity guarantees match what failed.
- [ ] Audit trail review: was the pre-failure state preserved
  for forensics? If no, add retention extension to the runbook.
- [ ] Post-mortem share-rotation: any share that *could* have
  been compromised by the same mechanism gets rotated, even if
  not individually flagged.
- [ ] Review on-chain `AgentBudget.revokeSession` latency
  during the incident (it should be 1 block, per the
  revocation-race-atomic property test).

## 7. Sharp edges

- **Never paste share values into any incident channel.** Hashes
  + fingerprints only.
- **`ShamirTwoOfTwoAdapter.dispose()` zeroises shares on call.**
  If you need to preserve shares for forensics, do NOT call
  `dispose()` on the adapter — hand it off through the secure-
  storage handoff process in `INCIDENT_RESPONSE.md` §7.
- **`splitPrivateKey` + `reconstructKey` are deterministic pure
  functions.** Reproducing the failure offline in a test harness
  (with a new fresh-random key) confirms whether the issue is
  share-data-specific vs adapter-code-specific.
