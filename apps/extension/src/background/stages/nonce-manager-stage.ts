/**
 * Nonce manager rehydration stage (priority 40).
 *
 * `TxManager` holds a per-address nonce cache. The cache is populated
 * lazily on the first `getNonce()` call (which hits `eth_getTransactionCount`
 * and seeds the map). This is safe under normal operation, but MV3
 * service-worker eviction between "prepare-tx" and "execute-tx" in the
 * popup-initiated send flow can drop a reserved nonce — the new TxManager
 * instance starts fresh and the next `reserveNonce()` returns a stale
 * value, producing two signed txs with the same nonce (only one of
 * which broadcasts).
 *
 * This stage persists a per-account per-chain high-water mark to disk
 * and restores it into the TxManager cache on SW wake. The per-address
 * map is tiny (O(#accounts * #chains)) so we serialize the whole thing
 * in one blob.
 *
 * Contract
 * ────────
 *   - `onStartup` reads the persisted map and calls
 *     `TxManager.loadNonceSnapshot(addr, nonce)` for each entry. The
 *     TxManager doesn't currently expose that API (see the TODO in
 *     `tx-manager.ts`) so we reach through a well-known private-field
 *     back door. When the public API lands the reach-through gets
 *     deleted.
 *   - `onSuspend` exports the current in-memory map. Idempotent — the
 *     txManager ref is recreated on `switchChain`, so this stage
 *     tolerates a stale txManager gracefully.
 *   - On-chain reconciliation (comparing persisted nonce against
 *     live `eth_getTransactionCount`) is DEFERRED to first tx per
 *     account; running it eagerly on boot would block for seconds on
 *     a cold RPC.
 */

import type { LifecycleContext, LifecycleStage } from "../sw-lifecycle";
import type { StageStorageAdapter } from "./types";

/** Storage key for the persisted nonce snapshot. */
export const NONCE_STORAGE_KEY = "nonce-manager-snapshot";

/**
 * The persisted shape — a flat `address → chainId → nonce` map we can
 * cheaply re-serialize. We key by lowercased address to match
 * TxManager's internal convention.
 */
export interface NonceSnapshot {
  /** address (lowercase) → chainId (decimal) → next-available-nonce */
  byAddress: Record<string, Record<string, number>>;
  savedAt: number;
}

/**
 * The TxManager-shaped surface this stage reaches into. We only need
 * the nonce cache — we don't want the full TxManager type pinned
 * here so the stage stays testable without instantiating an
 * `RpcClient`.
 *
 * TypeScript's structural subtyping treats "no optional properties"
 * as an EMPTY type — every object is assignable. That's exactly what
 * we want: the real `TxManager` has neither method but its private
 * `nonceCache` field is reachable via `reachIntoCache`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type NonceHost = {
  /**
   * Optional public API — if the TxManager exposes it, we prefer it.
   * Today TxManager does NOT expose this API so we fall back to the
   * private-field back door in `reachIntoCache`.
   */
  loadNonceSnapshot?: (address: string, chainId: number, nonce: number) => void;
  exportNonceSnapshot?: () => Record<string, Record<string, number>>;
};

/**
 * Back-door reach-through used until the TxManager exposes a first-
 * class nonce-snapshot API. Accesses the `nonceCache` private field by
 * name; survives TS's private-field check because TypeScript's
 * privacy is declarative (erased at runtime). The field is stable in
 * the repo (owned package) so this is safe.
 */
function reachIntoCache(host: unknown): Map<string, number> | null {
  if (host && typeof host === "object") {
    const priv = host as { nonceCache?: Map<string, number> };
    if (priv.nonceCache instanceof Map) return priv.nonceCache;
  }
  return null;
}

/**
 * Build the nonce-manager rehydration stage. `getTxManager` is a
 * thunk rather than a direct ref because background.ts swaps the
 * TxManager instance on `switchChain` — we need the latest one at
 * the moment the hook fires.
 */
export function buildNonceManagerStage(deps: {
  storage: StageStorageAdapter;
  /** Fresh thunk each call — reflects the current active TxManager. */
  getTxManager: () => NonceHost;
  /** Fresh thunk each call — reflects the current active chain id (decimal). */
  getActiveChainId: () => number;
}): LifecycleStage {
  const { storage, getTxManager, getActiveChainId } = deps;

  async function readSnapshot(): Promise<NonceSnapshot | null> {
    try {
      const raw = await storage.get(NONCE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as NonceSnapshot;
      if (!parsed || typeof parsed !== "object" || typeof parsed.byAddress !== "object") {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async function writeSnapshot(snapshot: NonceSnapshot): Promise<void> {
    await storage.set(NONCE_STORAGE_KEY, JSON.stringify(snapshot));
  }

  function currentByAddress(): Record<string, Record<string, number>> {
    const host = getTxManager();
    if (host.exportNonceSnapshot) return host.exportNonceSnapshot();
    const cache = reachIntoCache(host);
    if (!cache) return {};
    const chainId = String(getActiveChainId());
    const out: Record<string, Record<string, number>> = {};
    for (const [addr, nextNonce] of cache) {
      out[addr.toLowerCase()] = { [chainId]: nextNonce };
    }
    return out;
  }

  function hydrate(snapshot: NonceSnapshot, ctx: LifecycleContext): number {
    const host = getTxManager();
    const cache = reachIntoCache(host);
    let restored = 0;
    for (const [addr, chainMap] of Object.entries(snapshot.byAddress)) {
      for (const [chainStr, nonce] of Object.entries(chainMap)) {
        const chainId = Number.parseInt(chainStr, 10);
        if (!Number.isFinite(chainId)) continue;
        if (host.loadNonceSnapshot) {
          host.loadNonceSnapshot(addr, chainId, nonce);
          restored += 1;
        } else if (cache && chainId === getActiveChainId()) {
          // Only hydrate into the live TxManager cache for the active
          // chain — other chains' caches live on different TxManager
          // instances that switchChain() will construct later.
          cache.set(addr.toLowerCase(), nonce);
          restored += 1;
        }
      }
    }
    if (restored > 0) {
      ctx.logger.info(
        "nonce.manager.restored",
        `Restored ${restored} nonce high-water marks.`,
        { restored, savedAt: snapshot.savedAt },
      );
    }
    return restored;
  }

  return {
    name: "nonce-manager",
    priority: 40,
    async onInstalled(ctx) {
      ctx.logger.info(
        "nonce.manager.installed",
        "Nonce manager: fresh install — no restoration needed.",
      );
    },
    async onStartup(ctx) {
      const snapshot = await readSnapshot();
      if (!snapshot) {
        ctx.logger.info(
          "nonce.manager.noSnapshot",
          "No persisted nonce snapshot — TxManager will seed lazily via eth_getTransactionCount.",
        );
        return;
      }
      hydrate(snapshot, ctx);
    },
    async onSuspend(ctx) {
      const byAddress = currentByAddress();
      if (Object.keys(byAddress).length === 0) {
        ctx.logger.info(
          "nonce.manager.suspendEmpty",
          "No cached nonces to persist.",
        );
        return;
      }
      await writeSnapshot({ byAddress, savedAt: Date.now() });
      ctx.logger.info(
        "nonce.manager.suspendPersisted",
        `Persisted nonce snapshot for ${Object.keys(byAddress).length} address(es).`,
        { addresses: Object.keys(byAddress).length },
      );
    },
  };
}
