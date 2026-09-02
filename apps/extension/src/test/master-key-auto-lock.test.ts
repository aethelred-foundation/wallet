import { afterEach, describe, expect, it, vi } from "vitest";
import { MasterKey, MemoryStorageAdapter } from "@aethelred/wallet-core";

afterEach(() => vi.useRealTimers());

describe("MasterKey configurable auto-lock", () => {
  it("applies a changed timeout immediately and invokes the observer", async () => {
    vi.useFakeTimers();
    const onAutoLock = vi.fn();
    const key = new MasterKey(new MemoryStorageAdapter(), 5 * 60_000, onAutoLock);
    await key.initialize("correct horse battery staple");

    key.setAutoLockMs(60_000);
    expect(key.getAutoLockMs()).toBe(60_000);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(key.isLocked()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(key.isLocked()).toBe(true);
    expect(onAutoLock).toHaveBeenCalledTimes(1);
  });

  it("rejects timeouts outside the supported 1-60 minute range", () => {
    const key = new MasterKey(new MemoryStorageAdapter());
    expect(() => key.setAutoLockMs(59_999)).toThrow(/between 1 and 60 minutes/i);
    expect(() => key.setAutoLockMs(60 * 60_000 + 1)).toThrow(/between 1 and 60 minutes/i);
  });

  it("refuses to overwrite an initialized vault and supports setup-only rollback", async () => {
    const storage = new MemoryStorageAdapter();
    const key = new MasterKey(storage);
    await key.initialize("first password");
    await expect(key.initialize("replacement password")).rejects.toThrow(/already initialized/i);

    key.lock();
    await key.rollbackInitialization();
    expect(await key.isInitialized()).toBe(false);
    await expect(key.initialize("retry after failed setup")).resolves.toBeUndefined();
  });

  it("persists the passkey requirement inside the durable vault marker", async () => {
    const storage = new MemoryStorageAdapter();
    const key = new MasterKey(storage);
    await key.initialize("correct horse battery staple");
    expect(await key.getPasskeyPolicy()).toBe("none");

    await key.setPasskeyPolicy("required");
    const restarted = new MasterKey(storage);
    expect(await restarted.getPasskeyPolicy()).toBe("required");
  });

  it("does not interpret a malformed vault marker as password-only", async () => {
    const storage = new MemoryStorageAdapter();
    await storage.set("master-key-check", "{broken");
    const key = new MasterKey(storage);
    await expect(key.getPasskeyPolicy()).rejects.toThrow(/passkey policy/i);
  });
});
