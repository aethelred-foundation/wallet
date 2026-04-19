import { LockedError, StorageError } from "./errors";
import type { MasterKey } from "./master-key";
import type { StorageAdapter, StorageKey } from "./types";

/**
 * EncryptedStorage wraps a StorageAdapter with AES-GCM encryption.
 * All values are encrypted/decrypted using the MasterKey before storage.
 * When the wallet is locked, read/write operations throw LockedError.
 */
export class EncryptedStorage {
  constructor(
    private readonly masterKey: MasterKey,
    private readonly storage: StorageAdapter
  ) {}

  async get<T>(key: StorageKey): Promise<T | null> {
    if (this.masterKey.isLocked()) throw new LockedError();

    try {
      const encrypted = await this.storage.get(`encrypted:${key}`);
      if (encrypted === null) return null;

      const decrypted = await this.masterKey.decrypt(encrypted);
      return JSON.parse(decrypted) as T;
    } catch (error) {
      if (error instanceof LockedError) throw error;
      throw new StorageError(`get ${key}`, error);
    }
  }

  async set<T>(key: StorageKey, value: T): Promise<void> {
    if (this.masterKey.isLocked()) throw new LockedError();

    try {
      const serialized = JSON.stringify(value);
      const encrypted = await this.masterKey.encrypt(serialized);
      await this.storage.set(`encrypted:${key}`, encrypted);
    } catch (error) {
      if (error instanceof LockedError) throw error;
      throw new StorageError(`set ${key}`, error);
    }
  }

  async delete(key: StorageKey): Promise<void> {
    try {
      await this.storage.delete(`encrypted:${key}`);
    } catch (error) {
      throw new StorageError(`delete ${key}`, error);
    }
  }

  async has(key: StorageKey): Promise<boolean> {
    try {
      const value = await this.storage.get(`encrypted:${key}`);
      return value !== null;
    } catch {
      return false;
    }
  }
}

/**
 * ChromeStorageAdapter uses chrome.storage.local as the backing store.
 * Works in extension background and popup contexts.
 */
export class ChromeStorageAdapter implements StorageAdapter {
  async get(key: string): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve((result[key] as string) ?? null);
      });
    });
  }

  async set(key: string, value: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  async delete(key: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, resolve);
    });
  }
}

/**
 * MemoryStorageAdapter for testing and non-extension contexts.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
