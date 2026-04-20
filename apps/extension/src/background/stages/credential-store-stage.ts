/**
 * Credential-store rehydration stage (priority 60).
 *
 * The `CredentialStore` from `@aethelred/wallet-identity` holds WebAuthn
 * passkey material that backs the optional 2FA unlock. The manager
 * accepts a `{ credentialId, publicKeyJwk, counter }` tuple on
 * enrollment and uses it on `passkey-verify`. Today the store is
 * in-memory only — which silently resets on every SW wake, locking the
 * user out of their 2FA unlock path until they re-enroll.
 *
 * This stage persists the credential list under a single JSON key and
 * restores it on startup. The list is tiny (usually 1-3 entries) so
 * there's no pagination — the whole thing serializes in one write.
 *
 * Privacy note: the stored data is the WebAuthn credential ID + public
 * key + counter. NO biometric template and NO private key ever leaves
 * the authenticator, so this storage is safe under standard threat
 * models (including a malicious content script reading
 * `chrome.storage.local`).
 */

import type { LifecycleStage } from "../sw-lifecycle";
import type { StageStorageAdapter } from "./types";

/**
 * Opaque, storage-only credential shape. The real credentials from
 * `@aethelred/wallet-identity` carry a richer structure (subjectId,
 * type, label, issuedAt …) — this stage doesn't care about any of
 * those fields; it just round-trips the serialized JSON blob. We
 * keep the shape `unknown`-typed so the stage stays decoupled from
 * the identity package's internal schema.
 */
export type CredentialSnapshot = Record<string, unknown>;

/**
 * Shape of the credential-store surface we need. Narrowed to avoid
 * pinning this stage to `@aethelred/wallet-identity` internals.
 *
 * The method signatures intentionally accept/return `unknown[]` (with
 * a runtime-only cast inside the stage) so the concrete `CredentialStore`
 * from `@aethelred/wallet-identity` — which types these as `Credential[]`
 * — is structurally compatible. Due to TypeScript's function-parameter
 * bivariance for `loadFromSnapshot`, a method taking `Credential[]` is
 * only assignable to one taking `unknown[]` when the target is typed
 * as a method (using `(e: unknown[]): void` method syntax instead of
 * an arrow-function property) — so that's what this interface uses.
 */
export interface CredentialStoreLike {
  /** Replace the in-memory list with the stored entries. */
  loadFromSnapshot?(entries: unknown[]): void;
  /** Export the in-memory list for persistence. */
  toSnapshot?(): unknown[];
}

/** Storage key the stage writes under. */
export const CREDENTIAL_STORE_KEY = "credential-store-snapshot";

/**
 * Build the credential-store stage.
 *
 * The store surface is optional because the current `CredentialStore`
 * in `@aethelred/wallet-identity` has not yet published the snapshot
 * API. Until it does, we surface a clear log line on boot so
 * engineering knows 2FA state is in-memory and NOT persistence-backed
 * — the existing behavior, but visible.
 */
export function buildCredentialStoreStage(deps: {
  storage: StageStorageAdapter;
  getStore: () => CredentialStoreLike;
}): LifecycleStage {
  const { storage, getStore } = deps;

  async function readSnapshot(): Promise<CredentialSnapshot[] | null> {
    try {
      const raw = await storage.get(CREDENTIAL_STORE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed as CredentialSnapshot[];
    } catch {
      return null;
    }
  }

  async function writeSnapshot(entries: CredentialSnapshot[]): Promise<void> {
    await storage.set(CREDENTIAL_STORE_KEY, JSON.stringify(entries));
  }

  return {
    name: "credential-store",
    priority: 60,
    async onInstalled(ctx) {
      ctx.logger.info(
        "credential.store.installed",
        "Credential store: fresh install — no passkeys enrolled yet.",
      );
    },
    async onStartup(ctx) {
      const snapshot = await readSnapshot();
      if (!snapshot) {
        ctx.logger.info(
          "credential.store.noSnapshot",
          "No persisted credential snapshot — no passkeys were previously enrolled.",
        );
        return;
      }
      const store = getStore();
      if (typeof store.loadFromSnapshot !== "function") {
        // The identity package hasn't shipped the snapshot API yet —
        // log so engineers know 2FA is still in-memory until that
        // lands.
        ctx.logger.warn(
          "credential.store.noLoadApi",
          "CredentialStore.loadFromSnapshot not available; passkey enrollment is in-memory only.",
          { persistedEntries: snapshot.length },
        );
        return;
      }
      store.loadFromSnapshot(snapshot as unknown[]);
      ctx.logger.info(
        "credential.store.restored",
        `Restored ${snapshot.length} credential(s) from snapshot.`,
        { count: snapshot.length },
      );
    },
    async onSuspend(ctx) {
      const store = getStore();
      if (typeof store.toSnapshot !== "function") return;
      const entries = store.toSnapshot() as CredentialSnapshot[];
      if (entries.length === 0) return;
      try {
        await writeSnapshot(entries);
        ctx.logger.info(
          "credential.store.suspendPersisted",
          `Persisted ${entries.length} credential(s) on onSuspend.`,
          { count: entries.length },
        );
      } catch (err) {
        ctx.logger.warn(
          "credential.store.suspendFailed",
          "Persist of credential snapshot on onSuspend threw.",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    },
  };
}
