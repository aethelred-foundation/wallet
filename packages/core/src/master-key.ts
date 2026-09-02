import {
  AlreadyInitializedError,
  InvalidPasswordError,
  LockedError,
  StorageError,
} from "./errors";
import type { StorageAdapter } from "./types";

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const CHECK_VALUE = "aethelred-wallet-v1";
const AUTO_LOCK_MS = 5 * 60 * 1000; // 5 minutes
export type PasskeyPolicy = "required" | "none" | "unknown";

/**
 * MasterKey derives an AES-GCM encryption key from the user's password via PBKDF2.
 * The derived key is held in memory only - never persisted.
 * Provides lock/unlock lifecycle with auto-lock on idle.
 */
export class MasterKey {
  private derivedKey: CryptoKey | null = null;
  private lastActivity = 0;
  private autoLockTimer: ReturnType<typeof setTimeout> | null = null;
  private autoLockMs: number;
  private onAutoLock: (() => void | Promise<void>) | null;
  private initializing = false;
  /**
   * Monotonically identifies the currently active vault-key lifetime.
   * Every lock and every successful key installation advances the epoch so
   * work that crossed a lock/unlock boundary can never be mistaken for work
   * that belongs to the new unlocked session.
   */
  private vaultEpoch = 0;

  constructor(
    private readonly storage: StorageAdapter,
    autoLockMs = AUTO_LOCK_MS,
    onAutoLock: (() => void | Promise<void>) | null = null,
  ) {
    this.autoLockMs = autoLockMs;
    this.onAutoLock = onAutoLock;
  }

  isLocked(): boolean {
    return this.derivedKey === null;
  }

  /** Capture the current unlocked vault lifetime for an async operation. */
  captureUnlockedEpoch(): number {
    if (!this.derivedKey) throw new LockedError();
    return this.vaultEpoch;
  }

  /**
   * Fail closed when async work outlives the unlocked vault lifetime in
   * which it started. A subsequent unlock deliberately does not make a
   * stale operation valid again.
   */
  assertUnlockedAtEpoch(epoch: number): void {
    if (!this.derivedKey || this.vaultEpoch !== epoch) throw new LockedError();
  }

  /**
   * Unix ms of the last `touchActivity` call, or `0` if the wallet has
   * never been unlocked in this session. Used by the UI to drive the
   * "idle for Xm" status row and to power auto-lock diagnostics.
   */
  getLastActivity(): number {
    return this.lastActivity;
  }

  /** Current idle timeout in milliseconds. */
  getAutoLockMs(): number {
    return this.autoLockMs;
  }

  /**
   * Update the idle timeout. When the wallet is unlocked the countdown is
   * restarted immediately so the new policy takes effect without a reload.
   */
  setAutoLockMs(autoLockMs: number): void {
    if (!Number.isFinite(autoLockMs) || autoLockMs < 60_000 || autoLockMs > 60 * 60_000) {
      throw new RangeError("Auto-lock timeout must be between 1 and 60 minutes");
    }
    this.autoLockMs = Math.trunc(autoLockMs);
    if (!this.isLocked()) this.resetAutoLock();
  }

  /** Replace the callback invoked only when the idle timer locks the key. */
  setAutoLockHandler(handler: (() => void | Promise<void>) | null): void {
    this.onAutoLock = handler;
  }

  touchActivity(): void {
    this.lastActivity = Date.now();
    this.resetAutoLock();
  }

  async initialize(password: string): Promise<void> {
    if (this.initializing || await this.isInitialized()) {
      throw new AlreadyInitializedError();
    }
    this.initializing = true;
    const operationEpoch = this.vaultEpoch;
    try {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const key = await this.deriveKey(password, salt);
      this.assertEpochUnchanged(operationEpoch);

      const encrypted = await this.encryptValue(key, CHECK_VALUE);
      this.assertEpochUnchanged(operationEpoch);
      const payload = JSON.stringify({
        salt: toBase64(salt),
        iv: toBase64(encrypted.iv),
        ciphertext: toBase64(encrypted.ciphertext),
        passkeyPolicy: "none",
      });

      try {
        await this.storage.set("master-key-check", payload);
        this.assertEpochUnchanged(operationEpoch);
      } catch (cause) {
        if (cause instanceof LockedError) throw cause;
        throw new StorageError("initialize master key", cause);
      }

      this.derivedKey = key;
      this.vaultEpoch += 1;
      this.touchActivity();
    } finally {
      this.initializing = false;
    }
  }

  async unlock(password: string): Promise<void> {
    const operationEpoch = this.vaultEpoch;
    const key = await this.deriveVerifiedKey(password);
    this.assertEpochUnchanged(operationEpoch);
    this.derivedKey = key;
    this.vaultEpoch += 1;
    this.touchActivity();
  }

  /** Verify the password without unlocking or extending the idle timer. */
  async verifyPassword(password: string): Promise<void> {
    await this.deriveVerifiedKey(password);
  }

  private async deriveVerifiedKey(password: string): Promise<CryptoKey> {
    const raw = await this.storage.get("master-key-check");
    if (!raw) {
      throw new StorageError("unlock", "No master key check value found. Wallet not initialized.");
    }

    const { salt, iv, ciphertext } = JSON.parse(raw) as {
      salt: string;
      iv: string;
      ciphertext: string;
    };

    const key = await this.deriveKey(password, fromBase64(salt));

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(iv) },
        key,
        fromBase64(ciphertext)
      );
      const value = new TextDecoder().decode(decrypted);
      if (value !== CHECK_VALUE) {
        throw new InvalidPasswordError();
      }
    } catch (error) {
      if (error instanceof InvalidPasswordError) throw error;
      throw new InvalidPasswordError();
    }
    return key;
  }

  lock(): void {
    this.derivedKey = null;
    this.vaultEpoch += 1;
    this.lastActivity = 0;
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
      this.autoLockTimer = null;
    }
  }

  async isInitialized(): Promise<boolean> {
    const raw = await this.storage.get("master-key-check");
    return raw !== null;
  }

  /** Read the durable second-factor policy without unlocking the vault. */
  async getPasskeyPolicy(): Promise<PasskeyPolicy> {
    const raw = await this.storage.get("master-key-check");
    if (!raw) return "unknown";
    try {
      const parsed = JSON.parse(raw) as { passkeyPolicy?: unknown };
      return parsed.passkeyPolicy === "required" || parsed.passkeyPolicy === "none"
        ? parsed.passkeyPolicy
        : "unknown";
    } catch (cause) {
      throw new StorageError("read passkey policy", cause);
    }
  }

  /** Persist whether this vault must fail closed behind a passkey. */
  async setPasskeyPolicy(policy: Exclude<PasskeyPolicy, "unknown">): Promise<void> {
    const raw = await this.storage.get("master-key-check");
    if (!raw) throw new StorageError("set passkey policy", "Wallet is not initialized");
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.passkeyPolicy = policy;
      await this.storage.set("master-key-check", JSON.stringify(parsed));
    } catch (cause) {
      if (cause instanceof StorageError) throw cause;
      throw new StorageError("set passkey policy", cause);
    }
  }

  /**
   * Roll back a failed first-run setup. This is intentionally separate from
   * normal wallet reset and is only safe before a usable vault exists.
   */
  async rollbackInitialization(): Promise<void> {
    try {
      await this.storage.delete("master-key-check");
    } catch (cause) {
      throw new StorageError("roll back master key initialization", cause);
    } finally {
      this.lock();
    }
  }

  async encrypt(plaintext: string): Promise<string> {
    const epoch = this.captureUnlockedEpoch();
    const key = this.derivedKey as CryptoKey;
    this.touchActivity();

    const encrypted = await this.encryptValue(key, plaintext);
    try {
      this.assertUnlockedAtEpoch(epoch);
      return JSON.stringify({
        iv: toBase64(encrypted.iv),
        ciphertext: toBase64(encrypted.ciphertext),
      });
    } finally {
      encrypted.ciphertext.fill(0);
    }
  }

  async decrypt(payload: string): Promise<string> {
    const epoch = this.captureUnlockedEpoch();
    const key = this.derivedKey as CryptoKey;
    this.touchActivity();

    const { iv, ciphertext } = JSON.parse(payload) as {
      iv: string;
      ciphertext: string;
    };

    let plaintextBytes: Uint8Array | null = null;
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(iv) },
        key,
        fromBase64(ciphertext)
      );
      plaintextBytes = new Uint8Array(decrypted);
      this.assertUnlockedAtEpoch(epoch);
      return new TextDecoder().decode(plaintextBytes);
    } catch (error) {
      // A lock always wins over a concurrent decrypt failure or success.
      this.assertUnlockedAtEpoch(epoch);
      if (error instanceof LockedError) throw error;
      throw new InvalidPasswordError();
    } finally {
      plaintextBytes?.fill(0);
    }
  }

  /**
   * The `salt` parameter is typed `Uint8Array<ArrayBuffer>` so that
   * `crypto.subtle.deriveKey` accepts it under the TS 5.7 stricter
   * `BufferSource` type which excludes `SharedArrayBuffer`. All
   * callers pass `fromBase64(...)` which now returns the concrete
   * `Uint8Array<ArrayBuffer>` variant.
   */
  private async deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    // Copy the TextEncoder output into a Uint8Array<ArrayBuffer> to satisfy
    // the stricter BufferSource type.
    const encoded = encoder.encode(password);
    const passwordBuf = new Uint8Array(new ArrayBuffer(encoded.length));
    passwordBuf.set(encoded);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBuf,
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  private async encryptValue(
    key: CryptoKey,
    value: string
  ): Promise<{ iv: Uint8Array<ArrayBuffer>; ciphertext: Uint8Array<ArrayBuffer> }> {
    const iv = new Uint8Array(new ArrayBuffer(IV_LENGTH));
    crypto.getRandomValues(iv);
    const encoded = new TextEncoder().encode(value);
    const encodedBuf = new Uint8Array(new ArrayBuffer(encoded.length));
    encodedBuf.set(encoded);

    try {
      const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encodedBuf);
      const ciphertext = new Uint8Array(cipherBuf);
      return { iv, ciphertext };
    } finally {
      encoded.fill(0);
      encodedBuf.fill(0);
    }
  }

  private assertEpochUnchanged(epoch: number): void {
    if (this.vaultEpoch !== epoch) throw new LockedError();
  }

  private resetAutoLock(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
    }
    this.autoLockTimer = setTimeout(() => {
      this.lock();
      try {
        void this.onAutoLock?.();
      } catch {
        // Locking must never be reversed because an observer failed.
      }
    }, this.autoLockMs);
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Returns `Uint8Array<ArrayBuffer>` (not `Uint8Array<ArrayBufferLike>`)
 * so that `crypto.subtle.encrypt/decrypt` accepts the result without
 * complaining about `SharedArrayBuffer` via the TS 5.7 `BufferSource`
 * type union. We construct explicitly over a fresh `ArrayBuffer` to
 * lock the generic parameter.
 */
function fromBase64(str: string): Uint8Array<ArrayBuffer> {
  const binary = atob(str);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
