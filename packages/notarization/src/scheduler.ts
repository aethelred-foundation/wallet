/**
 * `NotarizationScheduler` — cadence-driven flush for Merkle-batch
 * anchoring.
 *
 * Production target: every 15 minutes the scheduler finalizes the
 * audit package's current `MerkleBatch` and pushes the finalized
 * batch through the `OnChainAnchorAdapter`. Tests drive `tick()`
 * manually with a frozen clock — no real timers are involved.
 *
 * Design:
 *
 *   - The scheduler OWNS NOTHING. It wraps a `MerkleBatch` +
 *     `BatchNotarizationAdapter`. Callers supply both and keep
 *     full control of the batch's event-append lifecycle.
 *
 *   - `start()` arms a clock-driven tick via the `SchedulerClock`
 *     interface. In production, the clock wraps `setTimeout`; in
 *     tests it wraps a fake clock that advances by `tick()` calls.
 *
 *   - Each tick:
 *       1. Attempts to finalize the batch (`batch.finalize()`).
 *       2. If a finalized batch is produced, runs it through the
 *          adapter's `notarize()`.
 *       3. Emits one `NotarizationTickResult` per attempt to the
 *          optional `onTick` callback.
 *
 *   - `stop()` cancels the pending timer and transitions to
 *     `stopped` — further `start()` calls are rejected until the
 *     scheduler is disposed + recreated.
 *
 *   - Errors from either finalization or anchoring are NOT
 *     rethrown — they go into the tick result. This matches the
 *     scheduler's role as a background worker: a failed anchor
 *     shouldn't crash the process, it should be observable via
 *     the callback for alerting.
 */

import type {
  BatchNotarizationAdapter,
  FinalizedBatch,
  MerkleBatch,
  NotarizationReceipt,
} from "@aethelred/wallet-audit";

import { NotarizationError } from "./errors";
import type { SchedulerClock, SchedulerTimerHandle } from "./types";

export interface NotarizationTickResult {
  readonly tickAt: number;
  readonly finalized?: FinalizedBatch;
  readonly receipt?: NotarizationReceipt;
  readonly error?: NotarizationError | Error;
}

export interface NotarizationSchedulerConfig {
  readonly batch: MerkleBatch;
  readonly adapter: BatchNotarizationAdapter;
  /** Cadence between ticks, ms. Default: 15 * 60_000 = 900_000. */
  readonly intervalMs?: number;
  readonly clock: SchedulerClock;
  /**
   * Optional callback invoked after every tick. Useful for metrics,
   * structured logging, and — in tests — asserting behaviour.
   */
  readonly onTick?: (result: NotarizationTickResult) => void;
}

export type SchedulerState = "idle" | "running" | "stopped";

export class NotarizationScheduler {
  private readonly batch: MerkleBatch;
  private readonly adapter: BatchNotarizationAdapter;
  private readonly intervalMs: number;
  private readonly clock: SchedulerClock;
  private readonly onTick?: (result: NotarizationTickResult) => void;

  private state: SchedulerState = "idle";
  private pendingTimer: SchedulerTimerHandle | null = null;

  constructor(config: NotarizationSchedulerConfig) {
    this.batch = config.batch;
    this.adapter = config.adapter;
    this.intervalMs = config.intervalMs ?? 15 * 60_000;
    this.clock = config.clock;
    this.onTick = config.onTick;
  }

  get currentState(): SchedulerState {
    return this.state;
  }

  /**
   * Arm the scheduler. Throws if already running. The first tick
   * fires after `intervalMs`; callers who want an immediate flush
   * call `tick()` explicitly before `start()`.
   */
  start(): void {
    if (this.state === "running") {
      throw new NotarizationError(
        "scheduler-already-running",
        "NotarizationScheduler is already running",
      );
    }
    if (this.state === "stopped") {
      throw new NotarizationError(
        "scheduler-stopped",
        "NotarizationScheduler has been stopped; create a new instance",
      );
    }
    this.state = "running";
    this.scheduleNextTick();
  }

  /**
   * Cancel the pending timer and mark the scheduler stopped. Safe
   * to call multiple times.
   */
  stop(): void {
    if (this.state === "stopped") return;
    if (this.pendingTimer) {
      this.pendingTimer.cancel();
      this.pendingTimer = null;
    }
    this.state = "stopped";
  }

  /**
   * Run one tick explicitly. Tests and on-demand flushes call this
   * directly instead of (or in addition to) `start()`. Returns the
   * tick result; does not throw on anchor failure.
   */
  async tick(): Promise<NotarizationTickResult> {
    const tickAt = this.clock.now();
    let finalized: FinalizedBatch | undefined;
    try {
      finalized = this.batch.finalize() ?? undefined;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const result: NotarizationTickResult = { tickAt, error };
      this.onTick?.(result);
      return result;
    }

    if (!finalized) {
      const result: NotarizationTickResult = { tickAt };
      this.onTick?.(result);
      return result;
    }

    try {
      const receipt = await this.adapter.notarize(finalized);
      const result: NotarizationTickResult = { tickAt, finalized, receipt };
      this.onTick?.(result);
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const result: NotarizationTickResult = { tickAt, finalized, error };
      this.onTick?.(result);
      return result;
    }
  }

  // ─── Private ─────────────────────────────────────────

  private scheduleNextTick(): void {
    this.pendingTimer = this.clock.setTimeout(() => {
      if (this.state !== "running") return;
      void this.tick().finally(() => {
        if (this.state === "running") this.scheduleNextTick();
      });
    }, this.intervalMs);
  }
}

// ─── Default clocks ──────────────────────────────────────

/**
 * Production clock. Wraps `Date.now` and `setTimeout`. The
 * `setTimeout` return is a `Timeout` handle we wrap in a cancel()
 * closure so the scheduler doesn't see Node-specific types.
 */
export const SystemClock: SchedulerClock = {
  now() {
    return Date.now();
  },
  setTimeout(callback, ms) {
    const handle = setTimeout(callback, ms);
    return {
      cancel() {
        clearTimeout(handle);
      },
    };
  },
};

/**
 * Test clock — advance via `advance(ms)`. Every `setTimeout` is
 * recorded in a priority queue; `advance` fires any expired
 * callbacks in order. Useful for driving the scheduler without
 * wall-clock delay.
 */
export class TestClock implements SchedulerClock {
  private currentMs = 0;
  private readonly timers: Array<{
    fireAt: number;
    callback: () => void;
    cancelled: boolean;
    id: number;
  }> = [];
  private nextId = 0;

  constructor(startMs = 0) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  setTimeout(callback: () => void, ms: number): SchedulerTimerHandle {
    const entry = {
      fireAt: this.currentMs + ms,
      callback,
      cancelled: false,
      id: this.nextId++,
    };
    this.timers.push(entry);
    return {
      cancel() {
        entry.cancelled = true;
      },
    };
  }

  /**
   * Move the clock forward by `ms`, firing every non-cancelled
   * timer whose `fireAt <= currentMs`. Timers fire in `fireAt`
   * order, ties broken by insertion order.
   */
  advance(ms: number): void {
    this.currentMs += ms;
    // Snapshot and sort — callback might register new timers; we
    // fire only those that existed at advance-time.
    const due = this.timers
      .filter((t) => !t.cancelled && t.fireAt <= this.currentMs)
      .sort((a, b) => a.fireAt - b.fireAt || a.id - b.id);
    for (const t of due) {
      t.cancelled = true;
      t.callback();
    }
    // Remove fired entries from the pool to keep the list bounded.
    for (let i = this.timers.length - 1; i >= 0; i -= 1) {
      if (this.timers[i].cancelled) this.timers.splice(i, 1);
    }
  }

  /** Peek at the next scheduled fireAt without advancing. */
  nextFireAt(): number | null {
    const active = this.timers.filter((t) => !t.cancelled);
    if (active.length === 0) return null;
    return Math.min(...active.map((t) => t.fireAt));
  }
}
