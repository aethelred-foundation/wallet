/**
 * Storage persistence stage (priority 0 — runs first).
 *
 * Responsibilities
 * ────────────────
 *   - On install, seed the v2 schema marker so later migrations know
 *     we started on v2 (no v1 → v2 migration work to do).
 *   - On startup, detect whether the persisted state is on a prior
 *     schema version and run migrations one bump at a time. If a
 *     migration fails we KEEP the prior state — the alternative (silent
 *     data wipe) would be catastrophic.
 *   - On every startup, run a soft quota check. `chrome.storage.local`
 *     has a 10 MB limit; crossing 80% triggers a warning log record so
 *     ops dashboards see pressure before we hit the ceiling.
 *
 * This stage is designed to be a single authoritative place for the
 * schema-version plumbing. Other stages rely on it running first (and
 * succeeding) — if schema migration fails, subsequent stages will see
 * stale state and skip their own hydration rather than blow up.
 */

import type { LifecycleContext, LifecycleStage } from "../sw-lifecycle";
import type { StageStorageAdapter } from "./types";

/** Storage key under which we record the current schema version. */
export const SCHEMA_VERSION_STORAGE_KEY = "wallet-schema-version";
/**
 * The current schema version. Bump on any breaking change to the shape
 * of wallet state and add a migration under `SCHEMA_MIGRATIONS`.
 */
export const CURRENT_SCHEMA_VERSION = 2;
/**
 * Soft threshold (bytes) at which we log a quota-warning. `chrome.storage.local`
 * has a 10 MB hard limit; 80% = 8 MB. Keeps a few MB of headroom for
 * burst writes like a finalized Merkle batch.
 */
export const QUOTA_SOFT_WARNING_BYTES = 8 * 1024 * 1024;

/**
 * A migration step that advances storage from `fromVersion` to
 * `fromVersion + 1`. Migrations MUST be idempotent — if a prior attempt
 * failed halfway through we'll re-run and the result must be the same.
 */
export interface SchemaMigration {
  fromVersion: number;
  apply: (storage: StageStorageAdapter) => Promise<void>;
}

/**
 * Default migration registry. Migrations are applied in ascending
 * `fromVersion` order, one at a time, with the schema-version marker
 * written AFTER each step so a mid-migration crash leaves us on the
 * last-completed version (not the in-progress one).
 */
export const SCHEMA_MIGRATIONS: SchemaMigration[] = [
  {
    fromVersion: 1,
    apply: async (storage) => {
      // v1 used `audit-events-v1` as the raw dump key; v2 uses `audit-events`.
      // Copy the data under the new key and delete the old one so later
      // reads don't see two sources of truth.
      const legacy = await storage.get("audit-events-v1");
      if (legacy) {
        const existing = await storage.get("audit-events");
        if (!existing) {
          await storage.set("audit-events", legacy);
        }
        await storage.delete("audit-events-v1");
      }
    },
  },
];

/**
 * Approximate byte size of all entries in the adapter's underlying
 * store. Returns `null` if the adapter does not expose enumeration.
 */
async function computeStorageBytesUsed(
  storage: StageStorageAdapter,
): Promise<number | null> {
  const local = (globalThis as unknown as {
    chrome?: {
      storage?: {
        local?: {
          getBytesInUse?: (cb: (bytes: number) => void) => void;
        };
      };
    };
  }).chrome?.storage?.local;
  if (!local?.getBytesInUse) {
    // Caller's adapter doesn't surface bytes — that's fine, quota check
    // is optional.
    void storage;
    return null;
  }
  return new Promise<number>((resolve) => {
    try {
      local.getBytesInUse!((bytes) => resolve(bytes));
    } catch {
      resolve(0);
    }
  });
}

/**
 * Build the storage-persistence stage.
 *
 * @example
 * ```ts
 * const stage = buildStoragePersistenceStage({ storage });
 * lifecycle.registerStage(stage);
 * ```
 */
export function buildStoragePersistenceStage(opts: {
  storage: StageStorageAdapter;
  migrations?: SchemaMigration[];
  softQuotaWarningBytes?: number;
}): LifecycleStage {
  const migrations = opts.migrations ?? SCHEMA_MIGRATIONS;
  const softQuota = opts.softQuotaWarningBytes ?? QUOTA_SOFT_WARNING_BYTES;

  async function readVersion(): Promise<number> {
    try {
      const raw = await opts.storage.get(SCHEMA_VERSION_STORAGE_KEY);
      if (!raw) return 0;
      const parsed = parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  async function writeVersion(version: number): Promise<void> {
    await opts.storage.set(SCHEMA_VERSION_STORAGE_KEY, String(version));
  }

  async function runMigrationsFrom(
    ctx: LifecycleContext,
    version: number,
  ): Promise<number> {
    let current = version;
    while (current < CURRENT_SCHEMA_VERSION) {
      const step = migrations.find((m) => m.fromVersion === current);
      if (!step) {
        ctx.logger.warn(
          "storage.migration.missing",
          `No migration registered to advance schema from ${current} to ${current + 1}. Remaining on v${current}.`,
          { fromVersion: current },
        );
        return current;
      }
      try {
        await step.apply(opts.storage);
        current += 1;
        await writeVersion(current);
        ctx.logger.info(
          "storage.migration.applied",
          `Advanced storage schema ${step.fromVersion} → ${current}.`,
          { fromVersion: step.fromVersion, toVersion: current },
        );
      } catch (err) {
        ctx.logger.error(
          "storage.migration.failed",
          `Migration ${step.fromVersion} → ${step.fromVersion + 1} threw. Keeping prior schema.`,
          {
            fromVersion: step.fromVersion,
            error: err instanceof Error ? err.message : String(err),
          },
        );
        return current;
      }
    }
    return current;
  }

  return {
    name: "storage-persistence",
    priority: 0,
    async onInstalled(ctx) {
      // Fresh install has no prior state — stamp with the current
      // schema version so future migrations know we started clean.
      const current = await readVersion();
      if (current === 0) {
        await writeVersion(CURRENT_SCHEMA_VERSION);
        ctx.logger.info(
          "storage.schema.seeded",
          "Seeded storage schema version marker on fresh install.",
          { version: CURRENT_SCHEMA_VERSION },
        );
      }
    },
    async onStartup(ctx) {
      const current = await readVersion();
      if (current === 0) {
        // Never seen before — could be fresh install that skipped
        // onInstalled (e.g. downgrade from a pre-lifecycle build). Stamp
        // and move on.
        await writeVersion(CURRENT_SCHEMA_VERSION);
      } else if (current < CURRENT_SCHEMA_VERSION) {
        const end = await runMigrationsFrom(ctx, current);
        ctx.logger.info(
          "storage.schema.migratedSoFar",
          `Schema migrations complete: on v${end}.`,
          { fromVersion: current, toVersion: end },
        );
      }

      const bytesUsed = await computeStorageBytesUsed(opts.storage);
      if (bytesUsed !== null && bytesUsed >= softQuota) {
        ctx.logger.warn(
          "storage.quota.pressure",
          "chrome.storage.local usage crossed soft-warning threshold.",
          { bytesUsed, softQuotaBytes: softQuota },
        );
      }
    },
    async onMessage() {
      // Soft-quota probe is idempotent and CHEAP — skip the expensive
      // getBytesInUse on the per-message fast path. This hook is a
      // no-op; the stage exists to gate the boot ordering.
    },
  };
}
