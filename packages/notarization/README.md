# `@aethelred/wallet-notarization`

On-chain anchoring for the off-chain audit Merkle trail.

Every cadence tick (default 15 min), the scheduler finalizes the
pending `MerkleBatch` from `@aethelred/wallet-audit` and anchors its
root to a `Notary` smart contract. Given any audit event, anyone can
produce an `AnchoredProof` — Merkle inclusion proof + on-chain batch
record — that regulators verify cryptographically, without trusting
the operator's database.

## Why this package exists

MoltPe's audit trail lives in MoltPe's database. When regulators ask
"prove this event existed at this time and hasn't been altered,"
MoltPe hands them a DB dump. The trust chain is:

```
regulator → MoltPe's ops policy → MoltPe's DB → the event
```

Cryptographic anchoring flips this:

```
regulator → Ethereum consensus → Notary contract → Merkle root → the event
```

The operator can disappear, be acquired, get hacked — the on-chain
root stands. Any verifier with internet access can check the proof.

## Pipeline

```
audit events ──▶ MerkleBatch (off-chain, in-memory)
                   │
                   │  every 15 min (NotarizationScheduler)
                   ▼
                 finalize()  ──▶  FinalizedBatch { root, leaves }
                                        │
                                        ▼
                              OnChainAnchorAdapter
                                   .notarize(batch)
                                        │
                                        ▼
                          anchor(root, eventCount) → Notary
                                        │
                                        ▼
                            BatchAnchored(batchId, root, ...)
                                        │
                                        ▼
                            OnChainBatchRecord (stored)
```

Anyone later builds an `AnchoredProof`:

```
verifier ──▶ buildAnchoredProof({ proof, record, eventId })
                   │
                   ▼
             verifyAnchoredProof(bundle)
              ├─ checks proof.root === record.merkleRoot
              └─ checks Merkle inclusion verifies

         + (optional, needs RPC)
             compareRecords(declared, onChain)
              └─ confirms the record matches live chain state
```

## Quick start

```ts
import {
  OnChainAnchorAdapter,
  NotarizationScheduler,
  SystemClock,
  buildAnchoredProof,
  verifyAnchoredProof,
} from "@aethelred/wallet-notarization";
import { MerkleBatch } from "@aethelred/wallet-audit";

// 1. Wire the pipeline.
const batch = new MerkleBatch({ maxBatchSize: 256, maxBatchAgeMs: 60_000 });
const adapter = new OnChainAnchorAdapter({
  provider: myChainProvider,   // viem / ethers / custom
  contract: NOTARY_ADDRESS,
  chainId: 1,                  // mainnet
});
const scheduler = new NotarizationScheduler({
  batch,
  adapter,
  clock: SystemClock,
  intervalMs: 15 * 60_000,
  onTick: (r) => {
    if (r.error) metrics.alert("anchor_failed", { error: r.error.message });
  },
});

// 2. Feed events.
audit.onEvent((event) => batch.add(event));

// 3. Start the cadence.
scheduler.start();

// --- later: regulator asks for proof of a specific event ---
const proof = batch.getProof(event.eventHash);   // audit package
const record = lookupRecordFor(proof.root);      // operator's own index
const bundle = buildAnchoredProof({ proof, record, eventId: event.id });
verifyAnchoredProof(bundle);                     // crypto check; throws on bad
// hand `bundle` + Notary contract address to the regulator.
```

## Contract

```solidity
contract Notary {
  struct Batch {
    address submitter;
    uint64  timestamp;
    uint32  eventCount;
    bytes32 merkleRoot;
  }
  mapping(uint256 => Batch) public batches;
  uint256 public nextBatchId;

  event BatchAnchored(
    uint256 indexed batchId,
    address indexed submitter,
    bytes32 indexed merkleRoot,
    uint64 timestamp,
    uint32 eventCount
  );

  function anchor(bytes32 merkleRoot, uint32 eventCount) returns (uint256 batchId);
  function getBatch(uint256 batchId) view returns (Batch memory);
}
```

The contract is **pure storage** — it stores the Merkle root as an
opaque `bytes32` without re-hashing or verifying any proof. On-chain
inclusion-proof verification is gas-expensive and rarely useful; the
value here is the immutable `(submitter, timestamp, root)` record,
not on-chain verification. Off-chain verifiers do the Merkle math.

Not deployed from this repo. TS selectors derive from the signature
strings via `keccak256(sig)[0..4]` so any deployment that matches
this ABI works.

## Scheduler clocks

- **`SystemClock`** — wraps `Date.now` + `setTimeout`. Production.
- **`TestClock`** — manual `advance(ms)` drives ticks deterministic-
  ally; timers fire in `fireAt` order with ties broken on insertion.

Both implement the `SchedulerClock` interface — callers can plug any
clock source (Temporal, a centrally-coordinated monotonic clock for
multi-instance deployments, etc.).

## Error codes

Stable codes; callers branch on `code`:

| Category | Codes |
| -------- | ----- |
| Input   | `batch-malformed`, `batch-empty`, `root-zero`, `event-count-zero`, `chain-id-mismatch` |
| Submit  | `anchor-submit-failed`, `anchor-receipt-missing`, `anchor-receipt-malformed`, `anchor-tx-reverted`, `anchor-confirmation-timeout` |
| Proof   | `proof-merkle-invalid`, `proof-root-mismatch`, `proof-record-mismatch` |
| Scheduler | `scheduler-already-running`, `scheduler-stopped` |
| Lifecycle | `service-disposed` |

## What this package DOES NOT do

- Submit the transaction. Provider does that. We encode calldata +
  parse receipts.
- Verify inclusion proofs on-chain. Too expensive; do it off-chain
  where CPU is free.
- Maintain a durable ledger of `OnChainBatchRecord`s. Operators
  persist them in their own DB; the scheduler just returns each
  record in the `onTick` callback.
- Rebuild Merkle trees — the audit package owns that. We wrap its
  `FinalizedBatch` and push roots on-chain.

## Composition with the rest of the stack

- **Audit** (`@aethelred/wallet-audit`): `MerkleBatch` → root. This
  package's `OnChainAnchorAdapter` IS the audit package's
  `BatchNotarizationAdapter` — plug it directly into
  `batch.setNotarizationAdapter()`.
- **Sovereign-export** (`@aethelred/wallet-sovereign-export`): SAR /
  CTR / GDPR / MiCA payloads can attach `AnchoredProof`s for every
  referenced audit event — regulators verify cryptographically.
- **Custody adapters** (`@aethelred/wallet-custody-adapters`): the
  `AnchorChainProvider.sendTransaction` wraps a wallet signer; TEE-
  rooted operators route it through a Nitro adapter so the signing
  key never touches disk.

## Testing

```bash
npx vitest run notarization
```

31 tests cover: ABI-selector derivation (regression guard), calldata
encoders + reject paths (zero root, zero count, uint32 overflow,
malformed bytes32), event-log decoding + non-matching topic skip +
missing-log error, `OnChainAnchorAdapter` happy path + every failure
mode (chain mismatch, submit failure, revert, missing event,
root-emitted mismatch, empty batch, poll timeout), `NotarizationScheduler`
(tick finalize→notarize→callback, empty batch no-op, adapter throw
captured in result, start/stop/double-start/start-after-stop
lifecycle, `TestClock`-driven ticks), `AnchoredProof` (build with
root cross-check, verify on legitimate, tamper detection,
compareRecords mismatch enumeration).
