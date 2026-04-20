/**
 * Velocity-tracker rehydration stage (priority 80).
 *
 * The `VelocityTracker` underlies the policy engine's velocity rules
 * ("no more than $X / 24h", "no more than N operations / hour"). It is
 * already self-hydrating — mutations persist through its injected
 * storage adapter, and reads hydrate on first access. What it does
 * NOT guard against: a malicious actor who times an attack to coincide
 * with MV3 SW eviction, hoping that a fresh in-memory state would
 * bypass the velocity rule until the first storage read.
 *
 * The fix is to FORCE a hydrate on boot so the in-memory cache
 * reflects the persisted window BEFORE the first policy evaluation.
 * This closes the window between SW wake and first-read.
 */

import type { LifecycleContext, LifecycleStage } from "../sw-lifecycle";

/**
 * Narrowed tracker surface. We call `getVelocity` to force the hydrate;
 * the call is idempotent and cheap (local-only prune).
 */
export interface VelocityTrackerLike {
  getVelocity(subjectId: string): Promise<{ count24h: number; valueUsd24h: number }>;
}

/**
 * Build the velocity-tracker rehydration stage.
 *
 * The `getActiveSubjectId` thunk returns the currently-active subject
 * id. If there is no active subject (wallet is locked, no subjects
 * registered yet) we skip — the tracker will still hydrate lazily on
 * first policy evaluation.
 */
export function buildVelocityTrackerStage(deps: {
  tracker: VelocityTrackerLike;
  getActiveSubjectId: () => string | null;
}): LifecycleStage {
  const { tracker, getActiveSubjectId } = deps;

  async function forceHydrate(ctx: LifecycleContext): Promise<void> {
    const subjectId = getActiveSubjectId();
    if (!subjectId) {
      ctx.logger.info(
        "velocity.tracker.noSubject",
        "No active subject; velocity cache will hydrate lazily on first policy eval.",
      );
      return;
    }
    try {
      const stats = await tracker.getVelocity(subjectId);
      ctx.logger.info(
        "velocity.tracker.rehydrated",
        "Velocity cache hydrated for active subject.",
        {
          subjectId,
          count24h: stats.count24h,
          valueUsd24h: stats.valueUsd24h,
        },
      );
    } catch (err) {
      ctx.logger.warn(
        "velocity.tracker.rehydrateFailed",
        "VelocityTracker.getVelocity threw during rehydrate.",
        { subjectId, error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  return {
    name: "velocity-tracker",
    priority: 80,
    async onInstalled(ctx) {
      ctx.logger.info(
        "velocity.tracker.installed",
        "Velocity tracker: fresh install — cache starts empty.",
      );
    },
    onStartup: forceHydrate,
    async onSuspend(ctx) {
      // Tracker persists on every mutation; no buffered writes to flush.
      ctx.logger.info(
        "velocity.tracker.suspended",
        "onSuspend reached; velocity tracker persists on mutation.",
      );
    },
  };
}
