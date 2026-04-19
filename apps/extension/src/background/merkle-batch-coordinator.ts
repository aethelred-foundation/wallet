/**
 * MerkleBatchCoordinator — bridges the `AuditCapture` event stream to the
 * `MerkleBatch` primitive and persists every state transition so a service-
 * worker eviction or browser crash never leaves the audit pipeline with
 * un-notarized events.
 *
 * Why this file exists
 * ────────────────────
 * The primitive `MerkleBatch` class from `@aethelred/wallet-audit` is
 * storage-free and event-free by design: it accepts events, produces
 * `FinalizedBatch` roots, and computes inclusion proofs — but it does not
 * subscribe to anything and does not persist anything. In production we
 * need the opposite: every event that flows through `AuditCapture` MUST
 * feed a batch, every finalized batch MUST be persisted, and the L1
 * notarizer adapter MUST receive a push-based event stream when batches
 * complete.
 *
 * This coordinator is that glue. It owns:
 *   1. An `onEvent` subscription to `AuditCapture`, so every recorded
 *      event enters the open batch the moment it is appended to the
 *      hash-chain.
 *   2. A raw-event queue persisted to `chrome.storage.local` under
 *      `raw-audit-events` — this is the belt-and-suspenders safety net
 *      against the browser terminating the service worker between the
 *      moment an event is recorded and the moment a batch finalizes.
 *   3. A list of finalized batches persisted under `merkle-batches` with
 *      automatic eviction after 30 days (or `retentionMs`).
 *   4. A callback `onBatchFinalized` that fires once per finalized batch
 *      — production wires the L1 notarizer adapter to this.
 *
 * Graceful degradation
 * ────────────────────
 * Dev builds that run outside a Chrome extension have no
 * `chrome.storage.local`. The coordinator detects this, falls back to
 * an in-memory map, and logs a single informational line so the
 * developer understands why persistence looks like a no-op. The logic
 * above this is identical.
 *
 * Usage
 * ─────
 * ```ts
 * const coordinator = new MerkleBatchCoordinator(
 *   auditCapture,
 *   async (batch) => l1Notarizer.publish(batch),
 *   { maxBatchSize: 256, maxBatchAgeMs: 60_000 }
 * );
 * await coordinator.start();
 * // …
 * await coordinator.flush(); // force-finalize on idle
 * ```
 */

import {
  MerkleBatch,
  AuditCapture,
  type AuditEvent,
  type FinalizedBatch,
  type MerkleProof,
} from "@aethelred/wallet-audit";

/**
 * Configuration for the coordinator. Mirrors {@link MerkleBatch} options
 * plus storage-layer tuning the primitive doesn't know about.
 */
export interface MerkleBatchCoordinatorConfig {
  /**
   * Auto-finalize the open batch once this many events have been added.
   * Mirrors `MerkleBatch.maxBatchSize`. Default `256`.
   */
  maxBatchSize?: number;
  /**
   * Auto-finalize the open batch after this many ms have elapsed since
   * the first event of the open batch was added. Default `60_000`.
   */
  maxBatchAgeMs?: number;
  /**
   * How long a finalized batch is retained in storage before being
   * evicted. Default `30` days. Set to `Infinity` to disable eviction
   * (useful for offline audit stations that must never discard).
   */
  retentionMs?: number;
  /**
   * Storage key for the persisted list of finalized batches. Default
   * `"merkle-batches"`.
   */
  batchStorageKey?: string;
  /**
   * Storage key for the raw-event queue (defensive persistence against
   * SW eviction mid-batch). Default `"raw-audit-events"`.
   */
  rawEventStorageKey?: string;
}

/**
 * Minimal storage shape the coordinator needs. Matches the adapter used
 * by `AuditStore` so callers can pass the same instance.
 */
export interface MerkleBatchStorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Typed error raised when coordinator state-transitions or persistence
 * operations fail in a way callers must handle (e.g. corrupted stored
 * batches). Non-fatal disk errors are swallowed with a log line so the
 * capture pipeline never breaks operationally.
 */
export class MerkleBatchCoordinatorError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MerkleBatchCoordinatorError";
    this.code = code;
  }
}

const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_BATCH_KEY = "merkle-batches";
const DEFAULT_RAW_KEY = "raw-audit-events";

type OnBatchFinalized = (batch: FinalizedBatch) => Promise<void> | void;

/**
 * Build an in-memory adapter for environments without
 * `chrome.storage.local`. Prints one banner line so a developer watching
 * the console knows persistence degraded.
 */
function buildMemoryAdapter(): MerkleBatchStorageAdapter {
  const store = new Map<string, string>();
  console.info(
    "[merkle-batch-coordinator] chrome.storage.local unavailable; using in-memory fallback",
  );
  return {
    get: async (key) => (store.has(key) ? (store.get(key) as string) : null),
    set: async (key, value) => {
      store.set(key, value);
    },
    delete: async (key) => {
      store.delete(key);
    },
  };
}

/**
 * Select the best available storage adapter. Prefers a caller-supplied
 * adapter, then `chrome.storage.local`, then an in-memory fallback.
 */
export function resolveMerkleBatchStorage(
  override?: MerkleBatchStorageAdapter,
): MerkleBatchStorageAdapter {
  if (override) return override;
  const local = (globalThis as unknown as {
    chrome?: { storage?: { local?: {
      get: (key: string, cb: (items: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, cb: () => void) => void;
      remove: (key: string, cb: () => void) => void;
    } } };
  }).chrome?.storage?.local;
  if (!local) return buildMemoryAdapter();
  return {
    get: (key) =>
      new Promise<string | null>((resolve) => {
        local.get(key, (items) => resolve((items[key] as string | undefined) ?? null));
      }),
    set: (key, value) =>
      new Promise<void>((resolve) => {
        local.set({ [key]: value }, () => resolve());
      }),
    delete: (key) =>
      new Promise<void>((resolve) => {
        local.remove(key, () => resolve());
      }),
  };
}

/**
 * Coordinates the hash-chain audit capture with the Merkle batching
 * primitive and persists the full lifecycle.
 *
 * @example
 * ```ts
 * const coordinator = new MerkleBatchCoordinator(
 *   auditCapture,
 *   async (batch) => l1Notarizer.publish(batch),
 *   { maxBatchSize: 64, retentionMs: 7 * 86_400_000 }
 * );
 * await coordinator.start();
 * ```
 */
export class MerkleBatchCoordinator {
  private readonly auditCapture: AuditCapture;
  private readonly onBatchFinalized: OnBatchFinalized;
  private readonly batch: MerkleBatch;
  private readonly storage: MerkleBatchStorageAdapter;
  private readonly retentionMs: number;
  private readonly batchStorageKey: string;
  private readonly rawEventStorageKey: string;

  private unsubscribe: (() => void) | null = null;
  private started = false;
  private finalizedBatches: FinalizedBatch[] = [];
  private rawQueue: AuditEvent[] = [];
  private persistInFlight: Promise<void> = Promise.resolve();

  constructor(
    auditCapture: AuditCapture,
    onBatchFinalized: OnBatchFinalized,
    config: MerkleBatchCoordinatorConfig = {},
    storage?: MerkleBatchStorageAdapter,
  ) {
    this.auditCapture = auditCapture;
    this.onBatchFinalized = onBatchFinalized;
    this.batch = new MerkleBatch({
      maxBatchSize: config.maxBatchSize,
      maxBatchAgeMs: config.maxBatchAgeMs,
    });
    this.storage = resolveMerkleBatchStorage(storage);
    this.retentionMs = config.retentionMs ?? DEFAULT_RETENTION_MS;
    this.batchStorageKey = config.batchStorageKey ?? DEFAULT_BATCH_KEY;
    this.rawEventStorageKey = config.rawEventStorageKey ?? DEFAULT_RAW_KEY;
  }

  /**
   * Subscribe to the audit capture event stream. Idempotent — calling
   * twice is a no-op. Before subscribing we hydrate any persisted raw
   * events (replaying them through the batch so a crash mid-batch never
   * loses events) and any persisted finalized batches (so `getProof`
   * works for batches finalized in previous sessions).
   */
  async start(): Promise<void> {
    if (this.started) return;
    await this.hydrate();

    this.unsubscribe = this.auditCapture.onEvent((event) => {
      this.acceptEvent(event).catch((err) => {
        // The listener contract mandates we never throw from here, but
        // callers running in dev want to see the failure. We log but
        // never re-throw.
        console.warn("[merkle-batch-coordinator] acceptEvent failed", err);
      });
    });
    this.started = true;
  }

  /** Unsubscribe from the audit capture stream. Idempotent. */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.started = false;
  }

  /**
   * Force-finalize the open batch regardless of size / age threshold.
   * Returns the finalized batch, or `null` if the open batch was empty.
   *
   * Use this on explicit triggers (browser idle, wallet lock, user-
   * requested export) where the caller wants the pending events sealed
   * even though neither threshold has fired.
   */
  async flush(): Promise<FinalizedBatch | null> {
    const finalized = this.batch.finalize();
    if (!finalized) return null;
    await this.handleFinalized(finalized);
    return finalized;
  }

  /** Count of events currently staged in the open (un-finalized) batch. */
  getPendingEventCount(): number {
    return this.batch.getCurrentBatchSize();
  }

  /** Count of batches that have been finalized in this coordinator's lifetime. */
  getFinalizedBatchCount(): number {
    return this.finalizedBatches.length;
  }

  /**
   * Look up an inclusion proof for an event hash in any finalized batch
   * the coordinator has seen — including batches restored from storage
   * on the last `hydrate()`. Returns `undefined` if the event is still
   * pending or belongs to a batch that has been evicted by retention.
   *
   * @example
   * ```ts
   * const proof = coordinator.getProof(event.eventHash);
   * if (proof) auditPackage.proofs.push(proof);
   * ```
   */
  getProof(eventHash: string): MerkleProof | undefined {
    // Ask the in-memory batch first (fast path) — this catches events
    // finalized in THIS coordinator instance.
    const live = this.batch.getProof(eventHash);
    if (live) return live;
    // Fall back to the hydrated list (for events finalized in a
    // previous SW session that we reloaded from storage).
    for (const fb of this.finalizedBatches) {
      const proof = fb.proofs[eventHash];
      if (proof) return proof;
    }
    return undefined;
  }

  /**
   * Return an immutable snapshot of every finalized batch currently in
   * the coordinator. Primarily for diagnostics and tests — production
   * callers should rely on {@link getProof} for lookups.
   */
  listFinalizedBatches(): FinalizedBatch[] {
    return this.finalizedBatches.map((b) => ({
      ...b,
      proofs: { ...b.proofs },
    }));
  }

  /**
   * Internal — append an event to the open batch and persist it to the
   * raw-event queue so we survive an SW eviction before the batch
   * finalizes. If adding the event triggers an auto-finalize, we catch
   * the finalized batch, persist it, fire `onBatchFinalized`, and drop
   * the now-batched raw events from the queue.
   *
   * The `batch.add` call is SYNCHRONOUS — we push into the primitive
   * before kicking off persistence, so `getPendingEventCount` reflects
   * the new state immediately. Persistence of the raw queue is
   * awaited but runs after the add so the observable event count is
   * always ahead of the disk.
   */
  private async acceptEvent(event: AuditEvent): Promise<void> {
    // Push into the queue THEN the Merkle batch — both must be visible
    // synchronously before we await any disk I/O, otherwise callers
    // (and tests) see stale counts.
    this.rawQueue.push(event);

    const beforeCount = this.batch.getCurrentBatchSize();
    try {
      this.batch.add(event);
    } catch (err) {
      // MerkleBatch rejects malformed hashes + duplicates. We don't
      // crash the pipeline — drop from the queue so we don't persist
      // an event that isn't in the batch, log, and move on.
      this.rawQueue.pop();
      console.warn("[merkle-batch-coordinator] batch.add rejected event", err);
      return;
    }

    // Belt-and-suspenders persistence: stash the raw event so a crash
    // between `add` and the post-finalize persist never loses it.
    await this.persistRawQueueSafely();

    // If add() triggered an auto-finalize, the primitive's open-batch
    // count dropped to 0 — probe the proof index for the event we just
    // added so we can extract the owning FinalizedBatch.
    const afterCount = this.batch.getCurrentBatchSize();
    if (afterCount === 0 && beforeCount >= 0) {
      const finalized = this.lookupFinalizedContaining(event.eventHash);
      if (finalized) {
        const finalizedIds = this.knownFinalizedIds();
        if (!finalizedIds.has(finalized.batchId)) {
          this.finalizedBatches.push(finalized);
          await this.handleFinalizedPost(finalized);
        }
      }
    }
  }

  /**
   * Look up the finalized batch that contains a given eventHash by
   * consulting `MerkleBatch.getProof` — the primitive indexes proofs by
   * eventHash, so we can find the owning batch's root + leafCount via
   * introspection on the returned proof.
   *
   * The primitive does not (yet) expose a public finalized-batch
   * enumeration API, so we walk the proof-index via a thin private
   * reflection. This is safe because `MerkleBatch` is an owned package
   * and the internal shape is stable.
   */
  private lookupFinalizedContaining(eventHash: string): FinalizedBatch | null {
    const proof = this.batch.getProof(eventHash);
    if (!proof) return null;
    // MerkleBatch keeps a private `proofIndex` that maps eventHash to
    // the owning FinalizedBatch. TypeScript sees it as private; we
    // reach through to retrieve the whole struct.
    const priv = this.batch as unknown as {
      proofIndex?: Map<string, FinalizedBatch>;
    };
    if (priv.proofIndex && priv.proofIndex instanceof Map) {
      return priv.proofIndex.get(eventHash) ?? null;
    }
    return null;
  }

  /** @internal Set of finalized batchIds currently cached in this coordinator. */
  private knownFinalizedIds(): Set<string> {
    return new Set(this.finalizedBatches.map((b) => b.batchId));
  }

  /**
   * Central finalization handler used by both the auto-finalize path
   * (triggered inside {@link acceptEvent}) and explicit {@link flush}.
   * Persists the batch, fires the onBatchFinalized callback, drops the
   * now-batched raw events from the queue, and applies retention
   * eviction.
   */
  private async handleFinalized(finalized: FinalizedBatch): Promise<void> {
    // Avoid duplicate-accept if the auto-finalize path already added it
    const alreadyTracked = this.finalizedBatches.some(
      (b) => b.batchId === finalized.batchId,
    );
    if (!alreadyTracked) {
      this.finalizedBatches.push(finalized);
    }
    await this.handleFinalizedPost(finalized);
  }

  /**
   * Post-batch bookkeeping after the batch has been added to our
   * tracked list. Runs retention, persists batches + raw queue, and
   * invokes the caller's `onBatchFinalized` callback.
   */
  private async handleFinalizedPost(finalized: FinalizedBatch): Promise<void> {
    // Drop raw events now that they're covered by a notarized root.
    const batchedHashes = new Set(Object.keys(finalized.proofs));
    this.rawQueue = this.rawQueue.filter((ev) => !batchedHashes.has(ev.eventHash));

    // Evict batches older than retentionMs.
    if (Number.isFinite(this.retentionMs)) {
      const cutoff = Date.now() - this.retentionMs;
      this.finalizedBatches = this.finalizedBatches.filter(
        (b) => b.finalizedAt >= cutoff,
      );
    }

    await this.persistBatchesSafely();
    await this.persistRawQueueSafely();

    // Fire caller callback AFTER persistence so any consumer that
    // relies on "persisted" semantics (the L1 notarizer) sees the
    // invariant hold.
    try {
      await this.onBatchFinalized(finalized);
    } catch (err) {
      console.warn(
        "[merkle-batch-coordinator] onBatchFinalized callback threw",
        err,
      );
    }
  }

  /**
   * Pull persisted state off disk. Called once on start(). Safe to call
   * multiple times — hydration is idempotent against the current
   * in-memory state.
   */
  private async hydrate(): Promise<void> {
    // Finalized batches
    try {
      const raw = await this.storage.get(this.batchStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as FinalizedBatch[];
        if (Array.isArray(parsed)) {
          const cutoff = Number.isFinite(this.retentionMs)
            ? Date.now() - this.retentionMs
            : -Infinity;
          this.finalizedBatches = parsed.filter(
            (b) => b && typeof b === "object" && b.finalizedAt >= cutoff,
          );
        }
      }
    } catch (err) {
      console.warn("[merkle-batch-coordinator] batch hydration failed", err);
      this.finalizedBatches = [];
    }

    // Raw event queue — replay through the batch so un-batched events
    // from a previous SW session eventually get notarized. We suppress
    // duplicate-hash errors from MerkleBatch in case some events have
    // already been added in THIS session.
    try {
      const raw = await this.storage.get(this.rawEventStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as AuditEvent[];
        if (Array.isArray(parsed)) {
          for (const ev of parsed) {
            try {
              this.batch.add(ev);
              this.rawQueue.push(ev);
            } catch {
              // Duplicate or malformed — the MerkleBatch primitive
              // enforces integrity, we just skip.
            }
          }
        }
      }
    } catch (err) {
      console.warn("[merkle-batch-coordinator] raw-event hydration failed", err);
      this.rawQueue = [];
    }
  }

  /**
   * Serialize and persist the current finalized-batch list. Throws are
   * swallowed with a log so a transient disk error doesn't break the
   * capture pipeline — we'll try again on the next batch.
   */
  private async persistBatchesSafely(): Promise<void> {
    this.persistInFlight = this.persistInFlight.then(async () => {
      try {
        await this.storage.set(
          this.batchStorageKey,
          JSON.stringify(this.finalizedBatches),
        );
      } catch (err) {
        console.warn("[merkle-batch-coordinator] persistBatches failed", err);
      }
    });
    await this.persistInFlight;
  }

  /** Serialize and persist the current raw-event queue. */
  private async persistRawQueueSafely(): Promise<void> {
    try {
      await this.storage.set(
        this.rawEventStorageKey,
        JSON.stringify(this.rawQueue),
      );
    } catch (err) {
      console.warn(
        "[merkle-batch-coordinator] persistRawQueue failed",
        err,
      );
    }
  }
}
