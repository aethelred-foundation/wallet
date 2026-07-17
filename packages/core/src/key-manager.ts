import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { KeyNotFoundError, MnemonicError } from "./errors";
import type { EncryptedStorage } from "./secure-storage";
import type { LocalCustodyBackend } from "./custody/local";
import type { KeySlot, AccountHandle } from "./types";

const DEFAULT_HD_PATH = "m/44'/60'/0'/0/0";

/**
 * KeyManager orchestrates key generation, import, and account management.
 * It delegates all cryptographic operations to the CustodyBackend.
 * Never exposes raw private key material.
 */
export class KeyManager {
  private keySlots: KeySlot[] = [];
  private accounts: AccountHandle[] = [];

  constructor(
    private readonly custody: LocalCustodyBackend,
    private readonly encryptedStorage: EncryptedStorage
  ) {}

  async initialize(): Promise<void> {
    const storedSlots = await this.encryptedStorage.get<KeySlot[]>("key-slots");
    if (storedSlots) {
      this.keySlots = storedSlots.map((slot) => ({
        ...slot,
        publicKey: new Uint8Array(Object.values(slot.publicKey)),
      }));
    }

    const storedAccounts = await this.encryptedStorage.get<AccountHandle[]>("account-handles");
    if (storedAccounts) {
      this.accounts = storedAccounts;
    }
  }

  async createWallet(label = "Primary account"): Promise<{
    mnemonic: string[];
    keySlot: KeySlot;
    account: AccountHandle;
  }> {
    const mnemonic = generateMnemonic(wordlist, 128).split(" "); // 12 words
    const keySlot = await this.custody.importFromSeed(mnemonic, label, DEFAULT_HD_PATH);

    this.keySlots.push(keySlot);

    const account: AccountHandle = {
      id: `acct-${keySlot.id.slice(0, 8)}`,
      label,
      keySlotId: keySlot.id,
      address: keySlot.address,
      namespace: "eip155",
      createdAt: Date.now(),
    };
    this.accounts.push(account);

    await this.persist();

    // Store encrypted mnemonic for recovery
    await this.encryptedStorage.set("mnemonic", mnemonic);

    return { mnemonic, keySlot, account };
  }

  async importFromMnemonic(
    mnemonic: string[],
    label = "Imported account"
  ): Promise<{ keySlot: KeySlot; account: AccountHandle }> {
    const normalized = mnemonic.map((word) => word.trim().toLowerCase());
    if (normalized.length !== 12 && normalized.length !== 24) {
      throw new MnemonicError("Mnemonic must be 12 or 24 words");
    }
    if (!validateMnemonic(normalized.join(" "), wordlist)) {
      throw new MnemonicError("Mnemonic contains an unknown word or invalid BIP-39 checksum");
    }

    const keySlot = await this.custody.importFromSeed(normalized, label, DEFAULT_HD_PATH);
    this.keySlots.push(keySlot);

    const account: AccountHandle = {
      id: `acct-${keySlot.id.slice(0, 8)}`,
      label,
      keySlotId: keySlot.id,
      address: keySlot.address,
      namespace: "eip155",
      createdAt: Date.now(),
    };
    this.accounts.push(account);

    await this.persist();
    await this.encryptedStorage.set("mnemonic", normalized);

    return { keySlot, account };
  }

  async importFromPrivateKey(
    privateKey: Uint8Array,
    label = "Imported key"
  ): Promise<{ keySlot: KeySlot; account: AccountHandle }> {
    const keySlot = await this.custody.importFromPrivateKey(privateKey, label);
    this.keySlots.push(keySlot);

    const account: AccountHandle = {
      id: `acct-${keySlot.id.slice(0, 8)}`,
      label,
      keySlotId: keySlot.id,
      address: keySlot.address,
      namespace: "eip155",
      createdAt: Date.now(),
    };
    this.accounts.push(account);

    await this.persist();
    return { keySlot, account };
  }

  getKeySlots(): KeySlot[] {
    return [...this.keySlots];
  }

  getKeySlot(id: string): KeySlot {
    const slot = this.keySlots.find((s) => s.id === id);
    if (!slot) throw new KeyNotFoundError(id);
    return slot;
  }

  getAccounts(): AccountHandle[] {
    return [...this.accounts];
  }

  getAccount(id: string): AccountHandle | undefined {
    return this.accounts.find((a) => a.id === id);
  }

  getAccountByAddress(address: string): AccountHandle | undefined {
    const lower = address.toLowerCase();
    return this.accounts.find((a) => a.address.toLowerCase() === lower);
  }

  /**
   * Derive the next account from the existing mnemonic.
   * Increments the address index: m/44'/60'/0'/0/{index}
   */
  async deriveNextAccount(label?: string): Promise<{ keySlot: KeySlot; account: AccountHandle }> {
    const mnemonic = await this.encryptedStorage.get<string[]>("mnemonic");
    if (!mnemonic) throw new MnemonicError("No mnemonic stored. Cannot derive additional accounts.");

    const existingPaths = this.keySlots
      .filter((s) => s.origin === "derived" && s.hdPath)
      .map((s) => s.hdPath!);

    // Find the next unused index
    let nextIndex = 0;
    for (const path of existingPaths) {
      const match = path.match(/\/(\d+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        if (idx >= nextIndex) nextIndex = idx + 1;
      }
    }

    const hdPath = `m/44'/60'/0'/0/${nextIndex}`;
    const accountLabel = label ?? `Account ${this.accounts.length + 1}`;
    const keySlot = await this.custody.importFromSeed(mnemonic, accountLabel, hdPath);
    this.keySlots.push(keySlot);

    const account: AccountHandle = {
      id: `acct-${keySlot.id.slice(0, 8)}`,
      label: accountLabel,
      keySlotId: keySlot.id,
      address: keySlot.address,
      namespace: "eip155",
      createdAt: Date.now(),
    };
    this.accounts.push(account);

    await this.persist();
    return { keySlot, account };
  }

  async renameAccount(id: string, newLabel: string): Promise<void> {
    const account = this.accounts.find((a) => a.id === id);
    if (account) {
      account.label = newLabel;
      await this.persist();
    }
  }

  getAccountCount(): number {
    return this.accounts.length;
  }

  async deleteAccount(id: string): Promise<void> {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) return;

    await this.custody.deleteKey(account.keySlotId);
    this.keySlots = this.keySlots.filter((s) => s.id !== account.keySlotId);
    this.accounts = this.accounts.filter((a) => a.id !== id);
    await this.persist();
  }

  async getRecoveryPhrase(): Promise<string[] | null> {
    return this.encryptedStorage.get<string[]>("mnemonic");
  }

  /** Remove partial data left by a failed first-run create/import flow. */
  async discardFailedInitialization(): Promise<void> {
    for (const slot of this.keySlots) {
      try {
        await this.custody.deleteKey(slot.id);
      } catch {
        // Continue clearing the remaining setup artefacts. The master key is
        // discarded immediately afterward, making any orphan ciphertext
        // cryptographically inaccessible.
      }
    }
    await Promise.allSettled([
      this.encryptedStorage.delete("key-slots"),
      this.encryptedStorage.delete("account-handles"),
      this.encryptedStorage.delete("mnemonic"),
    ]);
    this.keySlots = [];
    this.accounts = [];
  }

  private async persist(): Promise<void> {
    const serializableSlots = this.keySlots.map((slot) => ({
      ...slot,
      publicKey: Object.fromEntries(slot.publicKey.entries()),
    }));
    await this.encryptedStorage.set("key-slots", serializableSlots);
    await this.encryptedStorage.set("account-handles", this.accounts);
  }
}
