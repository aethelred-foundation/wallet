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
 *   2. Expose a typed `persistPendingApprovals` helper the
 *      `approval-response` handler calls on every mutation without
 *      having to reach into `background.ts` internals.
 *   3. Write a dedicated test for the rehydration path that doesn't
 *      spin up the entire background service worker.
 *
 * Persistence uses `chrome.storage.session` (NOT `chrome.storage.local`)
 * because session storage is cleared on browser restart by design — a
 * pending approval from a previous browser session is stale by
 * definition (the connected dApp has already errored out on the broken
 * connection). Surviving SW eviction within a single browser session
 * is the exact semantic we need.
 *
 * Contract
 * ────────
 *   - The stage owns the MAP of in-flight approvals (passed in via
 *     `deps.pendingApprovals`) but does NOT own the mutation lifecycle.
 *     Handlers in background.ts still call `persistPendingApprovals()`
 *     after every set/delete.
 *   - `onStartup` reads from session storage and installs stub
 *     resolvers for rehydrated entries. The original resolvers (tied
 *     to Promise callbacks in the RPC handler) cannot survive SW
 *     eviction; the stub logs the decision and the original caller
 *     has already errored out.
 *   - `onSuspend` persists the CURRENT in-memory map one last time.
 *     Idempotent with the per-mutation persist calls.
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
      const serializable = Array.from(deps.pendingApprovals.values()).map((p) => ({
        summary: p.summary,
        intentRequest: p.intentRequest,
        createdAt: p.createdAt,
        expiresAt: p.expiresAt,
      }));
      await session.set({ [APPROVAL_STORAGE_KEY]: serializable });
    } catch (err) {
      // Persistence is best-effort — we already have the in-memory
      // map. A failing persist means only that a subsequent SW
      // eviction would drop the entries.
      console.info("[pending-approvals-stage] persist failed");
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
      const now = Date.now();
      let installed = 0;
      for (const entry of list) {
        if (entry.expiresAt <= now) continue;
        if (deps.pendingApprovals.has(entry.summary.id)) continue; // idempotent
        deps.pendingApprovals.set(entry.summary.id, {
          summary: entry.summary,
          intentRequest: entry.intentRequest,
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt,
          resolve: (decision) => {
            console.info(
              `[pending-approvals-stage] rehydrated approval ${entry.summary.id} resolved ${decision} after SW death — original caller is gone`,
            );
          },
        });
        installed += 1;
      }
      return installed;
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
      const installed = await rehydrate();
      if (installed > 0) {
        ctx.logger.info(
          "approval.pending.rehydrated",
          `Rehydrated ${installed} pending approvals from session storage.`,
          { count: installed },
        );
      }
    },
    async onSuspend(ctx) {
      await persist();
      ctx.logger.info(
        "approval.pending.persisted",
        "Persisted pending approvals snapshot on onSuspend.",
        { count: deps.pendingApprovals.size },
      );
    },
  };

  return { stage, persist, rehydrate };
}
