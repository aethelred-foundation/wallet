import { describe, expect, it, vi } from "vitest";
import {
  EncryptedStorage,
  LocalCustodyBackend,
  LockedError,
  MasterKey,
  Signer,
  type CustodyBackend,
  type PolicyDecisionToken,
  type SigningRequest,
  type StorageAdapter,
} from "@aethelred/wallet-core";

const PASSWORD = "correct horse battery staple";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

class DeferredStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>();
  private blockedRead: {
    key: string;
    started: Deferred<void>;
    release: Deferred<void>;
  } | null = null;

  blockNextRead(key: string) {
    const started = deferred<void>();
    const release = deferred<void>();
    this.blockedRead = { key, started, release };
    return { started: started.promise, release: () => release.resolve() };
  }

  async get(key: string): Promise<string | null> {
    const blocked = this.blockedRead;
    if (blocked?.key === key) {
      this.blockedRead = null;
      blocked.started.resolve();
      await blocked.release.promise;
    }
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function allowToken(): PolicyDecisionToken {
  return { intentId: "lock-race-test", outcome: "allow", timestamp: Date.now() };
}

function signingRequest(type: SigningRequest["type"]): SigningRequest {
  return {
    keySlotId: "slot-1",
    data: type === "message" ? new TextEncoder().encode("authorize login") : new Uint8Array(32),
    type,
  };
}

async function createUnlockedMasterKey(): Promise<MasterKey> {
  const masterKey = new MasterKey(new DeferredStorageAdapter());
  await masterKey.initialize(PASSWORD);
  return masterKey;
}

describe("vault lock epoch", () => {
  it("rejects and wipes a message signature across a lock and later unlock", async () => {
    const masterKey = await createUnlockedMasterKey();
    const signStarted = deferred<void>();
    const signatureReady = deferred<Uint8Array>();
    const custody = {
      sign: async () => {
        signStarted.resolve();
        return signatureReady.promise;
      },
    } as unknown as CustodyBackend;
    const signer = new Signer(masterKey, custody);
    const signature = new Uint8Array(65).fill(0x7a);

    const pending = signer.signMessage(signingRequest("message"), allowToken());
    const rejection = expect(pending).rejects.toBeInstanceOf(LockedError);
    await signStarted.promise;
    masterKey.lock();
    await masterKey.unlock(PASSWORD);
    signatureReady.resolve(signature);

    await rejection;
    expect(signature).toEqual(new Uint8Array(65));
    masterKey.lock();
  });

  it.each(["digest", "raw"] as const)(
    "rejects and wipes a %s transaction signature that finishes after lock",
    async (path) => {
      const masterKey = await createUnlockedMasterKey();
      const signStarted = deferred<void>();
      const signatureReady = deferred<Uint8Array>();
      const sign = async () => {
        signStarted.resolve();
        return signatureReady.promise;
      };
      const custody = {
        sign,
        ...(path === "raw" ? { signTransactionBytes: sign } : {}),
      } as unknown as CustodyBackend;
      const signer = new Signer(masterKey, custody);
      const signature = new Uint8Array(65).fill(0x5c);
      const request = signingRequest("transaction");

      const pending = path === "raw"
        ? signer.signTransactionRaw(request, allowToken())
        : signer.signTransaction(request, allowToken());
      const rejection = expect(pending).rejects.toBeInstanceOf(LockedError);
      await signStarted.promise;
      masterKey.lock();
      signatureReady.resolve(signature);

      await rejection;
      expect(signature).toEqual(new Uint8Array(65));
    },
  );

  it("does not return plaintext when the vault locks during WebCrypto decrypt", async () => {
    const masterKey = await createUnlockedMasterKey();
    const payload = await masterKey.encrypt("decrypted secret");
    const decryptStarted = deferred<void>();
    const decryptRelease = deferred<void>();
    const originalDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(
      async (algorithm, key, data) => {
        decryptStarted.resolve();
        await decryptRelease.promise;
        return originalDecrypt(algorithm, key, data);
      },
    );

    try {
      const pending = masterKey.decrypt(payload);
      const rejection = expect(pending).rejects.toBeInstanceOf(LockedError);
      await decryptStarted.promise;
      masterKey.lock();
      decryptRelease.resolve();
      await rejection;
    } finally {
      spy.mockRestore();
      masterKey.lock();
    }
  });

  it("does not repopulate local custody cache from a read completed after clear", async () => {
    const storage = new DeferredStorageAdapter();
    const masterKey = new MasterKey(storage);
    await masterKey.initialize(PASSWORD);
    const encryptedStorage = new EncryptedStorage(masterKey, storage);
    const custody = new LocalCustodyBackend(encryptedStorage);
    const privateKey = new Uint8Array(32);
    privateKey[31] = 1;
    const slot = await custody.importFromPrivateKey(privateKey, "Race test");
    custody.clearCache();

    const read = storage.blockNextRead(`encrypted:key-slot:${slot.id}`);
    const pending = custody.sign(slot.id, new Uint8Array(32));
    const rejection = expect(pending).rejects.toBeInstanceOf(LockedError);
    await read.started;
    custody.clearCache();
    read.release();

    await rejection;
    const cache = (custody as unknown as { keyCache: Map<string, Uint8Array> }).keyCache;
    expect(cache.size).toBe(0);
    expect(masterKey.isLocked()).toBe(false);
    masterKey.lock();
  });
});
