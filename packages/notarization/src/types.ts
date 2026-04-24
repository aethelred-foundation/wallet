/**
 * `@aethelred/wallet-notarization` — type surface.
 *
 * Three shapes:
 *
 *   1. **AnchorChainProvider** — minimal RPC contract for submitting
 *      a transaction and reading a receipt. Same pluggable pattern
 *      as `@aethelred/wallet-agent-budget` — keeps this package
 *      free of viem/ethers hard deps.
 *
 *   2. **OnChainBatchRecord** — the batch data as recorded
 *      on-chain, decoded from `BatchAnchored` event logs: batchId,
 *      submitter, merkleRoot, eventCount, timestamp, blockNumber,
 *      txHash.
 *
 *   3. **AnchoredProof** — a Merkle inclusion proof (from the audit
 *      package) bundled with the `OnChainBatchRecord` so verifiers
 *      can check *both* the proof AND that the root is genuinely
 *      anchored on-chain.
 */

import type {
  FinalizedBatch,
  MerkleProof,
  NotarizationReceipt,
} from "@aethelred/wallet-audit";

// ─── Chain provider ──────────────────────────────────────

/**
 * Minimal RPC the anchor client needs. Pluggable: viem, ethers, or
 * a custom JSON-RPC adapter.
 */
export interface AnchorChainProvider {
  readonly chainId: number;
  /**
   * Submit a transaction. Returns the tx hash. The client polls via
   * `getTransactionReceipt` to confirm. Submitter / gas / nonce
   * management is the implementation's concern.
   */
  sendTransaction(request: {
    readonly to: `0x${string}`;
    readonly data: `0x${string}`;
    readonly value?: bigint;
  }): Promise<`0x${string}`>;
  /** Return receipt or `null` if the tx isn't mined yet. */
  getTransactionReceipt(txHash: `0x${string}`): Promise<TxReceipt | null>;
}

export interface TxReceipt {
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: bigint;
  readonly status: "success" | "reverted";
  readonly logs: ReadonlyArray<RawLog>;
  /**
   * Gas consumed by this transaction (`eth_getTransactionReceipt`'s
   * `gasUsed` field). Optional so existing test doubles without this
   * field continue to typecheck — real RPC responses include it.
   *
   * Solvers that want per-intent gas telemetry surface this through
   * their `Fill.metadata`; the observability package can aggregate
   * per-solver histograms from the audit stream.
   */
  readonly gasUsed?: bigint;
  /**
   * Effective gas price paid on this transaction
   * (`eth_getTransactionReceipt`'s `effectiveGasPrice` field — the
   * post-1559 actual price). Optional for the same reason as
   * `gasUsed`. Together with `gasUsed` these let consumers compute
   * a full tx cost in wei.
   */
  readonly effectiveGasPrice?: bigint;
}

export interface RawLog {
  readonly address: `0x${string}`;
  readonly topics: ReadonlyArray<`0x${string}`>;
  readonly data: `0x${string}`;
  readonly blockNumber: bigint;
  readonly transactionHash: `0x${string}`;
  readonly logIndex: number;
}

// ─── On-chain record ────────────────────────────────────

/**
 * Decoded `BatchAnchored` event record. This is what the verifier
 * checks an inclusion proof against. All fields are deterministic
 * and externally reproducible — given a `batchId` + the contract
 * address, anyone can fetch the same record via `eth_getLogs`.
 */
export interface OnChainBatchRecord {
  readonly batchId: bigint;
  readonly submitter: `0x${string}`;
  readonly merkleRoot: `0x${string}`;
  readonly eventCount: number;
  readonly timestamp: bigint;
  readonly blockNumber: bigint;
  readonly transactionHash: `0x${string}`;
  readonly chainId: number;
  readonly contract: `0x${string}`;
}

// ─── Anchor receipt ──────────────────────────────────────

/**
 * Enhanced receipt returned by the on-chain implementation of the
 * audit package's `BatchNotarizationAdapter`. Includes the raw
 * `NotarizationReceipt` (audit-layer contract) plus the full
 * `OnChainBatchRecord` (notarization-layer detail).
 */
export interface AnchoredReceipt extends NotarizationReceipt {
  readonly record: OnChainBatchRecord;
}

// ─── Anchored inclusion proof ────────────────────────────

/**
 * `MerkleProof` + `OnChainBatchRecord`. Verifiers check that:
 *
 *   1. The Merkle proof's root matches `record.merkleRoot`.
 *   2. The proof itself verifies against `record.merkleRoot`.
 *   3. (Caller's job) The `record` matches what the contract
 *      emitted at `record.batchId`.
 *
 * Step 3 is external because it requires an RPC call; the proof
 * itself is a purely self-contained document that can be handed to
 * an auditor.
 */
export interface AnchoredProof {
  readonly proof: MerkleProof;
  readonly record: OnChainBatchRecord;
  readonly eventId: string;
  readonly subjectId?: string;
}

// ─── Scheduler ───────────────────────────────────────────

/**
 * Drives `NotarizationService.anchorPending()` on a cadence. Clock
 * + setTimeout are pluggable so tests drive `tick()` manually
 * without wall-clock delay.
 */
export interface SchedulerClock {
  now(): number;
  /** Schedule a callback. Returns a handle that can be cancelled. */
  setTimeout(callback: () => void, ms: number): SchedulerTimerHandle;
}

export interface SchedulerTimerHandle {
  cancel(): void;
}

// ─── Re-exports ─────────────────────────────────────────

export type { FinalizedBatch, MerkleProof, NotarizationReceipt };
