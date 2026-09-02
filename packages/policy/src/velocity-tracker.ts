/**
 * VelocityTracker — crash-safe sliding-window spending ledger.
 *
 * A policy decision must account for both transactions already broadcast and
 * operations that are currently waiting for approval/signing/broadcast.  If it
 * only reads committed history, concurrent requests can all observe the same
 * snapshot and cross a count/value ceiling together.  Reservations close that
 * time-of-check/time-of-use gap:
 *
 *   1. `reserveOperation` atomically persists the candidate operation.
 *   2. It returns post-request totals (committed + every active reservation).
 *   3. A denied/failed request releases its reservation.
 *   4. A successful broadcast atomically converts it into a committed record.
 *
 * Reservations survive MV3 service-worker eviction.  An orphaned reservation
 * remains effective until its expiry, which is deliberately fail-closed: a
 * restart can temporarily consume capacity, but cannot reset velocity limits.
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
  /** USD value of the operation. Unpriced operations use zero. */
  amountUsd: number;
  /** Human-readable asset symbol. */
  assetSymbol: string;
}

export interface VelocityReservation {
  /** Stable id for one policy/sign/broadcast attempt. */
  reservationId: string;
  subjectId: string;
  /** Unix ms when the reservation was first acquired. */
  timestamp: number;
  /** The reservation stops contributing to policy totals after this time. */
  expiresAt: number;
  /** USD value of the operation. Unpriced operations use zero. */
  amountUsd: number;
  /** Human-readable asset symbol. */
  assetSymbol: string;
}

export interface VelocityStats {
  /** Number of committed + (when requested) in-flight operations in the window. */
  count24h: number;
  /** Sum of USD amounts in the window. */
  valueUsd24h: number;
  /** Earliest timestamp still in the window (for UI display). */
  oldestTimestamp?: number;
}

interface VelocityLedgerV2 {
  version: 2;
  records: VelocityRecord[];
  reservations: VelocityReservation[];
}

export class VelocityTracker {
  /** Default window — 24 hours in ms. */
  static readonly DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
  /** Long enough for the approval UI, short enough to release abandoned work. */
  static readonly DEFAULT_RESERVATION_TTL_MS = 10 * 60 * 1000;

  private readonly storage: VelocityStorageAdapter;
  private readonly storageKey: string;
  private readonly windowMs: number;
  private readonly reservationTtlMs: number;
  private records: VelocityRecord[] = [];
  /**
   * Expired reservations are retained (but not counted) for one velocity
   * window.  That lets a slow broadcast still be committed by reservation id
   * even if its network response arrives just after expiry.
   */
  private reservations: VelocityReservation[] = [];
  private hydrated = false;
  /** A storage failure poisons this instance so later sends fail closed. */
  private unavailable: Error | null = null;
  /** Serializes every read-modify-write sequence within the MV3 worker. */
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    storage: VelocityStorageAdapter,
    options?: {
      /** Storage key namespace. Default: "velocity-tracker" */
      storageKey?: string;
      /** Sliding window duration in ms. Default: 24 hours */
      windowMs?: number;
      /** Default lifetime of an in-flight reservation. Default: 10 minutes */
      reservationTtlMs?: number;
    },
  ) {
    this.storage = storage;
    this.storageKey = options?.storageKey ?? "velocity-tracker";
    this.windowMs = options?.windowMs ?? VelocityTracker.DEFAULT_WINDOW_MS;
    this.reservationTtlMs =
      options?.reservationTtlMs ?? VelocityTracker.DEFAULT_RESERVATION_TTL_MS;
    if (!Number.isFinite(this.windowMs) || this.windowMs <= 0) {
      throw new Error("VelocityTracker windowMs must be positive");
    }
    if (!Number.isFinite(this.reservationTtlMs) || this.reservationTtlMs <= 0) {
      throw new Error("VelocityTracker reservationTtlMs must be positive");
    }
  }

  /** Record an already-completed operation (legacy/direct call path). */
  async recordOperation(
    record: Omit<VelocityRecord, "timestamp"> & { timestamp?: number },
  ): Promise<void> {
    return this.exclusive(async () => {
      this.assertAvailable();
      await this.hydrate();
      this.assertOperationFields(record.recordId, record.subjectId, record.amountUsd);
      const timestamp = record.timestamp ?? Date.now();
      if (!Number.isFinite(timestamp)) throw new Error("Velocity timestamp must be finite");

      this.prune(Date.now());
      if (this.records.some((entry) => entry.recordId === record.recordId)) return;
      this.records.push({ ...record, timestamp });
      this.prune(Date.now());
      await this.persistOrPoison();
    });
  }

  /**
   * Atomically reserve a candidate operation and return post-request totals.
   * The returned count/value includes this reservation, eliminating threshold
   * off-by-one errors (`> 200` rejects the 201st operation, for example).
   */
  async reserveOperation(
    reservation: Omit<VelocityReservation, "timestamp" | "expiresAt"> & {
      timestamp?: number;
      ttlMs?: number;
    },
  ): Promise<VelocityStats> {
    return this.exclusive(async () => {
      this.assertAvailable();
      await this.hydrate();
      this.assertOperationFields(
        reservation.reservationId,
        reservation.subjectId,
        reservation.amountUsd,
      );
      const now = Date.now();
      const timestamp = reservation.timestamp ?? now;
      const ttlMs = reservation.ttlMs ?? this.reservationTtlMs;
      if (!Number.isFinite(timestamp) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new Error("Velocity reservation timestamp/ttl must be finite and positive");
      }
      if (timestamp + ttlMs <= now) {
        throw new Error(`Velocity reservation is already expired: ${reservation.reservationId}`);
      }
      this.prune(now);

      const existing = this.reservations.find(
        (entry) => entry.reservationId === reservation.reservationId,
      );
      if (existing) {
        const sameOperation =
          existing.subjectId === reservation.subjectId &&
          existing.amountUsd === reservation.amountUsd &&
          existing.assetSymbol === reservation.assetSymbol;
        if (!sameOperation) {
          throw new Error(`Velocity reservation id collision: ${reservation.reservationId}`);
        }
        if (existing.expiresAt <= now) {
          throw new Error(`Velocity reservation expired: ${reservation.reservationId}`);
        }
        return this.computeStats(reservation.subjectId, true, now);
      }

      this.reservations.push({
        reservationId: reservation.reservationId,
        subjectId: reservation.subjectId,
        amountUsd: reservation.amountUsd,
        assetSymbol: reservation.assetSymbol,
        timestamp,
        expiresAt: timestamp + ttlMs,
      });
      await this.persistOrPoison();
      return this.computeStats(reservation.subjectId, true, now);
    });
  }

  /**
   * Revalidate an active reservation and extend it for an execute/broadcast
   * attempt.  Used by popup drafts so policy is checked again at execution.
   */
  async renewReservation(
    reservationId: string,
    ttlMs = this.reservationTtlMs,
  ): Promise<VelocityStats> {
    return this.exclusive(async () => {
      this.assertAvailable();
      await this.hydrate();
      const now = Date.now();
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
        throw new Error("Velocity reservation ttl must be finite and positive");
      }
      this.prune(now);
      const reservation = this.reservations.find(
        (entry) => entry.reservationId === reservationId,
      );
      if (!reservation || reservation.expiresAt <= now) {
        throw new Error(`Velocity reservation is missing or expired: ${reservationId}`);
      }
      reservation.expiresAt = now + ttlMs;
      await this.persistOrPoison();
      return this.computeStats(reservation.subjectId, true, now);
    });
  }

  /**
   * Durably enter the broadcast uncertainty window.  Once raw transaction
   * submission starts, a service worker can be evicted before it receives the
   * node's hash.  Extending the reservation to the full velocity window before
   * the network call ensures that an unknown/failed commit cannot reset spend
   * history after the ordinary approval TTL.
   */
  async markBroadcastPending(reservationId: string): Promise<void> {
    return this.exclusive(async () => {
      this.assertAvailable();
      await this.hydrate();
      const now = Date.now();
      this.prune(now);
      const reservation = this.reservations.find(
        (entry) => entry.reservationId === reservationId,
      );
      if (!reservation || reservation.expiresAt <= now) {
        throw new Error(`Velocity reservation is missing or expired: ${reservationId}`);
      }
      // The attempt itself is the start of the 24h velocity interval.
      reservation.timestamp = now;
      reservation.expiresAt = now + this.windowMs;
      await this.persistOrPoison();
    });
  }

  /** Release an in-flight operation after denial, rejection, or failure. */
  async releaseReservation(reservationId: string): Promise<void> {
    return this.exclusive(async () => {
      this.assertAvailable();
      await this.hydrate();
      const before = this.reservations.length;
      this.reservations = this.reservations.filter(
        (entry) => entry.reservationId !== reservationId,
      );
      if (this.reservations.length !== before) await this.persistOrPoison();
    });
  }

  /**
   * Atomically convert an in-flight reservation into durable broadcast
   * history.  The operation is idempotent on the final transaction hash.
   */
  async commitReservation(
    reservationId: string,
    recordId: string,
    timestamp = Date.now(),
  ): Promise<void> {
    return this.exclusive(async () => {
      this.assertAvailable();
      await this.hydrate();
      if (!recordId.trim()) throw new Error("Velocity record id must not be empty");
      if (!Number.isFinite(timestamp)) throw new Error("Velocity timestamp must be finite");
      const reservation = this.reservations.find(
        (entry) => entry.reservationId === reservationId,
      );
      if (!reservation) {
        // A duplicate successful callback is safe if the hash is already
        // committed; otherwise losing the reservation must fail closed.
        if (this.records.some((entry) => entry.recordId === recordId)) return;
        throw new Error(`Velocity reservation not found: ${reservationId}`);
      }

      if (!this.records.some((entry) => entry.recordId === recordId)) {
        this.records.push({
          recordId,
          subjectId: reservation.subjectId,
          amountUsd: reservation.amountUsd,
          assetSymbol: reservation.assetSymbol,
          timestamp,
        });
      }
      this.reservations = this.reservations.filter(
        (entry) => entry.reservationId !== reservationId,
      );
      this.prune(Date.now());
      await this.persistOrPoison();
    });
  }

  /** Get committed velocity only (backward-compatible observation API). */
  async getVelocity(subjectId: string): Promise<VelocityStats> {
    return this.exclusive(async () => {
      this.assertAvailable();
      await this.hydrate();
      const now = Date.now();
      const changed = this.prune(now);
      if (changed) await this.persistOrPoison();
      return this.computeStats(subjectId, false, now);
    });
  }

  /** Get committed + currently active in-flight velocity. */
  async getEffectiveVelocity(subjectId: string): Promise<VelocityStats> {
    return this.exclusive(async () => {
      this.assertAvailable();
      await this.hydrate();
      const now = Date.now();
      const changed = this.prune(now);
      if (changed) await this.persistOrPoison();
      return this.computeStats(subjectId, true, now);
    });
  }

  /** Force-clear committed records and reservations (e.g. on wallet reset). */
  async clear(): Promise<void> {
    return this.exclusive(async () => {
      this.records = [];
      this.reservations = [];
      this.hydrated = true;
      this.unavailable = null;
      try {
        await this.storage.delete(this.storageKey);
      } catch (error) {
        this.poison(error, "delete");
      }
    });
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertAvailable(): void {
    if (this.unavailable) throw this.unavailable;
  }

  private assertOperationFields(id: string, subjectId: string, amountUsd: number): void {
    if (!id.trim() || !subjectId.trim()) {
      throw new Error("Velocity operation and subject ids must not be empty");
    }
    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
      throw new Error("Velocity USD amount must be finite and non-negative");
    }
  }

  /** Load and strictly validate persisted state on first access. */
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    let raw: string | null;
    try {
      raw = await this.storage.get(this.storageKey);
    } catch (error) {
      this.poison(error, "read");
    }

    try {
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        // Version-one storage was a bare record array.
        if (Array.isArray(parsed)) {
          this.records = parsed.map((entry) => this.parseRecord(entry));
          this.reservations = [];
        } else if (
          parsed &&
          typeof parsed === "object" &&
          (parsed as Partial<VelocityLedgerV2>).version === 2 &&
          Array.isArray((parsed as Partial<VelocityLedgerV2>).records) &&
          Array.isArray((parsed as Partial<VelocityLedgerV2>).reservations)
        ) {
          const ledger = parsed as VelocityLedgerV2;
          this.records = ledger.records.map((entry) => this.parseRecord(entry));
          this.reservations = ledger.reservations.map((entry) =>
            this.parseReservation(entry),
          );
        } else {
          throw new Error("unsupported velocity ledger format");
        }
      }
    } catch (error) {
      this.poison(error, "parse");
    }
    this.prune(Date.now());
    this.hydrated = true;
  }

  private parseRecord(value: unknown): VelocityRecord {
    if (!value || typeof value !== "object") throw new Error("invalid velocity record");
    const entry = value as Partial<VelocityRecord>;
    if (
      typeof entry.recordId !== "string" ||
      typeof entry.subjectId !== "string" ||
      typeof entry.timestamp !== "number" ||
      typeof entry.amountUsd !== "number" ||
      typeof entry.assetSymbol !== "string"
    ) {
      throw new Error("invalid velocity record fields");
    }
    this.assertOperationFields(entry.recordId, entry.subjectId, entry.amountUsd);
    if (!Number.isFinite(entry.timestamp)) throw new Error("invalid velocity timestamp");
    return entry as VelocityRecord;
  }

  private parseReservation(value: unknown): VelocityReservation {
    if (!value || typeof value !== "object") {
      throw new Error("invalid velocity reservation");
    }
    const entry = value as Partial<VelocityReservation>;
    if (
      typeof entry.reservationId !== "string" ||
      typeof entry.subjectId !== "string" ||
      typeof entry.timestamp !== "number" ||
      typeof entry.expiresAt !== "number" ||
      typeof entry.amountUsd !== "number" ||
      typeof entry.assetSymbol !== "string"
    ) {
      throw new Error("invalid velocity reservation fields");
    }
    this.assertOperationFields(
      entry.reservationId,
      entry.subjectId,
      entry.amountUsd,
    );
    if (
      !Number.isFinite(entry.timestamp) ||
      !Number.isFinite(entry.expiresAt) ||
      entry.expiresAt <= entry.timestamp
    ) {
      throw new Error("invalid velocity reservation lifetime");
    }
    return entry as VelocityReservation;
  }

  /**
   * Drop committed history outside the window.  Expired reservations stop
   * counting immediately but remain addressable for one window so a late
   * successful broadcast can still be committed.
   */
  private prune(now: number): boolean {
    const cutoff = now - this.windowMs;
    const beforeRecords = this.records.length;
    const beforeReservations = this.reservations.length;
    this.records = this.records.filter((entry) => entry.timestamp > cutoff);
    this.reservations = this.reservations.filter((entry) => entry.timestamp > cutoff);
    return (
      this.records.length !== beforeRecords ||
      this.reservations.length !== beforeReservations
    );
  }

  private computeStats(subjectId: string, includeReservations: boolean, now: number): VelocityStats {
    const committed = this.records.filter((entry) => entry.subjectId === subjectId);
    const inFlight = includeReservations
      ? this.reservations.filter(
          (entry) => entry.subjectId === subjectId && entry.expiresAt > now,
        )
      : [];
    const entries = [...committed, ...inFlight];
    return {
      count24h: entries.length,
      valueUsd24h: entries.reduce((sum, entry) => sum + entry.amountUsd, 0),
      oldestTimestamp:
        entries.length > 0
          ? Math.min(...entries.map((entry) => entry.timestamp))
          : undefined,
    };
  }

  private async persistOrPoison(): Promise<void> {
    const ledger: VelocityLedgerV2 = {
      version: 2,
      records: this.records,
      reservations: this.reservations,
    };
    try {
      await this.storage.set(this.storageKey, JSON.stringify(ledger));
    } catch (error) {
      this.poison(error, "write");
    }
  }

  private poison(error: unknown, operation: string): never {
    const reason = error instanceof Error ? error.message : String(error);
    this.unavailable = new Error(
      `Velocity ledger ${operation} failed; transaction policy is unavailable: ${reason}`,
    );
    throw this.unavailable;
  }
}
