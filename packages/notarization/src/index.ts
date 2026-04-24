/**
 * `@aethelred/wallet-notarization` — on-chain anchoring for the
 * off-chain audit Merkle trail.
 *
 * Every cadence tick (default 15 min), the scheduler finalizes the
 * pending `MerkleBatch` and anchors its root to the Notary
 * contract via an `OnChainAnchorAdapter`. The resulting
 * `OnChainBatchRecord` is the regulator-facing tamper-evident
 * handle: given any audit event, anyone can produce an
 * `AnchoredProof` (Merkle inclusion proof + on-chain record) and
 * verify it without trusting the operator's database.
 *
 * @packageDocumentation
 */

// ─── Types ────────────────────────────────────────────────
export type {
  AnchorChainProvider,
  TxReceipt,
  RawLog,
  OnChainBatchRecord,
  AnchoredReceipt,
  AnchoredProof,
  SchedulerClock,
  SchedulerTimerHandle,
  FinalizedBatch,
  MerkleProof,
  NotarizationReceipt,
} from "./types";

// ─── Errors ───────────────────────────────────────────────
export { NotarizationError } from "./errors";
export type { NotarizationErrorCode } from "./errors";

// ─── ABI ──────────────────────────────────────────────────
export {
  SIG_ANCHOR,
  SIG_GET_BATCH,
  SIG_NEXT_BATCH_ID,
  SELECTOR_ANCHOR,
  SELECTOR_GET_BATCH,
  SELECTOR_NEXT_BATCH_ID,
  SIG_EVENT_BATCH_ANCHORED,
  TOPIC_BATCH_ANCHORED,
} from "./abi";

// ─── Calldata ─────────────────────────────────────────────
export {
  encodeAnchor,
  encodeGetBatch,
  parseBatchAnchoredLog,
  extractAnchoredRecord,
} from "./calldata";
export type { AnchorArgs } from "./calldata";

// ─── Anchor client ────────────────────────────────────────
export { OnChainAnchorAdapter } from "./anchor-client";
export type { OnChainAnchorAdapterConfig } from "./anchor-client";

// ─── Scheduler ────────────────────────────────────────────
export {
  NotarizationScheduler,
  SystemClock,
  TestClock,
} from "./scheduler";
export type {
  NotarizationSchedulerConfig,
  NotarizationTickResult,
  SchedulerState,
} from "./scheduler";

// ─── Inclusion proofs ─────────────────────────────────────
export {
  buildAnchoredProof,
  verifyAnchoredProof,
  compareRecords,
} from "./inclusion";
export type { BuildAnchoredProofArgs } from "./inclusion";
