/**
 * WalletConnect session rehydration stage (priority 70).
 *
 * WalletConnect sessions are long-lived — a session approved yesterday
 * must survive a browser restart, a laptop suspend, and every MV3 SW
 * eviction in between. Today `WalletConnectManager` keeps sessions in
 * an in-memory `Map` that resets on every SW wake; connected dApps see
 * a stale "disconnected" state until the user re-opens the wallet and
 * triggers re-pairing.
 *
 * This stage persists the active session map to `chrome.storage.local`
 * under a well-known key and re-hydrates on startup. The real SDK is
 * TODO, so the shape we persist is intentionally schema-stable:
 * `topic`, `chainIds`, `peer`, `expiresAt`. When the SDK lands we
 * re-subscribe to the relay for every rehydrated topic before the
 * first message arrives.
 *
 * If the manager surface doesn't yet expose
 * `{ getActiveSessions(), rehydrateSessions() }`, the stage degrades
 * gracefully to a log line so engineers see the wiring is ready for
 * the SDK but is a no-op today.
 */

import type { LifecycleStage } from "../sw-lifecycle";
import type { StageStorageAdapter } from "./types";

/** The persisted shape — a subset of `WalletConnectSession`. */
export interface WcSessionSnapshot {
  topic: string;
  peer: { name: string; url: string };
  expiresAt: number;
  chainIds: string[];
  accounts: string[];
}

/**
 * The live session shape the manager hands us. We accept either the
 * flat shape (`peer.url`, `expiresAt`) or the richer `WalletConnectSession`
 * (`peer.metadata.url`, `expiry` in unix seconds). The adapter normalizes
 * both into `WcSessionSnapshot`.
 */
export type LiveWcSession = {
  topic: string;
  /** Richer shape — peer.metadata, expiry (unix seconds). */
  peer?: {
    metadata?: { name?: string; url?: string };
    name?: string;
    url?: string;
  };
  /** Either `expiresAt` (unix ms) or `expiry` (unix seconds). */
  expiresAt?: number;
  expiry?: number;
  chainIds?: string[];
  accounts?: string[];
  /** The full namespaces map, which encodes accounts + chains per namespace. */
  namespaces?: Record<string, { accounts?: string[]; chains?: string[] }>;
};

/**
 * Narrowed surface of `WalletConnectManager` this stage uses. The real
 * class accepts a lot more — we only need the hooks for snapshot I/O
 * and (eventually) relay re-subscribe.
 */
export interface WcManagerLike {
  /** Return an immutable snapshot of active sessions. */
  getActiveSessions(): LiveWcSession[];
  /** Take a persisted list and re-subscribe to the relay for each topic. */
  rehydrateSessions?: (snapshots: WcSessionSnapshot[]) => Promise<void> | void;
}

/** Storage key for the persisted session list. */
export const WC_SESSION_STORAGE_KEY = "walletconnect-sessions";

/**
 * Build the WalletConnect rehydration stage.
 *
 * `getManager` is a thunk so we pick up lazy-initialized manager
 * references — background.ts lazily instantiates the manager the first
 * time a popup calls `wc-pair` or `wc-sessions`. The stage gracefully
 * no-ops if the manager is still null.
 */
export function buildWalletConnectSessionStage(deps: {
  storage: StageStorageAdapter;
  getManager: () => WcManagerLike | null;
}): LifecycleStage {
  const { storage, getManager } = deps;

  async function readSnapshots(): Promise<WcSessionSnapshot[]> {
    try {
      const raw = await storage.get(WC_SESSION_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (s): s is WcSessionSnapshot =>
          s && typeof s === "object" && typeof (s as WcSessionSnapshot).topic === "string",
      );
    } catch {
      return [];
    }
  }

  async function writeSnapshots(snapshots: WcSessionSnapshot[]): Promise<void> {
    await storage.set(WC_SESSION_STORAGE_KEY, JSON.stringify(snapshots));
  }

  function toSnapshot(session: LiveWcSession): WcSessionSnapshot {
    // Normalize `peer` — accept `{ metadata: { name, url } }` (the real
    // `WalletConnectSession` shape) OR the flat `{ name, url }` shape
    // tests use.
    const peerName = session.peer?.metadata?.name ?? session.peer?.name ?? "";
    const peerUrl = session.peer?.metadata?.url ?? session.peer?.url ?? "";
    // Normalize expires — accept `expiresAt` (unix ms) or `expiry` (unix
    // seconds). The SDK speaks seconds; our persisted shape speaks ms.
    const expiresAt =
      typeof session.expiresAt === "number"
        ? session.expiresAt
        : typeof session.expiry === "number"
          ? session.expiry * 1000
          : 0;
    // Derive chainIds + accounts from the namespaces map if they weren't
    // set directly.
    let chainIds = session.chainIds ?? [];
    let accounts = session.accounts ?? [];
    if ((!chainIds.length || !accounts.length) && session.namespaces) {
      const allChains = new Set<string>();
      const allAccounts = new Set<string>();
      for (const ns of Object.values(session.namespaces)) {
        for (const c of ns.chains ?? []) allChains.add(c);
        for (const a of ns.accounts ?? []) allAccounts.add(a);
      }
      if (!chainIds.length) chainIds = Array.from(allChains);
      if (!accounts.length) accounts = Array.from(allAccounts);
    }
    return {
      topic: session.topic,
      peer: { name: peerName, url: peerUrl },
      expiresAt,
      chainIds,
      accounts,
    };
  }

  return {
    name: "walletconnect-session",
    priority: 70,
    async onInstalled(ctx) {
      ctx.logger.info(
        "wc.session.installed",
        "WalletConnect: fresh install — no sessions to restore.",
      );
    },
    async onStartup(ctx) {
      const snapshots = await readSnapshots();
      if (snapshots.length === 0) {
        ctx.logger.info(
          "wc.session.noSnapshot",
          "No persisted WalletConnect sessions to restore.",
        );
        return;
      }
      const manager = getManager();
      if (!manager) {
        // Manager is lazy-initialized — re-subscribe will happen the
        // first time a popup calls wc-sessions. The snapshot remains
        // on disk, so no work is lost.
        ctx.logger.info(
          "wc.session.managerLazy",
          "WalletConnect manager not yet instantiated; deferring rehydration.",
          { pendingSnapshots: snapshots.length },
        );
        return;
      }
      if (typeof manager.rehydrateSessions !== "function") {
        ctx.logger.warn(
          "wc.session.noRehydrateApi",
          "WalletConnectManager.rehydrateSessions not available; rehydration is stubbed.",
          { pendingSnapshots: snapshots.length },
        );
        return;
      }
      // Discard any expired entries BEFORE handing off to the manager —
      // the SDK will re-subscribe for every entry it receives and
      // charging the relay for dead topics is wasteful.
      const now = Date.now();
      const live = snapshots.filter((s) => s.expiresAt > now);
      if (live.length === 0) {
        ctx.logger.info(
          "wc.session.allExpired",
          "Every persisted WalletConnect session has already expired — skipping rehydrate.",
        );
        await writeSnapshots([]);
        return;
      }
      try {
        await manager.rehydrateSessions(live);
        ctx.logger.info(
          "wc.session.rehydrated",
          `Rehydrated ${live.length} WalletConnect session(s).`,
          { count: live.length },
        );
      } catch (err) {
        ctx.logger.error(
          "wc.session.rehydrateFailed",
          "WalletConnectManager.rehydrateSessions threw.",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    },
    async onSuspend(ctx) {
      const manager = getManager();
      if (!manager) return;
      try {
        const sessions = manager.getActiveSessions();
        if (sessions.length === 0) {
          await writeSnapshots([]);
          return;
        }
        await writeSnapshots(sessions.map(toSnapshot));
        ctx.logger.info(
          "wc.session.suspendPersisted",
          `Persisted ${sessions.length} WalletConnect session(s) on onSuspend.`,
          { count: sessions.length },
        );
      } catch (err) {
        ctx.logger.warn(
          "wc.session.suspendFailed",
          "WalletConnect session persist threw on onSuspend.",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    },
  };
}

/**
 * Helper for other subsystems that want to persist on mutation. Used
 * by the `wc-pair` / `wc-disconnect` handlers.
 */
export async function persistWalletConnectSessions(
  storage: StageStorageAdapter,
  manager: WcManagerLike | null,
): Promise<void> {
  if (!manager) return;
  try {
    const sessions = manager.getActiveSessions();
    const snapshots = sessions.map<WcSessionSnapshot>((s) => {
      const peerName = s.peer?.metadata?.name ?? s.peer?.name ?? "";
      const peerUrl = s.peer?.metadata?.url ?? s.peer?.url ?? "";
      const expiresAt =
        typeof s.expiresAt === "number"
          ? s.expiresAt
          : typeof s.expiry === "number"
            ? s.expiry * 1000
            : 0;
      let chainIds = s.chainIds ?? [];
      let accounts = s.accounts ?? [];
      if ((!chainIds.length || !accounts.length) && s.namespaces) {
        const allChains = new Set<string>();
        const allAccounts = new Set<string>();
        for (const ns of Object.values(s.namespaces)) {
          for (const c of ns.chains ?? []) allChains.add(c);
          for (const a of ns.accounts ?? []) allAccounts.add(a);
        }
        if (!chainIds.length) chainIds = Array.from(allChains);
        if (!accounts.length) accounts = Array.from(allAccounts);
      }
      return {
        topic: s.topic,
        peer: { name: peerName, url: peerUrl },
        expiresAt,
        chainIds,
        accounts,
      };
    });
    await storage.set(WC_SESSION_STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // Persistence is best-effort; the onSuspend hook will retry.
  }
}
