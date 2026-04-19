/**
 * Persistence layer for {@link TenantProfile}s.
 *
 * The interface is intentionally minimal — the production
 * implementation lives in the extension background service worker and
 * routes through the same encrypted-storage adapter the identity and
 * audit packages use. The in-memory implementation in this file is
 * the reference for tests and for first-boot bootstrap (before the
 * encrypted storage key is derived).
 *
 * The store's only non-trivial operation is {@link TenantProfileStore.getLineage},
 * which walks the `upgradedFrom` chain upwards — every tenant created
 * by a migration holds a backpointer to its predecessor, and the store
 * returns the whole chain in ancestor-first order. Auditors use this
 * to prove that a given tenant's audit trail is rooted in a specific
 * historical tenant.
 */

import type { TenantProfile, TierLevel } from "./tenant-profile";

/**
 * Typed error thrown by {@link TenantProfileStore} implementations.
 *
 * We use a class rather than plain `Error` so downstream callers can
 * narrow with `instanceof` instead of brittle message-string checks.
 */
export class TenantStoreError extends Error {
  public readonly code:
    | "not-found"
    | "duplicate-tenant"
    | "lineage-cycle"
    | "lineage-corrupted";

  constructor(
    code:
      | "not-found"
      | "duplicate-tenant"
      | "lineage-cycle"
      | "lineage-corrupted",
    message: string
  ) {
    super(message);
    this.name = "TenantStoreError";
    this.code = code;
    // Preserve correct prototype chain across transpile targets.
    Object.setPrototypeOf(this, TenantStoreError.prototype);
  }
}

/**
 * Filter accepted by {@link TenantProfileStore.list}. All fields are
 * optional; when omitted, the store returns every profile in insertion
 * order. An explicit `undefined` is treated as "no filter for this
 * field" — this matches the bridge-message shape the popup sends.
 */
export interface TenantProfileFilter {
  tier?: TierLevel;
  jurisdiction?: string;
  /** Restrict results to tenants promoted from this parent tenantId. */
  upgradedFrom?: string;
}

/**
 * Abstract store contract. Production implementations route to the
 * encrypted-storage adapter; tests use {@link InMemoryTenantProfileStore}.
 */
export interface TenantProfileStore {
  get(tenantId: string): Promise<TenantProfile | null>;
  list(filter?: TenantProfileFilter): Promise<TenantProfile[]>;
  put(profile: TenantProfile): Promise<void>;
  delete(tenantId: string): Promise<void>;
  /**
   * Return the full upgrade chain, ancestor-first, terminating at the
   * given tenant. If no lineage (no `upgradedFrom`) the result is a
   * single-element array `[profile]`.
   */
  getLineage(tenantId: string): Promise<TenantProfile[]>;
}

/**
 * Reference implementation. Keeps profiles in a `Map` keyed by
 * `tenantId`. Thread-safe only under the single-threaded assumption
 * the browser extension runtime provides — concurrent writes from
 * multiple workers would need external serialization.
 *
 * @example
 * ```ts
 * const store = new InMemoryTenantProfileStore();
 * await store.put(profile);
 * const lineage = await store.getLineage(profile.tenantId);
 * ```
 */
export class InMemoryTenantProfileStore implements TenantProfileStore {
  private readonly profiles = new Map<string, TenantProfile>();

  async get(tenantId: string): Promise<TenantProfile | null> {
    return this.profiles.get(tenantId) ?? null;
  }

  async list(filter?: TenantProfileFilter): Promise<TenantProfile[]> {
    const all = Array.from(this.profiles.values());
    if (!filter) return all;
    return all.filter((p) => {
      if (filter.tier !== undefined && p.tier !== filter.tier) return false;
      if (
        filter.jurisdiction !== undefined &&
        p.jurisdiction !== filter.jurisdiction
      ) {
        return false;
      }
      if (
        filter.upgradedFrom !== undefined &&
        p.upgradedFrom !== filter.upgradedFrom
      ) {
        return false;
      }
      return true;
    });
  }

  async put(profile: TenantProfile): Promise<void> {
    // `put` is idempotent — overwrites are expected when the migrator
    // marks a predecessor `migrated`.
    this.profiles.set(profile.tenantId, profile);
  }

  async delete(tenantId: string): Promise<void> {
    if (!this.profiles.has(tenantId)) {
      throw new TenantStoreError(
        "not-found",
        `Tenant ${tenantId} not found`
      );
    }
    this.profiles.delete(tenantId);
  }

  async getLineage(tenantId: string): Promise<TenantProfile[]> {
    const chain: TenantProfile[] = [];
    const visited = new Set<string>();
    let current: TenantProfile | null =
      this.profiles.get(tenantId) ?? null;
    if (!current) {
      throw new TenantStoreError(
        "not-found",
        `Tenant ${tenantId} not found`
      );
    }
    while (current) {
      if (visited.has(current.tenantId)) {
        throw new TenantStoreError(
          "lineage-cycle",
          `Cycle detected in lineage at ${current.tenantId}`
        );
      }
      visited.add(current.tenantId);
      chain.push(current);
      if (!current.upgradedFrom) break;
      const parent = this.profiles.get(current.upgradedFrom);
      if (!parent) {
        throw new TenantStoreError(
          "lineage-corrupted",
          `Missing parent tenant ${current.upgradedFrom} referenced by ${current.tenantId}`
        );
      }
      current = parent;
    }
    // Reverse so the oldest ancestor is first.
    return chain.reverse();
  }

  /**
   * Snapshot helper used by the extension background service worker
   * when persisting to encrypted storage. Returns a structural clone
   * of every profile so the caller cannot mutate in-store state.
   */
  toSnapshot(): TenantProfile[] {
    const all = Array.from(this.profiles.values());
    return typeof structuredClone === "function"
      ? all.map((p) => structuredClone(p))
      : (JSON.parse(JSON.stringify(all)) as TenantProfile[]);
  }

  /**
   * Rehydrate from a snapshot. Clears the in-memory map first —
   * partial loads are disallowed because they'd leave the store in a
   * state where `getLineage` could silently skip ancestors.
   */
  loadFromSnapshot(profiles: TenantProfile[]): void {
    this.profiles.clear();
    for (const p of profiles) {
      this.profiles.set(p.tenantId, p);
    }
  }
}
