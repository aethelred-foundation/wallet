/**
 * Workflow engine rehydration stage (priority 90 — last).
 *
 * The `WorkflowEngine` from `@aethelred/wallet-approval` tracks
 * multi-reviewer quorum decisions for enterprise workspaces. Its state
 * (open requests + spend limits) is in-memory; persistence is the
 * caller's responsibility. Before this stage existed, the background
 * never called `workflowEngine.toSnapshot()` — every open request
 * silently vanished on SW wake, orphaning the waiting requester.
 *
 * This stage:
 *   1. `onStartup`: reads `workflow-engine-snapshot` from chrome.storage.local
 *      and calls `WorkflowEngine.loadFromSnapshot()`. Idempotent — the
 *      engine clears its map before installing the new entries.
 *   2. `onSuspend`: exports the current snapshot and persists.
 *   3. `onMessage`: no-op. Mutations persist synchronously via the
 *      `persistWorkflowSnapshot` helper, which the approval handlers
 *      call inline.
 */

import type { ApprovalRequest, SpendLimit } from "@aethelred/wallet-approval";
import type { LifecycleStage } from "../sw-lifecycle";
import type { StageStorageAdapter } from "./types";

/** Persisted shape. Mirrors `WorkflowEngine.toSnapshot()`. */
export interface WorkflowSnapshot {
  requests: ApprovalRequest[];
  limits: SpendLimit[];
  savedAt: number;
}

/** Narrowed surface of `WorkflowEngine`. */
export interface WorkflowEngineLike {
  loadFromSnapshot(requests: ApprovalRequest[], limits: SpendLimit[]): void;
  toSnapshot(): { requests: ApprovalRequest[]; limits: SpendLimit[] };
}

export const WORKFLOW_STORAGE_KEY = "workflow-engine-snapshot";

export function buildWorkflowEngineStage(deps: {
  engine: WorkflowEngineLike;
  storage: StageStorageAdapter;
}): LifecycleStage {
  const { engine, storage } = deps;

  async function readSnapshot(): Promise<WorkflowSnapshot | null> {
    try {
      const raw = await storage.get(WORKFLOW_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as WorkflowSnapshot;
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.requests) || !Array.isArray(parsed.limits)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async function writeSnapshot(): Promise<void> {
    const snap = engine.toSnapshot();
    const payload: WorkflowSnapshot = {
      requests: snap.requests,
      limits: snap.limits,
      savedAt: Date.now(),
    };
    await storage.set(WORKFLOW_STORAGE_KEY, JSON.stringify(payload));
  }

  return {
    name: "workflow-engine",
    priority: 90,
    async onInstalled(ctx) {
      ctx.logger.info(
        "workflow.engine.installed",
        "Workflow engine: fresh install — no pending workflows to restore.",
      );
    },
    async onStartup(ctx) {
      const snap = await readSnapshot();
      if (!snap) {
        ctx.logger.info(
          "workflow.engine.noSnapshot",
          "No persisted workflow snapshot to restore.",
        );
        return;
      }
      engine.loadFromSnapshot(snap.requests, snap.limits);
      ctx.logger.info(
        "workflow.engine.restored",
        `Restored ${snap.requests.length} workflow request(s) and ${snap.limits.length} spend limit(s).`,
        {
          requestCount: snap.requests.length,
          limitCount: snap.limits.length,
          savedAt: snap.savedAt,
        },
      );
    },
    async onSuspend(ctx) {
      try {
        await writeSnapshot();
        const snap = engine.toSnapshot();
        ctx.logger.info(
          "workflow.engine.suspendPersisted",
          "Persisted workflow engine snapshot on onSuspend.",
          {
            requestCount: snap.requests.length,
            limitCount: snap.limits.length,
          },
        );
      } catch (err) {
        ctx.logger.warn(
          "workflow.engine.suspendFailed",
          "Workflow engine snapshot persist threw on onSuspend.",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    },
  };
}

/**
 * Helper called by the mutation paths (`workflow-start`,
 * `workflow-decision`) after every state change — keeps the persisted
 * snapshot in lock-step with the in-memory engine so a concurrent SW
 * eviction never loses a just-submitted reviewer decision.
 */
export async function persistWorkflowSnapshot(
  storage: StageStorageAdapter,
  engine: WorkflowEngineLike,
): Promise<void> {
  try {
    const snap = engine.toSnapshot();
    const payload: WorkflowSnapshot = {
      requests: snap.requests,
      limits: snap.limits,
      savedAt: Date.now(),
    };
    await storage.set(WORKFLOW_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Best-effort.
  }
}
