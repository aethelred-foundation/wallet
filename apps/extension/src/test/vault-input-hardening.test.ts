import { describe, expect, it } from "vitest";
import {
  EncryptedStorage,
  KeyManager,
  LocalCustodyBackend,
  MasterKey,
  MemoryStorageAdapter,
} from "@aethelred/wallet-core";

const VALID_MNEMONIC = "test test test test test test test test test test test junk".split(" ");

async function createKernel() {
  const storage = new MemoryStorageAdapter();
  const masterKey = new MasterKey(storage);
  await masterKey.initialize("correct horse battery staple");
  const encryptedStorage = new EncryptedStorage(masterKey, storage);
  const custody = new LocalCustodyBackend(encryptedStorage);
  const keyManager = new KeyManager(custody, encryptedStorage);
  return { masterKey, custody, keyManager };
}

describe("vault input and memory hardening", () => {
  it("rejects unknown words and invalid BIP-39 checksums", async () => {
    const { keyManager } = await createKernel();
    await expect(
      keyManager.importFromMnemonic([...VALID_MNEMONIC.slice(0, 11), "not-a-bip39-word"]),
    ).rejects.toThrow(/unknown word|checksum/i);
    await expect(
      keyManager.importFromMnemonic([...VALID_MNEMONIC.slice(0, 11), "abandon"]),
    ).rejects.toThrow(/unknown word|checksum/i);
    expect(keyManager.getAccounts()).toEqual([]);
  });

  it("normalizes valid mnemonic words before encrypted persistence", async () => {
    const { keyManager } = await createKernel();
    const noisy = VALID_MNEMONIC.map((word, index) => index % 2 ? ` ${word.toUpperCase()} ` : word);
    await expect(keyManager.importFromMnemonic(noisy)).resolves.toBeDefined();
    await expect(keyManager.getRecoveryPhrase()).resolves.toEqual(VALID_MNEMONIC);
  });

  it("cannot sign from a decrypted key cache after lock-time zeroization", async () => {
    const { masterKey, custody } = await createKernel();
    const slot = await custody.importFromSeed(VALID_MNEMONIC, "Primary");
    masterKey.lock();
    custody.clearCache();

    await expect(custody.sign(slot.id, new Uint8Array(32))).rejects.toThrow(/locked/i);
  });
});
