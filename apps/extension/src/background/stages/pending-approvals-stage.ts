/**
 * Pending-approvals rehydration stage (priority 30).
 *
 * A "pending approval" is a bridge-visible summary of an in-flight
 * request that needs the user's explicit decision (e.g. an
 * `eth_sendTransaction` blocked by policy). Before this stage existed,
 * the inline logic in `background.ts` persisted approvals to
 * `chrome.storage.session` on every mutation and rehydrated them on
 * boot. Extracting it to a stage lets us:
 *
 *   1. Wire the rehydration into the same `SwLifecycle` that every
 *      other subsystem uses, so boot-ordering is visible in one place.
 *   2. Expose a typed cleanup helper the `approval-response` handler can
 *      call without persisting signing intent data that cannot be resumed.
 *   3. Write a dedicated test for the cold-start path that doesn't
 *      spin up the entire background service worker.
 *
 * Pending request promises cannot survive MV3 service-worker eviction. A
 * serialized summary without its original response channel must therefore
 * never be presented as actionable after restart. Startup discards legacy
 * snapshots, and suspension rejects every in-memory approval fail-closed.
 *
 * Contract
 * ────────
 *   - The stage owns the MAP of in-flight approvals (passed in via
 *     `deps.pendingApprovals`) but does NOT own the mutation lifecycle.
 *     Handlers in background.ts still call `persistPendingApprovals()`
 *     after every set/delete.
 *   - `onStartup` removes any snapshot written by an older build. It never
 *     creates an approval with a resolver that cannot reach its caller.
 *   - `onSuspend` rejects and clears the current map before shutdown.
 */

import type { ApprovalSummary, IntentRequest } from "@aethelred/wallet-connect";
import type { LifecycleStage } from "../sw-lifecycle";

/** The same pending-approval shape background.ts uses. */
export interface PendingApproval {
  summary: ApprovalSummary;
  intentRequest: IntentRequest;
  resolve: (decision: "approved" | "rejected") => void;
  createdAt: number;
  expiresAt: number;
}

/** Minimal chrome.storage.session surface; duck-typed for tests. */
export interface ApprovalSessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(key: string): Promise<void>;
}

/** Storage key the stage writes under. Exported for the tests. */
export const APPROVAL_STORAGE_KEY = "pending-approvals";

/**
 * Resolve the session storage handle. Prefers a caller-provided
 * adapter, then `chrome.storage.session`, then null (no-op).
 */
function resolveSessionStorage(
  override?: ApprovalSessionStorage,
): ApprovalSessionStorage | null {
  if (override) return override;
  const session = (globalThis as unknown as {
    chrome?: { storage?: { session?: ApprovalSessionStorage } };
  }).chrome?.storage?.session;
  return session ?? null;
}

/**
 * Build the pending-approvals stage. Returns both the stage AND a pair
 * of helper functions the RPC / approval-response handlers call when
 * the map mutates. Keeping them next to the stage constructor avoids
 * accidental divergence between boot-time rehydration and mutation-
 * time persistence.
 */
export function buildPendingApprovalsStage(deps: {
  pendingApprovals: Map<string, PendingApproval>;
  sessionStorage?: ApprovalSessionStorage;
}): {
  stage: LifecycleStage;
  persist: () => Promise<void>;
  rehydrate: () => Promise<number>;
} {
  const session = resolveSessionStorage(deps.sessionStorage);

  async function persist(): Promise<void> {
    if (!session) return;
    try {
      if (session.remove) await session.remove(APPROVAL_STORAGE_KEY);
      else await session.set({ [APPROVAL_STORAGE_KEY]: [] });
    } catch (err) {
      console.info("[pending-approvals-stage] stale snapshot cleanup failed");
      console.error(err);
    }
  }

  async function rehydrate(): Promise<number> {
    if (!session) return 0;
    try {
      const raw = await session.get(APPROVAL_STORAGE_KEY);
      const list = raw?.[APPROVAL_STORAGE_KEY] as
        | Array<{
            summary: ApprovalSummary;
            intentRequest: IntentRequest;
            createdAt: number;
            expiresAt: number;
          }>
        | undefined;
      if (!Array.isArray(list)) return 0;
      const discarded = list.length;
      await persist();
      return discarded;
    } catch (err) {
      console.info("[pending-approvals-stage] rehydrate failed");
      console.error(err);
      return 0;
    }
  }

  const stage: LifecycleStage = {
    name: "pending-approvals",
    priority: 30,
    async onInstalled(ctx) {
      // Fresh install has no prior approvals — explicit no-op for
      // symmetry with the other stages.
      ctx.logger.info(
        "approval.pending.installed",
        "Pending-approvals stage: fresh install — no rehydration needed.",
      );
    },
    async onStartup(ctx) {
      const discarded = await rehydrate();
      if (discarded > 0) {
        ctx.logger.info(
          "approval.pending.discarded",
          `Discarded ${discarded} stale pending approval(s) after service-worker restart.`,
          { count: discarded },
        );
      }
    },
    async onSuspend(ctx) {
      const pending = Array.from(deps.pendingApprovals.values());
      deps.pendingApprovals.clear();
      for (const approval of pending) approval.resolve("rejected");
      await persist();
      ctx.logger.info(
        "approval.pending.rejectedOnSuspend",
        "Rejected pending approvals before service-worker suspension.",
        { count: pending.length },
      );
    },
  };

  return { stage, persist, rehydrate };
}
