/**
 * Regression: the lock-state contract the background broadcasts after wallet
 * creation.
 *
 * Bug (testnet launch): the background's `broadcastState` carries wallet data
 * but never the lock state, and the popup's App gate routes on
 * `lockState.initialized`. After `init-wallet`, the popup's `initialized` flag
 * stayed false, so finishing onboarding bounced the user back to the creation
 * screen. The fix adds `broadcastLockState()` at every lock-state transition
 * (init, import, unlock, lock).
 *
 * `background.ts` pulls Chrome globals at import time and cannot be imported
 * here, so this test pins the invariant the broadcast payload is built from:
 * `{ locked: masterKey.isLocked(), initialized: await masterKey.isInitialized() }`.
 * If this contract holds, a broadcast at the wired transition points delivers
 * the correct flags to the popup.
 */

import { MasterKey, MemoryStorageAdapter } from "@aethelred/wallet-core";
import { describe, expect, it } from "vitest";

const PASSWORD = "correct-horse-battery-staple";

describe("lock-state broadcast contract", () => {
  it("after initialize(): unlocked and initialized (the payload onboarding needs)", async () => {
    const storage = new MemoryStorageAdapter();
    const masterKey = new MasterKey(storage);

    // Fresh install: onboarding must be shown.
    expect(await masterKey.isInitialized()).toBe(false);

    await masterKey.initialize(PASSWORD);

    // The exact payload broadcastLockState sends after init-wallet.
    const payload = {
      locked: masterKey.isLocked(),
      initialized: await masterKey.isInitialized(),
    };
    expect(payload).toEqual({ locked: false, initialized: true });
  });

  it("initialized state persists across a new instance (service-worker restart)", async () => {
    const storage = new MemoryStorageAdapter();
    await new MasterKey(storage).initialize(PASSWORD);

    // MV3 tears the service worker down; a fresh MasterKey reads the same
    // durable storage. It is initialized (so no onboarding) but locked (so the
    // lock screen shows, never the creation screen).
    const restarted = new MasterKey(storage);
    expect(await restarted.isInitialized()).toBe(true);
    expect(restarted.isLocked()).toBe(true);

    await restarted.unlock(PASSWORD);
    expect(restarted.isLocked()).toBe(false);
  });
});
