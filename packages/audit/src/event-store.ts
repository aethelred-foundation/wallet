import { AuditStorageError } from "./errors";
import {
  type AuditMetricsRecorder,
  NOOP_AUDIT_METRICS_RECORDER,
} from "./metrics";
import type { AuditEvent, AuditEventKind, AuditQuery } from "./types";

/* The old version imported `StorageAdapter` from `@aethelred/wallet-connect`,
 * but that symbol is not exported by connect — the import existed only
 * because it was never cleanly typechecked. The `SimpleStorage` interface
 * below is the real dependency: it's structural and matches any adapter
 * that implements get/set/delete against string keys. */

// Re-declare for decoupling from core package
interface SimpleStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Minimal structural interface for an encrypted storage adapter.
 *
 * Mirrors the shape of `EncryptedStorage` exported from `@aethelred/wallet-core`
 * without importing that package (avoiding a circular dependency and the
 * `StorageKey` union which does not include audit keys). Any value type is
 * accepted because the audit store serializes events to JSON internally.
 */
export interface AuditEncryptedStorage {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

const STORAGE_KEY = "audit-events";
const META_KEY = "audit-meta";
const MAX_EVENTS = 10_000;

interface AuditMeta {
  lastSequence: number;
  lastHash: string;
  eventCount: number;
}

/**
 * AuditStore persists audit events to storage.
 * Uses a simple append-and-evict strategy with configurable limits.
 * Supports paginated retrieval and query filtering.
 *
 * When `encryptedStorage` is provided to the constructor, the event list
 * and metadata are routed through AES-GCM encryption via the master key.
 * This keeps app IDs, origins, simulation risks, nonces, and signature
 * prefixes opaque to any other code that can read `chrome.storage.local`
 * (dApps, malicious extensions, forensic disk reads).
 *
 * Without `encryptedStorage`, the store falls back to plain JSON for
 * backward compatibility in tests and in environments where the master
 * key is not yet initialized.
 */
export class AuditStore {
  private events: AuditEvent[] = [];
  private maxEvents: number;
  private encryptedStorage: AuditEncryptedStorage | null;
  /**
   * Pluggable metrics recorder (PR #108). Defaults to a no-op.
   * Operators wire to their meter implementation to surface
   * `audit.storage_write_failed` and `audit.storage_read_failed`
   * (see `docs/runbooks/audit-trail-gap.md` §8 for the
   * canonical wiring example).
   */
  private readonly metrics: AuditMetricsRecorder;

  constructor(
    private readonly storage: SimpleStorage,
    maxEvents: number = MAX_EVENTS,
    encryptedStorage: AuditEncryptedStorage | null = null,
    metrics: AuditMetricsRecorder = NOOP_AUDIT_METRICS_RECORDER
  ) {
    this.maxEvents = maxEvents;
    this.encryptedStorage = encryptedStorage;
    this.metrics = metrics;
  }

  /**
   * Load persisted events and metadata on wallet startup.
   *
   * Prefers the encrypted store if provided; reads from plain storage as a
   * fallback (supports migration from an earlier unencrypted install).
   *
   * @returns the last persisted audit meta, or null if this is a fresh store.
   * @throws AuditStorageError if both encrypted and plain reads fail.
   */
  async initialize(): Promise<AuditMeta | null> {
    try {
      // Try encrypted first
      if (this.encryptedStorage) {
        try {
          const enc = await this.encryptedStorage.get<AuditEvent[]>(STORAGE_KEY);
          if (enc && Array.isArray(enc)) {
            this.events = enc;
          }
          const encMeta = await this.encryptedStorage.get<AuditMeta>(META_KEY);
          if (encMeta) return encMeta;
        } catch (encErr) {
          console.info(
            "[AuditStore] encrypted read failed; falling back to plain storage",
          );
          console.error(encErr);
          // Fall through to plain read for migration
        }
      }

      const raw = await this.storage.get(STORAGE_KEY);
      if (raw) {
        this.events = JSON.parse(raw) as AuditEvent[];
      }
      const metaRaw = await this.storage.get(META_KEY);
      if (metaRaw) {
        return JSON.parse(metaRaw) as AuditMeta;
      }
      return null;
    } catch (error) {
      // Both encrypted and plain reads exhausted (the inner try
      // around the encrypted read swallows mid-fallback errors).
      // Fire the read-failed metric BEFORE re-throwing so ops
      // observability sees the failure even if the caller wraps
      // / suppresses the throw.
      this.metrics.recordStorageReadFailed({ operation: "initialize" });
      throw new AuditStorageError("initialize", error);
    }
  }

  /**
   * Append a new audit event and persist immediately.
   *
   * Enforces FIFO eviction when the in-memory list exceeds `maxEvents`.
   * If eviction trims the oldest entries, a synthetic marker event is
   * inserted that records the eviction so the `previousHash -> eventHash`
   * chain integrity marker is traceable across restarts.
   */
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);

    // FIFO eviction — must preserve chain-integrity marker.
    if (this.events.length > this.maxEvents) {
      const excess = this.events.length - this.maxEvents;
      const firstKept = this.events[excess];
      const evictionMarker: AuditEvent = {
        id: `evt-eviction-${Date.now().toString(16)}`,
        sequenceNumber: firstKept.sequenceNumber - 1,
        timestamp: Date.now(),
        kind: "wallet-initialized" as AuditEventKind,
        subjectId: firstKept.subjectId,
        workspaceId: firstKept.workspaceId,
        detail: {
          eviction: true,
          evictedCount: excess,
          note: "FIFO eviction marker — oldest events purged; chain continues from here.",
        },
        previousHash: firstKept.previousHash,
        eventHash: firstKept.previousHash,
      };
      this.events = [evictionMarker, ...this.events.slice(excess)];
    }

    await this.persist(event);
  }

  query(params: AuditQuery = {}): AuditEvent[] {
    let filtered = this.events;

    if (params.kind) {
      filtered = filtered.filter((e) => e.kind === params.kind);
    }
    if (params.subjectId) {
      filtered = filtered.filter((e) => e.subjectId === params.subjectId);
    }
    if (params.workspaceId) {
      filtered = filtered.filter((e) => e.workspaceId === params.workspaceId);
    }
    if (params.intentId) {
      filtered = filtered.filter((e) => e.intentId === params.intentId);
    }
    if (params.fromSequence !== undefined) {
      filtered = filtered.filter((e) => e.sequenceNumber >= params.fromSequence!);
    }
    if (params.toSequence !== undefined) {
      filtered = filtered.filter((e) => e.sequenceNumber <= params.toSequence!);
    }

    const offset = params.offset ?? 0;
    const limit = params.limit ?? 100;
    return filtered.slice(offset, offset + limit);
  }

  getAll(): AuditEvent[] {
    return [...this.events];
  }

  getCount(): number {
    return this.events.length;
  }

  getLatest(count = 10): AuditEvent[] {
    return this.events.slice(-count).reverse();
  }

  /**
   * Re-encrypt the audit log under a new master key.
   *
   * Pass the new `EncryptedStorage` instance (already bound to the new
   * master key). The in-memory events are rewritten to the new store
   * atomically. If rotation fails mid-flight, the old encrypted store is
   * preserved so the log remains recoverable.
   *
   * @param newEncryptedStorage the new encrypted-storage handle backed by
   *   the rotated master key.
   * @throws AuditStorageError if rotation fails.
   */
  async rotateKey(newEncryptedStorage: AuditEncryptedStorage): Promise<void> {
    try {
      console.info(
        "[AuditStore] rotating audit-log encryption key; rewriting",
        this.events.length,
        "events",
      );
      await newEncryptedStorage.set<AuditEvent[]>(STORAGE_KEY, this.events);
      const lastEvent = this.events[this.events.length - 1];
      if (lastEvent) {
        const meta: AuditMeta = {
          lastSequence: lastEvent.sequenceNumber,
          lastHash: lastEvent.eventHash,
          eventCount: this.events.length,
        };
        await newEncryptedStorage.set<AuditMeta>(META_KEY, meta);
      }
      // Only swap the active store after both writes succeed.
      this.encryptedStorage = newEncryptedStorage;
    } catch (error) {
      console.info("[AuditStore] rotateKey failed; audit log unchanged");
      console.error(error);
      this.metrics.recordStorageWriteFailed({ operation: "rotateKey" });
      throw new AuditStorageError("rotateKey", error);
    }
  }

  private async persist(latestEvent: AuditEvent): Promise<void> {
    try {
      const meta: AuditMeta = {
        lastSequence: latestEvent.sequenceNumber,
        lastHash: latestEvent.eventHash,
        eventCount: this.events.length,
      };

      if (this.encryptedStorage) {
        await this.encryptedStorage.set<AuditEvent[]>(STORAGE_KEY, this.events);
        await this.encryptedStorage.set<AuditMeta>(META_KEY, meta);
      } else {
        await this.storage.set(STORAGE_KEY, JSON.stringify(this.events));
        await this.storage.set(META_KEY, JSON.stringify(meta));
      }
    } catch (error) {
      console.info("[AuditStore] persist failed for sequence", latestEvent.sequenceNumber);
      console.error(error);
      this.metrics.recordStorageWriteFailed({
        operation: "persist",
        sequenceNumber: latestEvent.sequenceNumber,
      });
      throw new AuditStorageError("persist", error);
    }
  }
}
