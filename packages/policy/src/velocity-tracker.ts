/**
 * VelocityTracker — sliding-window ledger of spending operations.
 *
 * Feeds `PolicyContext.requestedOperationCount24h` and
 * `PolicyContext.cumulativeValueSpentUsd24h` so the policy engine's
 * velocity rules can actually trigger. Previously the context fields
 * existed but were never populated, making spend-limit / velocity /
 * destination-allowlist rules dead code.
 *
 * Storage strategy:
 *   - Backed by an injected `StorageAdapter` (same shape as
 *     @aethelred/wallet-core's). Survives SW restarts.
 *   - Operations are keyed by `subjectId:recordId` so the tracker
 *     is subject-scoped (multi-user wallets don't leak velocity
 *     across users).
 *   - On every read, expired entries (> windowMs) are pruned
 *     eagerly so the window is always correct.
 *   - `recordOperation` is idempotent on `recordId` — the same
 *     event can't double-count even if the caller retries.
 */

export interface VelocityStorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface VelocityRecord {
  /** Stable id so retries are idempotent. */
  recordId: string;
  subjectId: string;
  /** Unix ms when the operation was recorded. */
  timestamp: number;
  /** USD value of the operation. */
  amountUsd: number;
  /** Human-readable asset symbol. */
  assetSymbol: string;
}

export interface VelocityStats {
  /** Number of operations in the sliding window. */
  count24h: number;
  /** Sum of USD amounts in the window. */
  valueUsd24h: number;
  /** Earliest timestamp still in the window (for UI display). */
  oldestTimestamp?: number;
}

export class VelocityTracker {
  /** Default window — 24 hours in ms. */
  static readonly DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

  private readonly storage: VelocityStorageAdapter;
  private readonly storageKey: string;
  private readonly windowMs: number;
  /** In-memory cache of the current record list. Rebuilt on every prune. */
  private cache: VelocityRecord[] = [];
  /** Has the cache been loaded from storage yet? */
  private hydrated = false;

  constructor(
    storage: VelocityStorageAdapter,
    options?: {
      /** Storage key namespace. Default: "velocity-tracker" */
      storageKey?: string;
      /** Sliding window duration in ms. Default: 24 hours */
      windowMs?: number;
    },
  ) {
    this.storage = storage;
    this.storageKey = options?.storageKey ?? "velocity-tracker";
    this.windowMs = options?.windowMs ?? VelocityTracker.DEFAULT_WINDOW_MS;
  }

  /**
   * Record a new operation. Idempotent on `recordId` — if the same
   * record has already been persisted, this is a no-op.
   */
  async recordOperation(record: Omit<VelocityRecord, "timestamp"> & { timestamp?: number }): Promise<void> {
    await this.hydrate();
    const ts = record.timestamp ?? Date.now();
    // Dedupe
    if (this.cache.some((r) => r.recordId === record.recordId)) return;
    this.cache.push({ ...record, timestamp: ts });
    this.prune();
    // Always persist after a successful record — the length may or may
    // not have changed after pruning, but either way we have a new entry.
    await this.persist();
  }

  /**
   * Get the current velocity stats for a subject. Prunes expired
   * entries as a side effect so callers always see a correct view
   * of the window. Only writes back to storage if pruning actually
   * evicted entries (avoids unnecessary round-trips on pure reads).
   */
  async getVelocity(subjectId: string): Promise<VelocityStats> {
    await this.hydrate();
    const before = this.cache.length;
    this.prune();
    if (this.cache.length !== before) {
      await this.persist();
    }
    const subjectRecords = this.cache.filter((r) => r.subjectId === subjectId);
    const count24h = subjectRecords.length;
    const valueUsd24h = subjectRecords.reduce((sum, r) => sum + r.amountUsd, 0);
    const oldestTimestamp = subjectRecords.length > 0
      ? Math.min(...subjectRecords.map((r) => r.timestamp))
      : undefined;
    return { count24h, valueUsd24h, oldestTimestamp };
  }

  /** Force-clear all records (e.g. on wallet reset). */
  async clear(): Promise<void> {
    this.cache = [];
    this.hydrated = true;
    await this.storage.delete(this.storageKey);
  }

  /**
   * Load persisted records on first access. Subsequent calls are
   * cheap cache reads.
   */
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    try {
      const raw = await this.storage.get(this.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as VelocityRecord[];
        if (Array.isArray(parsed)) {
          this.cache = parsed;
        }
      }
    } catch {
      // Corrupt or unreadable — start fresh
      this.cache = [];
    }
    this.hydrated = true;
  }

  /** Drop records older than the window. Pure mutation of the cache. */
  private prune(): void {
    const cutoff = Date.now() - this.windowMs;
    this.cache = this.cache.filter((r) => r.timestamp > cutoff);
  }

  /** Write the current cache to storage. */
  private async persist(): Promise<void> {
    await this.storage.set(this.storageKey, JSON.stringify(this.cache));
  }
}
