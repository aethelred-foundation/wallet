/**
 * Private key export.
 *
 * The feature exists because an account created in this wallet is otherwise
 * unusable from a deployment script — the recovery phrase backs up the wallet,
 * but nothing hands a single account's key to a tool that needs one.
 *
 * The tests that matter here are the refusals. An export is the most dangerous
 * value the wallet holds, so what it must NOT do is more interesting than what
 * it does: it must never invent a key for a backend that has none, and it must
 * never widen from one account to the whole derivation tree.
 */

import { describe, expect, it } from "vitest";

import { KeyManager, LocalCustodyBackend } from "@aethelred/wallet-core";

const MNEMONIC =
  "test test test test test test test test test test test junk".split(" ");

/**
 * Stand-in for EncryptedStorage. captureUnlockedEpoch is part of the contract:
 * the real implementation uses it to detect a lock happening mid-operation, so
 * a stub without it fails in a way that has nothing to do with the test.
 */
function memoryStorage() {
  const map = new Map<string, unknown>();
  return {
    captureUnlockedEpoch: () => 1,
    assertUnlockedAtEpoch: () => {},
    get: async <T,>(key: string) => (map.get(key) ?? null) as T | null,
    set: async (key: string, value: unknown) => void map.set(key, value),
    delete: async (key: string) => void map.delete(key),
  };
}

async function localWallet() {
  const storage = memoryStorage();
  const custody = new LocalCustodyBackend(storage as never);
  const manager = new KeyManager(custody as never, storage as never);
  await manager.importFromMnemonic(MNEMONIC, "Account 1");
  return { manager, custody };
}

describe("exportPrivateKey", () => {
  it("returns a 32-byte key as 0x-prefixed hex", async () => {
    const { manager } = await localWallet();
    const [account] = manager.getAccounts();

    const key = await manager.exportPrivateKey(account.id);

    expect(key).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("returns the key that actually controls the account", async () => {
    // The check that makes this feature worth having: a key that does not
    // derive back to the displayed address would send a developer's funds
    // somewhere they did not intend.
    const { manager, custody } = await localWallet();
    const [account] = manager.getAccounts();

    const key = await manager.exportPrivateKey(account.id);
    const reimportStorage = memoryStorage();
    const reimportCustody = new LocalCustodyBackend(reimportStorage as never);
    const reimported = new KeyManager(
      reimportCustody as never,
      reimportStorage as never,
    );
    await reimported.importFromPrivateKey(
      Uint8Array.from(
        (key.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)),
      ),
      "Reimported",
    );

    expect(reimported.getAccounts()[0].address.toLowerCase()).toBe(
      account.address.toLowerCase(),
    );
    expect(custody.capabilities.canExportPrivateKey).toBe(true);
  });

  it("exports ONE account, not the whole derivation tree", async () => {
    // Deliberately narrower than the recovery phrase. Two accounts from the
    // same mnemonic must not yield the same key.
    const { manager } = await localWallet();
    await manager.deriveNextAccount("Account 2");
    const [first, second] = manager.getAccounts();

    const keyOne = await manager.exportPrivateKey(first.id);
    const keyTwo = await manager.exportPrivateKey(second.id);

    expect(keyOne).not.toBe(keyTwo);
  });

  it("refuses an unknown account", async () => {
    const { manager } = await localWallet();
    await expect(manager.exportPrivateKey("no-such-account")).rejects.toThrow(
      /Account not found/u,
    );
  });

  it("refuses a backend whose key is not extractable", async () => {
    // A hardware or MPC slot has no key to hand over. Returning anything at
    // all — a placeholder, a derived value — would be worse than failing,
    // because the caller would carry it away believing it was a key.
    const { manager, custody } = await localWallet();
    const [account] = manager.getAccounts();

    Object.defineProperty(custody, "capabilities", {
      value: { ...custody.capabilities, canExportPrivateKey: false },
      configurable: true,
    });

    await expect(manager.exportPrivateKey(account.id)).rejects.toThrow(
      /not extractable/u,
    );
  });
});
