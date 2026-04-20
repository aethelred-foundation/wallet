/**
 * Pending-tx tracker rehydration stage (priority 50).
 *
 * `PendingTxTracker` is already self-hydrating: every mutation persists
 * the whole list, and the first `list()` call lazily loads from storage.
 * That covers the basic case where the popup opens, reads the list,
 * and shows it in the Activity tab. What it does NOT cover: catching
 * up txs that confirmed (or got stuck) while the SW was asleep.
 *
 * This stage fills that gap by:
 *   1. Calling `tracker.list()` eagerly on startup to force the hydrate
 *      and surface the current count in a log record.
 *   2. Polling `eth_getTransactionReceipt` for each pending tx; if the
 *      tx has a receipt, calling `tracker.markConfirmed()` so the
 *      Activity tab doesn't show phantoms.
 *   3. Flagging stuck txs (> 10 min since submission with no receipt)
 *      via a log line ops dashboards can alert on.
 *
 * The receipt poll is capped at 5 RPC calls per wake to protect the
 * cold-start budget. If the user has > 5 pending txs the remaining
 * entries are reconciled on subsequent wakes.
 */

import type { LifecycleContext, LifecycleStage } from "../sw-lifecycle";

/**
 * Tracker surface this stage uses. Narrowed so tests don't need to
 * instantiate a real `PendingTxTracker`.
 */
export interface PendingTxTrackerLike {
  list(): Promise<
    Array<{
      txHash: `0x${string}`;
      chainId: number;
      submittedAt: number;
      replacedBy?: `0x${string}`;
    }>
  >;
  markConfirmed(hash: `0x${string}`): Promise<void>;
}

/** Minimal RPC surface for `eth_getTransactionReceipt`. */
export interface ReceiptProbe {
  /** Returns a receipt-like object, or null if the tx hasn't mined. */
  getTransactionReceipt(
    hash: `0x${string}`,
  ): Promise<{ status: string; blockNumber: string } | null>;
}

/** Default budget — do not exceed this many RPC calls per boot. */
const DEFAULT_MAX_RECEIPT_PROBES = 5;
/** Default stuck threshold — 10 minutes per the PRD. */
const DEFAULT_STUCK_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Build the pending-tx-tracker rehydration stage.
 */
export function buildPendingTxTrackerStage(deps: {
  tracker: PendingTxTrackerLike;
  /** Fresh thunk — must return the probe for the current active chain. */
  getReceiptProbe: () => ReceiptProbe | null;
  maxReceiptProbes?: number;
  stuckThresholdMs?: number;
  /**
   * Hook fired when a tx is detected as stuck. Ops dashboards wire
   * this to a notification; tests use it to assert detection.
   */
  onStuck?: (hash: `0x${string}`, ageMs: number) => void;
}): LifecycleStage {
  const maxProbes = deps.maxReceiptProbes ?? DEFAULT_MAX_RECEIPT_PROBES;
  const stuckMs = deps.stuckThresholdMs ?? DEFAULT_STUCK_THRESHOLD_MS;

  async function reconcile(ctx: LifecycleContext): Promise<void> {
    const probe = deps.getReceiptProbe();
    if (!probe) {
      ctx.logger.info(
        "pending-tx.reconcile.skipped",
        "No receipt probe available on active chain — skipping reconciliation.",
      );
      return;
    }

    let pending;
    try {
      pending = await deps.tracker.list();
    } catch (err) {
      ctx.logger.warn(
        "pending-tx.list.failed",
        "PendingTxTracker.list threw — skipping reconciliation.",
        { error: err instanceof Error ? err.message : String(err) },
      );
      return;
    }

    if (pending.length === 0) {
      ctx.logger.info(
        "pending-tx.reconcile.empty",
        "No pending transactions to reconcile.",
      );
      return;
    }

    const now = Date.now();
    let confirmed = 0;
    let stuck = 0;
    let probed = 0;

    for (const tx of pending) {
      // Check stuck-age FIRST; it's free (no RPC).
      const age = now - tx.submittedAt;
      if (age >= stuckMs && !tx.replacedBy) {
        stuck += 1;
        deps.onStuck?.(tx.txHash, age);
        ctx.logger.warn(
          "pending-tx.stuck",
          "Pending tx has exceeded stuck threshold.",
          { txHash: tx.txHash, ageMs: age, thresholdMs: stuckMs },
        );
      }

      if (probed >= maxProbes) continue;
      probed += 1;
      try {
        const receipt = await probe.getTransactionReceipt(tx.txHash);
        if (receipt) {
          await deps.tracker.markConfirmed(tx.txHash);
          confirmed += 1;
        }
      } catch (err) {
        ctx.logger.info(
          "pending-tx.receipt.failed",
          "getTransactionReceipt threw; leaving tx in pending state.",
          { txHash: tx.txHash, error: err instanceof Error ? err.message : String(err) },
        );
      }
    }

    ctx.logger.info(
      "pending-tx.reconcile.done",
      "Pending-tx reconciliation pass complete.",
      {
        totalPending: pending.length,
        probed,
        confirmed,
        stuck,
      },
    );
  }

  return {
    name: "pending-tx-tracker",
    priority: 50,
    async onInstalled(ctx) {
      ctx.logger.info(
        "pending-tx.installed",
        "Pending-tx tracker: fresh install — nothing to reconcile.",
      );
    },
    async onStartup(ctx) {
      await reconcile(ctx);
    },
    async onSuspend(ctx) {
      // Tracker persists on every mutation — nothing buffered to flush.
      // We log so the trace is consistent with other stages.
      ctx.logger.info(
        "pending-tx.suspended",
        "onSuspend reached; no buffered pending-tx writes to flush.",
      );
    },
  };
}
