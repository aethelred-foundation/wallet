import { InvalidPasswordError, LockedError, StorageError } from "./errors";
import type { StorageAdapter } from "./types";

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 32;
const IV_LENGTH = 12;
const CHECK_VALUE = "aethelred-wallet-v1";
const AUTO_LOCK_MS = 5 * 60 * 1000; // 5 minutes

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

  constructor(
    private readonly storage: StorageAdapter,
    autoLockMs = AUTO_LOCK_MS
  ) {
    this.autoLockMs = autoLockMs;
  }

  isLocked(): boolean {
    return this.derivedKey === null;
  }

  /**
   * Unix ms of the last `touchActivity` call, or `0` if the wallet has
   * never been unlocked in this session. Used by the UI to drive the
   * "idle for Xm" status row and to power auto-lock diagnostics.
   */
  getLastActivity(): number {
    return this.lastActivity;
  }

  touchActivity(): void {
    this.lastActivity = Date.now();
    this.resetAutoLock();
  }

  async initialize(password: string): Promise<void> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const key = await this.deriveKey(password, salt);

    const encrypted = await this.encryptValue(key, CHECK_VALUE);
    const payload = JSON.stringify({
      salt: toBase64(salt),
      iv: toBase64(encrypted.iv),
      ciphertext: toBase64(encrypted.ciphertext),
    });

    try {
      await this.storage.set("master-key-check", payload);
    } catch (cause) {
      throw new StorageError("initialize master key", cause);
    }

    this.derivedKey = key;
    this.touchActivity();
  }

  async unlock(password: string): Promise<void> {
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

    this.derivedKey = key;
    this.touchActivity();
  }

  lock(): void {
    this.derivedKey = null;
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

  async encrypt(plaintext: string): Promise<string> {
    if (!this.derivedKey) throw new LockedError();
    this.touchActivity();

    const encrypted = await this.encryptValue(this.derivedKey, plaintext);
    return JSON.stringify({
      iv: toBase64(encrypted.iv),
      ciphertext: toBase64(encrypted.ciphertext),
    });
  }

  async decrypt(payload: string): Promise<string> {
    if (!this.derivedKey) throw new LockedError();
    this.touchActivity();

    const { iv, ciphertext } = JSON.parse(payload) as {
      iv: string;
      ciphertext: string;
    };

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(iv) },
        this.derivedKey,
        fromBase64(ciphertext)
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      throw new InvalidPasswordError();
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

    const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encodedBuf);
    const ciphertext = new Uint8Array(cipherBuf);
    return { iv, ciphertext };
  }

  private resetAutoLock(): void {
    if (this.autoLockTimer) {
      clearTimeout(this.autoLockTimer);
    }
    this.autoLockTimer = setTimeout(() => {
      this.lock();
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
