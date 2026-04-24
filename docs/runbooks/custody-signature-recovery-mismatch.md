# P0: `custody.sign.recovery.mismatch ≥ 1`

> **Alert class:** Zero-tolerance correctness event
> **Severity:** P0 (pages immediately, 24/7)
> **Class:** Custody / signing integrity
> **Packages affected:** `@aethelred/wallet-custody-adapters`
> **Last validated:** 2026-04-24

## 1. What this alert means

A custody adapter returned a signature that, when passed through
ECDSA public-key recovery, does NOT recover to the expected address
for that adapter. The check exists in every custody adapter as
defence-in-depth — signing should never produce a recoverable
wrong-key signature under correct operation.

Under healthy conditions this counter stays at 0. Any firing means:

1. **Compromised remote signer.** A Nitro enclave / Fireblocks MPC
   cohort / Ledger device signed with a key that doesn't derive to
   the registered address. Could be an attacker lying about which
   key was used, or a genuine key-material drift.
2. **Adapter configuration drift.** The adapter's `address` field
   was set to one key but the signing path uses a different one —
   typically a copy-paste error in custom deployments or a stale
   cached address.
3. **Signature-malleability bug.** Signature encoding / v-byte
   handling drifted such that recovery produces the wrong address
   — this is the latent-bug class the check catches by design.

## 2. Impact

- The signature is **rejected** at the adapter boundary. Nothing
  downstream sees the bad signature; the calling code surfaces a
  `signing-failed` `CustodyError`.
- However, the fact that a wrong-key signature was produced at all
  is the alert — it means the signing backend did something
  inconsistent with its own address claim.
- If the remote backend is compromised, **future signatures might
  be forged for the correct key** but against a different payload.
  Even a single firing warrants full containment.

## 3. First-hour actions

### 3.1 Minute 0–2: acknowledge + open

1. PagerDuty acknowledge.
2. Open this runbook + custody-adapter dashboard.
3. From the alert context, identify: `adapter.label` (Nitro /
   Ledger / Fireblocks / Shamir / LocalKey), `expectedAddress`,
   `recoveredAddress`, agent id.

### 3.2 Minute 2–5: contain

**Disable the affected adapter label system-wide.**

```bash
# Operator config; exact command varies per deployment
ops:custody disable --adapter=nitro-enclave-us-east-1 \
                    --reason="recovery mismatch on agent <id>"
```

Disabling routes traffic to a fallback adapter (usually Ledger for
high-value agents, Shamir for programmatic). Agents without a
configured fallback fail closed — signing returns
`capability-not-supported`. Better than routing through a
potentially-compromised backend.

If the affected adapter is the agent's only custody path:

- Revoke the agent's on-chain `AgentBudget` session key
  immediately via `budgetClient.prepareRevokeSession`.
- Do NOT attempt a key rotation until root cause is identified.

### 3.3 Minute 5–15: triage

```bash
dd logs query "service:custody event:sign-recovery-mismatch \
   adapter:<label>" --from=1h --limit=20 --format=json
```

For each event you need:

- **`adapter.label`** — which backend.
- **`expectedAddress`** — from adapter config at sign time.
- **`recoveredAddress`** — what the returned signature recovers to.
- **`digest`** — the 32-byte input.
- **`signatureHex`** — the returned signature (safe to log; not
  secret).
- **`adapterBuild`** — code version.

Cross-check the adapter's `address` against the registered identity:

```bash
# For Nitro: verify the startup attestation matches current state
dd logs query "adapter:nitro event:startup-attestation" --limit=1 \
  | jq '.quote.measurements.codeHash, .address'
```

For Fireblocks: check the API's reported vault-account public key
via the admin endpoint (separate from the wallet's cache).

For Ledger: re-derive the address from the device + HD path;
compare with the registered address in the wallet's
`HardwareWalletBackend.registeredSlots`.

### 3.4 Minute 15–30: narrow the hypothesis

**Hypothesis A — adapter-config drift.** If `expectedAddress` was
set from a stale cache / wrong env var / copy-paste error:

- The adapter's init path is buggy — `initialize()` failed to
  refresh address. Check recent changes to adapter initialise.
- Fix: re-provision the adapter with the correct registered
  address and ship a test that covers the init path.

**Hypothesis B — remote backend compromise.** If the signature
validly recovers to a DIFFERENT real address (not random):

- The remote backend is signing with a different key than it
  advertises. This is the high-severity branch.
- For Nitro: pull the current startup attestation and compare
  `measurements.codeHash` against the last-known-good. Drift ==
  deployment of unapproved code.
- For Fireblocks: escalate to Fireblocks support with the
  vault-account + tx ids.
- For Ledger: verify device firmware version + the physical
  device hasn't been swapped.

**Hypothesis C — signature encoding bug.** If the signature
recovers to an address that looks random (high entropy, not a
registered account anywhere):

- Encoding bug. Check `v` byte handling:
  - v = 27/28 (pre-EIP-155) vs v = 37+ (post-EIP-155)
  - compact r||s||v vs r||s (64 bytes) with v pinned externally
- Check recent changes to signature assembly paths.

## 4. Resolution paths

### Hypothesis A: adapter-config drift

1. Identify the stale config source (env var, cached file,
   rotation that wasn't followed through).
2. Refresh the adapter config from the source of truth.
3. Re-run the adapter init path; confirm `adapter.address` matches
   expected.
4. Re-enable the adapter: `ops:custody enable --adapter=<label>`.
5. Property-test the config reload path in CI.

### Hypothesis B: remote compromise

1. Engage Security Lead per `INCIDENT_RESPONSE.md` §2.
2. Keep the adapter disabled. Do NOT use it to sign anything
   including key rotations.
3. Agent affected: rotate custody to a different adapter class
   entirely (e.g., Nitro-compromised → move to Ledger or Shamir).
4. Regulator notification: GDPR 72h clock started at page-ack.
5. Vendor engagement:
   - Nitro: capture the current attestation + compare every
     measurement field against `packages/compliance/src/tee-
     attestation.ts` expectations. If a PCR measurement changed,
     AWS has to confirm the parent AMI integrity.
   - Fireblocks: full cohort rotation; Fireblocks support case
     with the recovery-mismatch trace.
   - Ledger: physical device forensics; replace device.

### Hypothesis C: encoding bug

1. Reproduce in a test harness with the exact digest +
   signature captured from logs.
2. Walk recovery step by step to find the bit that drifted.
3. Fix + ship with a test that pins the expected recovered
   address for a fixed input.
4. Re-enable the adapter.

## 5. Escalation criteria

Escalate to Security Lead immediately if:

- ≥ 2 events across different agents within 1 hour.
- The `recoveredAddress` is a real address (not entropy-looking)
  — this is the compromise tell.
- Nitro PCR measurements don't match the last-known-good.
- The adapter in question is a Nitro instance; the moat property
  depends on its attested code integrity.

## 6. Post-incident

- [ ] Did any test cover the recovery path? Nitro adapter's
  `compromised-enclave` test exists; custody-adapters-wide test
  may not. Audit coverage.
- [ ] Review adapter-config source-of-truth chain — every adapter
  should have exactly one canonical registered-address path.
- [ ] Evaluate adding a periodic `verifySignatureRecovers` health
  check against a fixed known digest per adapter (detects drift
  before production traffic finds it).
- [ ] If Hypothesis B resolved: update threat model
  (`docs/security/THREAT_MODEL.md`) with the attack class seen.

## 7. Sharp edges

- **Never deploy a fix through the compromised adapter.** If the
  adapter can't be trusted to sign, it can't be trusted to approve
  its own config update, its own rotation, or its own
  decommission.
- **Signature + digest are safe to log.** The signature does not
  reveal the private key. Do still redact payload bodies (may
  contain PII).
- **`NitroEnclaveAdapter` has a built-in recovery check** — this
  is the `verifySignatureRecovers` private method. If this alert
  fires for a Nitro adapter, the enclave lied about the key AND
  the adapter caught it. The moat worked. But the firing is still
  a serious signal about the enclave's integrity.
