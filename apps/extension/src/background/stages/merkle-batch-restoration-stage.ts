/**
 * Merkle batch restoration stage (priority 20).
 *
 * The `MerkleBatchCoordinator` is the notarization conveyor: every audit
 * event is hashed into an open batch, and when the batch fills (or ages
 * out) it finalizes to a Merkle root that the L1 notarizer publishes.
 * The coordinator already persists its state on every mutation — raw
 * events under `raw-audit-events`, finalized batches under
 * `merkle-batches`. What it does NOT do is force-finalize an open batch
 * on SW eviction.
 *
 * That gap creates the following bug at production scale:
 *   1. Wallet records 5 audit events → open batch has 5 events.
 *   2. User closes popup; SW idles for 30s; Chrome evicts.
 *   3. SW wakes on next message → coordinator hydrates from disk,
 *      replays the 5 raw events through a fresh MerkleBatch.
 *   4. That replays CORRECTLY, but the batch still isn't finalized.
 *      If the user then closes the browser mid-window, the 5 events
 *      never reach the L1 notarizer.
 *
 * This stage fixes step 2 by finalizing the open batch in `onSuspend`
 * (if any). The 5 events end up notarized before the SW dies, so even
 * if the browser crashes the next minute the evidence is durable.
 *
 * Contract
 * ────────
 *   - `onStartup` calls `coordinator.start()` which internally hydrates
 *     persisted raw events + finalized batches. Idempotent — the
 *     coordinator short-circuits on the second `start()`.
 *   - `onSuspend` calls `coordinator.flush()` which force-finalizes the
 *     open batch. If the batch is empty (`getPendingEventCount() === 0`)
 *     this is a cheap no-op.
 *   - `onMessage` is a no-op. The coordinator's event wiring handles the
 *     per-event path internally — the hook would be superfluous.
 */

import type { MerkleBatchCoordinator } from "../merkle-batch-coordinator";
import type { LifecycleContext, LifecycleStage } from "../sw-lifecycle";

/**
 * Build the merkle-batch restoration stage.
 */
export function buildMerkleBatchRestorationStage(deps: {
  coordinator: MerkleBatchCoordinator;
  /** Called after hydration with the restored batch count. Test hook. */
  onRehydrated?: (state: { finalizedBatches: number; pendingEvents: number }) => void;
}): LifecycleStage {
  const { coordinator, onRehydrated } = deps;
  let started = false;

  async function ensureStarted(ctx: LifecycleContext): Promise<void> {
    if (started) {
      ctx.logger.info(
        "merkle.coordinator.startSkipped",
        "Merkle coordinator already started; skipping.",
      );
      return;
    }
    try {
      await coordinator.start();
      started = true;
      const state = {
        finalizedBatches: coordinator.getFinalizedBatchCount(),
        pendingEvents: coordinator.getPendingEventCount(),
      };
      ctx.logger.info(
        "merkle.coordinator.started",
        "Merkle coordinator started and hydrated.",
        state,
      );
      onRehydrated?.(state);
    } catch (err) {
      ctx.logger.error(
        "merkle.coordinator.startFailed",
        "Merkle coordinator.start threw.",
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  return {
    name: "merkle-batch-restoration",
    priority: 20,
    async onInstalled(ctx) {
      await ensureStarted(ctx);
    },
    async onStartup(ctx) {
      await ensureStarted(ctx);
    },
    async onSuspend(ctx) {
      const pending = coordinator.getPendingEventCount();
      if (pending === 0) {
        ctx.logger.info(
          "merkle.coordinator.flushEmpty",
          "onSuspend: open batch is empty; nothing to finalize.",
        );
        return;
      }
      try {
        const finalized = await coordinator.flush();
        ctx.logger.info(
          "merkle.coordinator.flushed",
          "onSuspend: finalized open batch before SW eviction.",
          {
            pendingEventsFlushed: pending,
            batchId: finalized?.batchId ?? "",
            leafCount: finalized?.leafCount ?? 0,
          },
        );
      } catch (err) {
        ctx.logger.error(
          "merkle.coordinator.flushFailed",
          "onSuspend: coordinator.flush threw — up to pending events lost on eviction.",
          {
            pending,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    },
  };
}
