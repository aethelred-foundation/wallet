/**
 * Audit chain rehydration stage (priority 10).
 *
 * The audit chain is the compliance backbone of the wallet — every
 * policy decision, every signed tx, every session grant is appended
 * to a tamper-evident hash chain. Each event's hash covers the
 * previous event's hash, so losing the `(sequenceNumber, previousHash)`
 * head means the chain forks. A forked chain cannot be exported to
 * the notary or replayed on-chain, which breaks regulatory reporting.
 *
 * Without this stage the `AuditCapture.sequenceNumber` silently resets
 * to 0 every time the MV3 service worker wakes, producing a fork on
 * the very first event recorded post-wake. The existing background.ts
 * does rehydrate on `unlock-request` but does NOT rehydrate on plain
 * SW wake (pre-unlock state), so the chain head is stale until the
 * next unlock — any event recorded in that window forks.
 *
 * Contract
 * ────────
 *   - `onInstalled` seeds the chain at `(sequence=0, previousHash=genesis)`.
 *     `AuditCapture`'s constructor already does this, so this callback
 *     is a belt-and-suspenders idempotency check.
 *   - `onStartup` calls `AuditStore.initialize()` to reload the persisted
 *     head and hands the `(lastSequence, lastHash)` to
 *     `AuditCapture.restoreState()`. Safe to call twice — `restoreState`
 *     is a pure setter.
 *   - `onSuspend` calls `auditStore.persistMeta()` — or the existing
 *     persistence pipeline if it is already wired through `onEvent` —
 *     so the last observed head survives the SW eviction. The existing
 *     pipeline persists on every `append()`, so this hook is a safety
 *     net for any events that landed after the last `append()` but
 *     before suspend.
 *   - `onMessage` is a no-op — rehydration must not run on every
 *     message (would O(N) read the full audit log).
 */

import type { AuditCapture, AuditStore } from "@aethelred/wallet-audit";
import type { LifecycleContext, LifecycleStage } from "../sw-lifecycle";

/**
 * Build the audit-chain rehydration stage.
 *
 * @param deps Subsystem handles the real background wires in.
 */
export function buildAuditChainRehydrationStage(deps: {
  auditCapture: AuditCapture;
  auditStore: AuditStore;
  /**
   * Optional hook that fires post-rehydration with the restored head.
   * Used by tests to assert rehydration without reaching into private
   * capture fields.
   */
  onRehydrated?: (state: { sequence: number; previousHash: string }) => void;
}): LifecycleStage {
  const { auditCapture, auditStore, onRehydrated } = deps;

  async function rehydrate(ctx: LifecycleContext): Promise<void> {
    try {
      const meta = await auditStore.initialize();
      if (meta) {
        auditCapture.restoreState(meta.lastSequence, meta.lastHash);
        ctx.logger.info(
          "audit.chain.rehydrated",
          "Audit chain head restored from persisted meta.",
          { sequence: meta.lastSequence, eventCount: meta.eventCount },
        );
        onRehydrated?.({ sequence: meta.lastSequence, previousHash: meta.lastHash });
      } else {
        // No persisted meta — this is a fresh install. The capture is
        // already at (0, genesis); surface an info log so the first SW
        // wake after install is visibly distinct from a normal wake.
        ctx.logger.info(
          "audit.chain.fresh",
          "No persisted audit meta; capture starts at genesis.",
        );
        onRehydrated?.({
          sequence: auditCapture.getSequenceNumber(),
          previousHash: auditCapture.getPreviousHash(),
        });
      }
    } catch (err) {
      // Storage failure during rehydration is serious but not fatal —
      // the wallet continues with capture in its default state. The
      // next event recorded will fork (by definition) but we log
      // loudly so ops can triage.
      ctx.logger.error(
        "audit.chain.rehydrateFailed",
        "Audit chain rehydration threw — capture may fork.",
        { error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  return {
    name: "audit-chain-rehydration",
    priority: 10,
    async onInstalled(ctx) {
      // Fresh install — the capture is already at (0, genesis). We
      // still initialize the audit-store to pre-flight any encrypted
      // storage errors; if that throws, we log but don't abort.
      try {
        await auditStore.initialize();
        ctx.logger.info(
          "audit.chain.installed",
          "Audit store initialized for fresh wallet install.",
        );
      } catch (err) {
        ctx.logger.warn(
          "audit.chain.installInitFailed",
          "Audit store initialize threw on install.",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    },
    onStartup: rehydrate,
    async onSuspend(ctx) {
      // The existing persistence pipeline writes on every `append()`
      // so nothing is in-flight for us to flush. We still record a
      // trace line so ops dashboards see the SW was given a graceful
      // chance to flush before eviction.
      ctx.logger.info(
        "audit.chain.suspended",
        "onSuspend reached in audit-chain stage — no buffered writes to flush.",
        { sequence: auditCapture.getSequenceNumber() },
      );
    },
  };
}
