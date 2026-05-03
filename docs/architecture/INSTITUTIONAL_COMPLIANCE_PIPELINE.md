# Institutional Compliance Pipeline

This document maps the architecture of the institutional compliance
pipeline — the components that turn an institutional transaction into
a tamper-evident audit record covering both jurisdictional rule
resolution and third-party custodian liability.

If you're trying to understand how a single transfer flows through
the wallet's compliance machinery end-to-end, read this document
first. The canonical executable example is in
`apps/extension/src/test/institutional-compliance-pipeline.test.ts` —
that test is verified on every CI run, so it can never go out of
sync with the code.

---

## What the pipeline does

Given an institutional transaction (e.g., a UAE-domiciled tier-1 bank
transferring \$5M of tokenized assets to a Singapore counterparty
through Komainu as the custodian), the pipeline:

1. **Resolves jurisdictional conflicts** — computes the rule
   intersection across every regulatory regime the transaction
   touches (MAS, VARA, MiCA, etc.), detects axis-by-axis conflicts
   (data exposure, residency, KYC level, AML / travel-rule thresholds,
   UBO disclosure, sanctions lists), and applies a per-tenant legal
   hierarchy to pick the winning rule.
2. **Captures custodian liability state** — fetches the live SLA +
   insurance coverage attestation from the custodian's signed oracle
   (Komainu, Fireblocks, BlockDaemon, Hextrust, etc.), verifies the
   oracle's signature against pinned keys, gates on attestation
   freshness, and binds the snapshot to the transaction id.
3. **Stamps both into the tamper-evident audit chain** — the
   wallet's existing SHA-256-chained event store gets two new event
   kinds (`compliance-conflict-resolved`,
   `custodian-liability-snapshot`) so an external auditor can later
   verify the complete decision provenance.

Background: the [feedback documents](../../wallet%20feedback) flagged
two structural gaps that this pipeline closes:

- **Issue #1** — the original "regulatory passport" was a static
  monolithic identity that couldn't handle mutually-exclusive rules
  across regimes (e.g., MAS Singapore requires data exposure for
  travel-rule transparency, VARA Dubai forbids exporting that data).
- **Issue #2** — the audit chain went dark at the third-party
  custodian's API boundary, leaving the treasurer unable to prove
  what liability was active at the moment of execution.

See [`WHY_INSTITUTIONAL.md`](../strategy/WHY_INSTITUTIONAL.md) for
the strategic positioning that motivates the pipeline.

---

## Data flow

```
                     ┌─────────────────────────┐
                     │  Institutional intent   │
                     │  (txId, jurisdictions,  │
                     │   custodian, amount)    │
                     └──────────┬──────────────┘
                                │
                                ▼
        ┌───────────────────────────────────────────────┐
        │  JurisdictionalConflictResolver               │
        │  (packages/compliance)                        │
        │                                               │
        │  • detects axis-by-axis conflicts             │
        │  • applies per-tenant LegalHierarchy          │
        │  • emits MatrixResolution (digested SHA-256)  │
        └────────────────────────────┬──────────────────┘
                                     │
                                     ▼
                     ┌──────────────────────────────┐
                     │  recordMatrixResolution      │
                     │  (packages/compliance)       │
                     │  emits AuditEvent kind:      │
                     │  "compliance-conflict-       │
                     │   resolved"                  │
                     └──────────────┬───────────────┘
                                    │
                                    ▼
        ┌───────────────────────────────────────────────┐
        │  AuditCapture                                 │
        │  (packages/audit)                             │
        │  SHA-256 hash chain — every event includes    │
        │  the previous event's hash. verifyChain()     │
        │  returns false if any event is mutated.       │
        └────────────────────────────┬──────────────────┘
                                     │
                                     ▼
            ┌────────────────────────────────────────┐
            │  JsonFeedLiabilityAttestor             │
            │  (packages/custody-adapters)           │
            │                                        │
            │  • HTTP fetch (timeoutMs, AbortCtrl)   │
            │  • Parse JSON snapshot                 │
            │  • Freshness gate (maxAgeMs)           │
            │  • Verify via OracleSignatureVerifier  │
            │  Returns null on any failure ↦         │
            │     liabilityUnknown=true downstream   │
            └────────────────────┬───────────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │   Secp256k1OracleSignatureVerifier  │
              │   (packages/custody-adapters)       │
              │                                     │
              │   • per-oracleId pinned keys        │
              │   • multi-key rotation windows      │
              │   • lowS-canonical enforcement      │
              │   • configurable hash function      │
              └─────────────────────────────────────┘
                                 │
                                 ▼
                ┌───────────────────────────────┐
                │  captureLiabilitySnapshot     │
                │  (packages/custody-adapters)  │
                │                               │
                │  Always returns an event:     │
                │  - on success → with snapshot │
                │  - on null    → with          │
                │     liabilityUnknown=true     │
                │  Bound digest = SHA-256(      │
                │    txId | custodianId |       │
                │    snapshot)                  │
                └──────────────┬────────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │  recordLiabilitySnapshot       │
              │  (packages/custody-adapters)   │
              │  emits AuditEvent kind:        │
              │  "custodian-liability-         │
              │   snapshot"                    │
              └──────────────┬─────────────────┘
                             │
                             ▼
              ┌────────────────────────────────┐
              │  AuditCapture (continued)      │
              │  Both events now in the chain  │
              │  AuditCapture.verifyChain([    │
              │    matrix, liability,          │
              │    ... policy events ...])     │
              │  → true                        │
              └────────────────────────────────┘
```

---

## Components

### 1. `JurisdictionalConflictResolver`

**Package:** `@aethelred/wallet-compliance`
**Source:** `packages/compliance/src/jurisdictional-conflict-resolver.ts`
**Tests:** `apps/extension/src/test/jurisdictional-conflict-resolver.test.ts`
**Introduced:** PR #147

The dynamic compliance state matrix. Replaces the static "regulatory
passport" with per-transaction conflict resolution.

**Inputs:**
- `transactionId` — opaque id used for digest binding
- `jurisdictions` — ISO 3166-1 alpha-2 codes touched by the transaction
- `hierarchy` — per-tenant `LegalHierarchy` (default ordering + optional per-axis overrides)

**Outputs:**
- `MatrixResolution.conflictsFound` — every axis where jurisdictions disagreed
- `MatrixResolution.resolutions` — winning rule per conflict, with rationale
- `MatrixResolution.digest` — SHA-256 of canonical-JSON serialization (audit-chain ready)

**Key invariants pinned by tests:**
- Fail-closed on unranked jurisdictions (`UnrankedJurisdictionError`)
- Digest is stable under input-jurisdiction permutation (canonical sort)
- Digest changes when transaction id, jurisdictions, or hierarchy ordering change
- Per-axis overrides honored

### 2. `JsonFeedLiabilityAttestor`

**Package:** `@aethelred/wallet-custody-adapters`
**Source:** `packages/custody-adapters/src/json-feed-attestor.ts`
**Tests:** `apps/extension/src/test/json-feed-liability-attestor.test.ts`
**Introduced:** PR #152

Reference implementation of `LiabilityAttestor` for any signed JSON
HTTP feed. Consumes the most common vendor pattern.

**Failure modes (all return `null`, never throw):**
- Network: fetch throws, non-2xx status, AbortController timeout
- Parse: non-JSON body, missing fields, wrong types, malformed coverage
- Freshness: snapshot older than `maxAgeMs` (default 10 min) or future-dated
- Signature: verifier returns false OR throws

**Forward-compat:** unknown extra fields in the feed are tolerated.

### 3. `Secp256k1OracleSignatureVerifier`

**Package:** `@aethelred/wallet-custody-adapters`
**Source:** `packages/custody-adapters/src/secp256k1-oracle-verifier.ts`
**Tests:** `apps/extension/src/test/secp256k1-oracle-verifier.test.ts`
**Introduced:** PR #153

Production-grade `OracleSignatureVerifier` — pin one or more
secp256k1 public keys per `oracleId`, verify signatures with
`lowS: true` enforcement, default sha256 hash (configurable).

**Security properties:**
- **Per-oracleId pinning** — a valid signature from oracle A on a
  payload claiming `oracleId: B` is rejected (no key-swap attacks)
- **Rotation windows** — multiple keys per oracleId verify during
  rotation
- **Cross-hash forgery defense** — sha256-signed payload rejected
  when verifier expects custom hash

### 4. `captureLiabilitySnapshot`

**Package:** `@aethelred/wallet-custody-adapters`
**Source:** `packages/custody-adapters/src/liability-attestation.ts`
**Tests:** `apps/extension/src/test/liability-attestation.test.ts`
**Introduced:** PR #148

The orchestrator that calls an `LiabilityAttestor` and wraps the
result into a `LiabilitySnapshotEvent` with a transaction-bound
SHA-256 digest.

**Critical invariant:** always returns an event, never throws. When
the attestor returns null, the event is stamped `liabilityUnknown:
true`. This is the suppression defense — without it, an attacker
who knocked over the oracle could hide the gap from auditors.

### 5. `AuditCapture` + integration helpers

**Package:** `@aethelred/wallet-audit`
**Source:** `packages/audit/src/event-capture.ts`
**Wiring:** `recordMatrixResolution` (compliance) +
  `recordLiabilitySnapshot` (custody-adapters)
**Tests:** `apps/extension/src/test/audit-chain-compliance-custody-wiring.test.ts`
**Introduced:** Wiring in PR #150 (audit chain itself predates this work)

The tamper-evident hash-chained event store. Every event includes
the previous event's hash so `verifyChain` rejects any mutation.

The integration helpers (`recordMatrixResolution`,
`recordLiabilitySnapshot`) live in the source package of each
domain, not in `wallet-audit` itself, to avoid circular imports.
The `wallet-audit` package stays unaware of compliance / custody
domain types.

---

## End-to-end example

The canonical example lives in
`apps/extension/src/test/institutional-compliance-pipeline.test.ts`
(PR #154). Three tests demonstrate:

1. **Happy path** — UAE×Singapore \$5M scenario; matrix detects
   data-exposure conflict; UAE-first hierarchy → VARA wins;
   custodian liability fetched + verified + recorded; verifyChain
   returns true.
2. **Adversarial** — feed signed by attacker key; verifier rejects;
   `liabilityUnknown: true` event still records (suppression
   defense); transaction NOT blocked.
3. **Operational** — 5-tx batch with matrix + liability per
   transaction; 10 audit events total; verifyChain across the full
   sequence holds.

If you're adding a new component to the pipeline, extend that test
file with a scenario that exercises your component end-to-end.

---

## When to add or extend a component

### Adding a new conflict axis

If a new jurisdictional axis becomes relevant (e.g., FATF travel-rule
v2 introduces a new disclosure dimension), the pattern is:

1. Add the axis to the `ConflictAxis` union in
   `jurisdictional-conflict-resolver.ts`.
2. Extend the exhaustive switch in `extractAxisValue` — TypeScript's
   `never` exhaustiveness check fails the build until you do.
3. Add a test case verifying detection on that axis.
4. Document in the `## Components` section above.

### Adding a new custodian

For a new tier-1 custodian (e.g., Coinbase Custody, BitGo):

1. Add the canonical id to `CUSTODIAN_IDS` in
   `liability-attestation.ts`.
2. If the custodian has a signed JSON oracle, point a
   `JsonFeedLiabilityAttestor` at it. No new code required.
3. If the custodian has a non-JSON or non-secp256k1 attestation
   protocol, write a custom `LiabilityAttestor` (or
   `OracleSignatureVerifier`) implementing the documented
   never-throw contract.
4. Update the integration test with a scenario through the new
   custodian.

### Adding a new oracle signature scheme

`Secp256k1OracleSignatureVerifier` covers the most common case. For
Ed25519, BLS, or schemes specific to a hardware enclave:

1. Implement `OracleSignatureVerifier` interface (one method,
   `verify({oracleId, payload, signature})`).
2. Mirror the property tests from
   `secp256k1-oracle-verifier.test.ts` — never-throw contract,
   per-oracleId pinning, rotation windows, tamper detection.

---

## What the pipeline does NOT do

- **Vendor-specific oracle implementations.** The pipeline ships
  reference attestors and verifiers; production deployments wire
  vendor-specific endpoints + key material at the application layer.
- **AML transaction screening.** That's `TransactionScreeningEngine`
  in the same compliance package — separate domain, different
  pipeline.
- **Settlement liveness.** The pipeline records the compliance state
  *of* a transaction; the actual on-chain submission happens
  elsewhere (custody adapters' `signTypedData` /
  `signRawTransaction`, intent router's `settle`).
- **Block retail / startup access.** The pipeline's friction is
  intentional for institutional users. See
  [`WHY_INSTITUTIONAL.md`](../strategy/WHY_INSTITUTIONAL.md).

---

## Related strategy docs

- [`docs/strategy/WHY_INSTITUTIONAL.md`](../strategy/WHY_INSTITUTIONAL.md)
  — why this pipeline targets tier-1 institutions only and why a
  "lite developer tier" would harm the wallet's MiCA / VARA / MAS
  registrations.

## Source PRs

| PR | Subject |
|---|---|
| #147 | `JurisdictionalConflictResolver` — dynamic compliance state matrix |
| #148 | Custodian liability attestation in audit chain |
| #149 | `WHY_INSTITUTIONAL.md` — strategic positioning |
| #150 | Audit-chain wiring helpers (`recordMatrixResolution`, `recordLiabilitySnapshot`) |
| #152 | `JsonFeedLiabilityAttestor` — reference attestor |
| #153 | `Secp256k1OracleSignatureVerifier` — production verifier |
| #154 | End-to-end pipeline integration test |
