import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { AuditError } from "./errors";
import type { AuditEvent } from "./types";

/**
 * Configuration for a {@link MerkleBatch}.
 *
 * @remarks
 * The defaults (256 events / 60 seconds) are tuned so that a typical
 * wallet can produce roughly one Merkle root per minute under load while
 * still bounding batch latency when the event stream is quiet. Tests
 * typically set very small values to force deterministic finalization.
 *
 * @example
 * ```ts
 * const batch = new MerkleBatch({ maxBatchSize: 32, maxBatchAgeMs: 10_000 });
 * ```
 */
export interface MerkleBatchConfig {
  /**
   * Maximum number of events that may accumulate in the open batch before
   * {@link MerkleBatch.add} triggers an automatic finalization. Defaults to
   * `256`.
   */
  maxBatchSize?: number;
  /**
   * Maximum wall-clock time, in milliseconds, that the open batch may stay
   * open before the next {@link MerkleBatch.add} call finalizes it.
   * Defaults to `60_000` (one minute).
   */
  maxBatchAgeMs?: number;
}

/**
 * Per-event inclusion proof produced by {@link MerkleBatch.getProof} and
 * verified by {@link verifyMerkleProof}.
 *
 * @remarks
 * The proof captures everything an auditor needs to recompute the Merkle
 * root from a single leaf: the leaf hash itself, the sibling hash at each
 * tree level, the left/right position at each level, and the expected
 * root. `leafIndex` is retained so callers can locate the leaf in the
 * original event stream without re-running the tree.
 */
export interface MerkleProof {
  /** Hex-encoded SHA-256 hash of the audit event being proven. */
  leaf: string;
  /** Sibling hashes from leaf level up to (but not including) the root. */
  siblings: string[];
  /**
   * Direction of this node at each level: `0` if this node is the left
   * child of its parent, `1` if it is the right child. Indices align with
   * {@link MerkleProof.siblings}.
   */
  directions: number[];
  /** Hex-encoded Merkle root that this proof verifies against. */
  root: string;
  /** Zero-based index of this leaf in the finalized batch. */
  leafIndex: number;
}

/**
 * Immutable record of a finalized Merkle batch.
 *
 * @remarks
 * Finalized batches are the unit of notarization — each root is what gets
 * eventually published to the Aethelred L1. `proofs` is a pre-computed
 * cache of per-event inclusion proofs so auditors can export the full
 * evidence bundle without having to rebuild the tree themselves.
 */
export interface FinalizedBatch {
  /** Unique batch identifier (format `batch-<16-hex>`). */
  batchId: string;
  /** Hex-encoded Merkle root of all events in this batch. */
  root: string;
  /** Number of audit events included in the batch (leaf count). */
  leafCount: number;
  /** Lowest `sequenceNumber` present in the batch (inclusive). */
  firstSequenceNumber: number;
  /** Highest `sequenceNumber` present in the batch (inclusive). */
  lastSequenceNumber: number;
  /** Unix timestamp in milliseconds when the batch was finalized. */
  finalizedAt: number;
  /**
   * Per-event inclusion proofs indexed by `eventHash`. Lookup is O(1)
   * because the same hex string is also the Merkle leaf hash — see
   * {@link MerkleBatch.getProof} for usage.
   */
  proofs: Record<string, MerkleProof>;
}

/**
 * Adapter interface for publishing finalized batch roots to an external
 * system (in production: the Aethelred L1).
 *
 * @remarks
 * Implementations must be side-effect-only with respect to the batch —
 * they should not mutate the {@link FinalizedBatch} argument. The adapter
 * owns retry / backoff semantics; {@link MerkleBatch.notarizeFinalized}
 * simply awaits whatever the adapter returns.
 *
 * @example
 * ```ts
 * const stub: BatchNotarizationAdapter = {
 *   async notarize(batch) {
 *     return {
 *       batchId: batch.batchId,
 *       externalId: "0x" + batch.root,
 *       publishedAt: Date.now(),
 *     };
 *   },
 * };
 * ```
 */
export interface BatchNotarizationAdapter {
  /** Publish a finalized batch root and return the external receipt. */
  notarize(batch: FinalizedBatch): Promise<NotarizationReceipt>;
}

/**
 * Receipt returned by {@link BatchNotarizationAdapter.notarize}.
 *
 * @remarks
 * `externalId` is the foreign-system identifier — typically an L1
 * transaction hash when the adapter is wired to production. `verifyUrl`
 * is optional because not every backend exposes a human-facing verifier.
 */
export interface NotarizationReceipt {
  /** Matches the `batchId` of the notarized {@link FinalizedBatch}. */
  batchId: string;
  /**
   * Foreign-system identifier for the publication (e.g. an L1 transaction
   * hash). Opaque to the batch layer; auditors use it to independently
   * fetch the published root.
   */
  externalId: string;
  /** Unix timestamp in milliseconds when publication completed. */
  publishedAt: number;
  /**
   * Optional URL where an auditor can externally verify the publication.
   * Populated when the adapter has a human-facing explorer.
   */
  verifyUrl?: string;
}

/**
 * Error thrown for illegal {@link MerkleBatch} usage — e.g. adding the
 * same event twice, or producing a proof for a hash not in any known
 * batch.
 *
 * @remarks
 * Subclass of {@link AuditError} so downstream handlers can treat it
 * uniformly with other audit-pipeline errors.
 */
export class MerkleBatchError extends AuditError {
  constructor(message: string) {
    super(message);
    this.name = "MerkleBatchError";
  }
}

const DEFAULT_MAX_BATCH_SIZE = 256;
const DEFAULT_MAX_BATCH_AGE_MS = 60_000;

/** @internal Hex regex used to validate externally supplied proofs. */
const HEX64_RE = /^[0-9a-f]{64}$/;

/**
 * Hash two child nodes into their parent using the canonical construction
 * `sha256(leftBytes || rightBytes)`.
 *
 * @remarks
 * Children are hex strings by convention (matches
 * {@link AuditEvent.eventHash}); we decode to bytes, concatenate, and
 * hash the raw 64-byte buffer. Hex -> bytes -> hash -> hex is intentional:
 * it keeps all public hashes as hex strings, which is what downstream
 * export / notarization code already consumes.
 */
function hashPair(left: string, right: string): string {
  const l = hexToBytes(left);
  const r = hexToBytes(right);
  const combined = new Uint8Array(l.length + r.length);
  combined.set(l, 0);
  combined.set(r, l.length);
  return bytesToHex(sha256(combined));
}

/** @internal Fresh 16-byte random batch identifier. */
function generateBatchId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `batch-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * @internal
 * Build the full Merkle tree from a list of leaf hashes and return the
 * intermediate levels bottom-up (level 0 is leaves, last entry is the
 * one-element root level).
 *
 * We use the canonical "double-odd" rule: if a level has an odd number of
 * nodes we duplicate the last node to pair it. This matches the widely
 * deployed Bitcoin / BIP141 construction and keeps the tree balanced
 * without requiring callers to pad the event stream themselves.
 */
function buildLevels(leaves: string[]): string[][] {
  const levels: string[][] = [leaves];
  let current = leaves;
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      // Duplicate last node on odd count — canonical "double-odd" rule.
      const right = i + 1 < current.length ? current[i + 1] : left;
      next.push(hashPair(left, right));
    }
    levels.push(next);
    current = next;
  }
  return levels;
}

/**
 * @internal
 * Construct inclusion proofs for every leaf in a tree given its levels.
 * Produced proofs are self-contained — they capture both the sibling
 * hashes and the left/right position at each level, which is what
 * {@link verifyMerkleProof} needs to recompute the root.
 */
function buildProofs(levels: string[][], root: string): MerkleProof[] {
  const leaves = levels[0];
  const proofs: MerkleProof[] = [];

  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    const siblings: string[] = [];
    const directions: number[] = [];

    let index = leafIndex;
    for (let level = 0; level < levels.length - 1; level++) {
      const nodes = levels[level];
      const isRight = index % 2 === 1;
      // If no right sibling exists, the double-odd rule duplicates this
      // node as its own sibling — otherwise pick the actual neighbor.
      const siblingIndex = isRight ? index - 1 : index + 1;
      const sibling = siblingIndex < nodes.length ? nodes[siblingIndex] : nodes[index];
      siblings.push(sibling);
      directions.push(isRight ? 1 : 0);
      index = Math.floor(index / 2);
    }

    proofs.push({
      leaf: leaves[leafIndex],
      siblings,
      directions,
      root,
      leafIndex,
    });
  }

  return proofs;
}

/**
 * Standalone verifier for a {@link MerkleProof}.
 *
 * @remarks
 * This function is the load-bearing piece of the moat: an auditor who
 * only trusts their own code can call it with a proof bundle and confirm
 * that an event was present in the batch whose root was published
 * externally. It never touches batch state, disk, or the network.
 *
 * A proof is valid iff:
 *  1. The leaf and every sibling are lowercase 64-char hex (SHA-256 size).
 *  2. The leaf / sibling / direction arrays have consistent lengths.
 *  3. Rolling `sha256(left || right)` from the leaf up yields the stated
 *     root.
 *
 * @example
 * ```ts
 * const proof = batch.getProof(event.eventHash);
 * if (proof && verifyMerkleProof(proof)) {
 *   console.log("event is provably included in batch root", proof.root);
 * }
 * ```
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  if (!proof || typeof proof !== "object") return false;
  if (!HEX64_RE.test(proof.leaf)) return false;
  if (!HEX64_RE.test(proof.root)) return false;
  if (!Array.isArray(proof.siblings) || !Array.isArray(proof.directions)) return false;
  if (proof.siblings.length !== proof.directions.length) return false;
  for (const s of proof.siblings) {
    if (!HEX64_RE.test(s)) return false;
  }
  for (const d of proof.directions) {
    if (d !== 0 && d !== 1) return false;
  }

  // Single-leaf batch: root == leaf, no siblings involved.
  if (proof.siblings.length === 0) {
    return proof.leaf === proof.root;
  }

  let current = proof.leaf;
  for (let i = 0; i < proof.siblings.length; i++) {
    const sibling = proof.siblings[i];
    const direction = proof.directions[i];
    // direction 1 means "this node was the right child" — sibling on left.
    const left = direction === 1 ? sibling : current;
    const right = direction === 1 ? current : sibling;
    current = hashPair(left, right);
  }

  return current === proof.root;
}

/**
 * Merkle-batching layer on top of the hash-chained audit log.
 *
 * @remarks
 * Where {@link AuditCapture} provides *internal* tamper-evidence (each
 * event's `previousHash` covers its predecessor), `MerkleBatch` provides
 * *external* tamper-evidence: batches of events are periodically reduced
 * to a single Merkle root, and that root is published to a system the
 * Aethelred Foundation does not control (eventually the Aethelred L1).
 * Auditors can then independently verify that any specific event was
 * present in a batch whose root was externally notarized, without
 * trusting wallet internals.
 *
 * The class deliberately stays in-memory: finalized batches are retained
 * so that {@link getProof} and {@link notarizeFinalized} can operate over
 * them, but durability is the caller's responsibility (typically a
 * follow-up step writes the notarization receipts through
 * {@link AuditStore}). This keeps the primitive free of storage coupling.
 *
 * @example
 * ```ts
 * const batch = new MerkleBatch({ maxBatchSize: 16 });
 * for (const event of events) batch.add(event);
 * const finalized = batch.finalize();
 * if (finalized) {
 *   batch.setNotarizationAdapter(myL1Adapter);
 *   const receipts = await batch.notarizeFinalized();
 * }
 * ```
 */
export class MerkleBatch {
  private readonly maxBatchSize: number;
  private readonly maxBatchAgeMs: number;

  private pending: AuditEvent[] = [];
  /** Wall-clock time (ms) at which the currently open batch was opened. */
  private batchOpenedAt: number | null = null;
  /**
   * Guard against duplicate `eventHash` being added to the same open
   * batch. Duplicates would corrupt the per-event proof lookup, so we
   * reject them outright rather than silently deduplicate.
   */
  private readonly pendingHashes: Set<string> = new Set();

  private readonly finalizedBatches: FinalizedBatch[] = [];
  /** Map from `eventHash` -> owning finalized batch, for fast proof lookup. */
  private readonly proofIndex: Map<string, FinalizedBatch> = new Map();

  private adapter: BatchNotarizationAdapter | null = null;
  /** Set of batchIds that have already been successfully notarized. */
  private readonly notarized: Set<string> = new Set();

  constructor(config: MerkleBatchConfig = {}) {
    this.maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    this.maxBatchAgeMs = config.maxBatchAgeMs ?? DEFAULT_MAX_BATCH_AGE_MS;

    if (!Number.isInteger(this.maxBatchSize) || this.maxBatchSize < 1) {
      throw new MerkleBatchError(
        `maxBatchSize must be a positive integer, got ${String(config.maxBatchSize)}`,
      );
    }
    if (!Number.isFinite(this.maxBatchAgeMs) || this.maxBatchAgeMs < 1) {
      throw new MerkleBatchError(
        `maxBatchAgeMs must be a positive number, got ${String(config.maxBatchAgeMs)}`,
      );
    }
  }

  /**
   * Add an audit event to the currently open batch.
   *
   * @remarks
   * The event's existing `eventHash` is reused as the Merkle leaf — the
   * AuditCapture pipeline already computes a SHA-256 hash over the event
   * body chained with the previous event's hash, so re-hashing here would
   * (a) waste work and (b) let an attacker who tampered with the event
   * body still satisfy a Merkle proof by substituting a crafted leaf.
   * Reusing `eventHash` as the leaf keeps both layers in agreement.
   *
   * Auto-finalization fires when either the size or age threshold is
   * crossed. The auto-finalized batch is retained internally for proof
   * lookup and notarization.
   *
   * @throws MerkleBatchError if the event's `eventHash` is malformed or
   *   duplicates one already staged in the open batch.
   */
  add(event: AuditEvent): void {
    if (!event || typeof event.eventHash !== "string" || !HEX64_RE.test(event.eventHash)) {
      throw new MerkleBatchError(
        `event.eventHash must be a 64-char lowercase hex string, got ${String(event?.eventHash)}`,
      );
    }

    // Age-based auto-finalization runs BEFORE accepting the new event so
    // the new event opens a fresh batch instead of joining a stale one.
    if (
      this.batchOpenedAt !== null &&
      Date.now() - this.batchOpenedAt >= this.maxBatchAgeMs &&
      this.pending.length > 0
    ) {
      this.finalize();
    }

    if (this.pendingHashes.has(event.eventHash)) {
      throw new MerkleBatchError(
        `duplicate eventHash in open batch: ${event.eventHash}`,
      );
    }

    if (this.pending.length === 0) {
      this.batchOpenedAt = Date.now();
    }
    this.pending.push(event);
    this.pendingHashes.add(event.eventHash);

    // Size-based auto-finalization runs AFTER accepting the event so the
    // event that completes the batch is actually included in it.
    if (this.pending.length >= this.maxBatchSize) {
      this.finalize();
    }
  }

  /** Number of events currently staged in the open (un-finalized) batch. */
  getCurrentBatchSize(): number {
    return this.pending.length;
  }

  /**
   * Close the current batch and return a {@link FinalizedBatch}.
   *
   * @remarks
   * Returns `null` when the open batch is empty — callers don't need to
   * track this themselves. After finalization the batch is retained in
   * memory so {@link getProof} and {@link notarizeFinalized} can operate
   * on it.
   */
  finalize(): FinalizedBatch | null {
    if (this.pending.length === 0) return null;

    const events = this.pending;
    const leaves = events.map((e) => e.eventHash);
    const levels = buildLevels(leaves);
    const root = levels[levels.length - 1][0];

    const proofs = buildProofs(levels, root);
    const proofMap: Record<string, MerkleProof> = {};
    for (let i = 0; i < events.length; i++) {
      proofMap[events[i].eventHash] = proofs[i];
    }

    const sequences = events.map((e) => e.sequenceNumber);
    const finalized: FinalizedBatch = {
      batchId: generateBatchId(),
      root,
      leafCount: events.length,
      firstSequenceNumber: Math.min(...sequences),
      lastSequenceNumber: Math.max(...sequences),
      finalizedAt: Date.now(),
      proofs: proofMap,
    };

    this.finalizedBatches.push(finalized);
    for (const ev of events) {
      this.proofIndex.set(ev.eventHash, finalized);
    }

    // Reset open-batch state.
    this.pending = [];
    this.pendingHashes.clear();
    this.batchOpenedAt = null;

    return finalized;
  }

  /**
   * Look up an inclusion proof for an event by its `eventHash`.
   *
   * @remarks
   * Returns `undefined` if the event has not yet been added to a finalized
   * batch (it may still be pending, or it may belong to a batch that has
   * already been evicted from the in-memory cache).
   *
   * @example
   * ```ts
   * const proof = batch.getProof(event.eventHash);
   * if (proof) exportBundle.proofs.push(proof);
   * ```
   */
  getProof(eventHash: string): MerkleProof | undefined {
    const owner = this.proofIndex.get(eventHash);
    if (!owner) return undefined;
    return owner.proofs[eventHash];
  }

  /**
   * Convenience wrapper around {@link verifyMerkleProof} so callers with a
   * batch instance in hand don't have to import the standalone function.
   */
  verifyProof(proof: MerkleProof): boolean {
    return verifyMerkleProof(proof);
  }

  /**
   * Wire up a {@link BatchNotarizationAdapter}. Call before
   * {@link notarizeFinalized}; replacing the adapter resets no state —
   * already-notarized batches stay flagged as such.
   */
  setNotarizationAdapter(adapter: BatchNotarizationAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Publish every finalized-but-not-yet-notarized batch through the
   * configured adapter.
   *
   * @remarks
   * Batches are notarized in finalization order. If the adapter rejects a
   * batch we propagate the error immediately without marking the batch as
   * notarized, so the next call will retry from that point. Successfully
   * notarized batches are flagged internally so repeated calls are
   * idempotent.
   *
   * @returns receipts for the batches notarized in this call, in order.
   * @throws MerkleBatchError if no adapter has been configured.
   */
  async notarizeFinalized(): Promise<NotarizationReceipt[]> {
    if (!this.adapter) {
      throw new MerkleBatchError(
        "notarization adapter not configured; call setNotarizationAdapter first",
      );
    }
    const receipts: NotarizationReceipt[] = [];
    for (const batch of this.finalizedBatches) {
      if (this.notarized.has(batch.batchId)) continue;
      const receipt = await this.adapter.notarize(batch);
      this.notarized.add(batch.batchId);
      receipts.push(receipt);
    }
    return receipts;
  }
}
