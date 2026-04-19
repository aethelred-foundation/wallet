import * as secp256k1 from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync as toSeed } from "@scure/bip39";
import { KeyNotFoundError } from "../errors";
import type { KeySlot } from "../types";
import type { EncryptedStorage } from "../secure-storage";
import type {
  CustodyBackend,
  CustodyCapabilities,
  RawTxSignOptions,
} from "./types";

const DEFAULT_HD_PATH = "m/44'/60'/0'/0/0";

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function publicKeyToEthAddress(publicKey: Uint8Array): string {
  const uncompressed =
    publicKey.length === 33 ? secp256k1.ProjectivePoint.fromHex(publicKey).toRawBytes(false) : publicKey;
  const hash = keccak_256(uncompressed.slice(1));
  const addressBytes = hash.slice(-20);
  const hex = Array.from(addressBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  // EIP-55 checksum
  const hashOfAddress = keccak_256(new TextEncoder().encode(hex));
  let checksummed = "0x";
  for (let i = 0; i < 40; i++) {
    const nibble = hashOfAddress[Math.floor(i / 2)];
    const value = i % 2 === 0 ? (nibble >> 4) : (nibble & 0x0f);
    checksummed += value >= 8 ? hex[i].toUpperCase() : hex[i];
  }
  return checksummed;
}

/**
 * LocalCustodyBackend generates and stores keys in encrypted local storage.
 * Private keys are encrypted at rest and only decrypted during signing.
 */
export class LocalCustodyBackend implements CustodyBackend {
  readonly name = "local";
  readonly capabilities: CustodyCapabilities = {
    canGenerate: true,
    canImportSeed: true,
    canImportPrivateKey: true,
    canExportPublicKey: true,
    canSign: true,
  };

  private readonly keyCache = new Map<string, Uint8Array>();

  constructor(private readonly encryptedStorage: EncryptedStorage) {}

  async generateKeySlot(label: string, hdPath = DEFAULT_HD_PATH): Promise<KeySlot> {
    const privateKey = secp256k1.utils.randomPrivateKey();
    const publicKey = secp256k1.getPublicKey(privateKey, true);
    const address = publicKeyToEthAddress(publicKey);
    const id = generateId();

    await this.encryptedStorage.set(`key-slot:${id}`, Array.from(privateKey));
    this.keyCache.set(id, privateKey);

    return {
      id,
      label,
      curve: "secp256k1",
      origin: "generated",
      publicKey,
      address,
      createdAt: Date.now(),
      hdPath,
    };
  }

  async importFromSeed(mnemonic: string[], label: string, hdPath = DEFAULT_HD_PATH): Promise<KeySlot> {
    const seed = toSeed(mnemonic.join(" "));
    const hdKey = HDKey.fromMasterSeed(seed);
    const derived = hdKey.derive(hdPath);

    if (!derived.privateKey) {
      throw new Error("Failed to derive private key from seed");
    }

    const privateKey = derived.privateKey;
    const publicKey = secp256k1.getPublicKey(privateKey, true);
    const address = publicKeyToEthAddress(publicKey);
    const id = generateId();

    await this.encryptedStorage.set(`key-slot:${id}`, Array.from(privateKey));
    this.keyCache.set(id, new Uint8Array(privateKey));

    return {
      id,
      label,
      curve: "secp256k1",
      origin: "derived",
      publicKey,
      address,
      createdAt: Date.now(),
      hdPath,
    };
  }

  async importFromPrivateKey(privateKey: Uint8Array, label: string): Promise<KeySlot> {
    const publicKey = secp256k1.getPublicKey(privateKey, true);
    const address = publicKeyToEthAddress(publicKey);
    const id = generateId();

    await this.encryptedStorage.set(`key-slot:${id}`, Array.from(privateKey));
    this.keyCache.set(id, privateKey);

    return {
      id,
      label,
      curve: "secp256k1",
      origin: "imported",
      publicKey,
      address,
      createdAt: Date.now(),
    };
  }

  /**
   * Signs a 32-byte digest.
   *
   * IMPORTANT: The caller MUST pass an already-hashed 32-byte digest.
   * For Ethereum operations this is keccak256 of the appropriate
   * message/transaction/typed-data payload. This function does NOT
   * re-hash — an earlier version did `sha256(data)` which produced
   * `secp256k1(sha256(keccak256(...)))` — signatures that `ecrecover`
   * could never validate against the wallet's own address.
   */
  async sign(keySlotId: string, digest: Uint8Array): Promise<Uint8Array> {
    if (digest.length !== 32) {
      throw new Error(
        `LocalCustodyBackend.sign expects a 32-byte digest, got ${digest.length}`,
      );
    }
    const privateKey = await this.loadPrivateKey(keySlotId);
    // lowS: true is mandatory for Ethereum — EIP-2 bans high-s signatures
    const sig = secp256k1.sign(digest, privateKey, { lowS: true });
    // Return 65-byte recoverable signature: r (32) + s (32) + v (1)
    const compact = sig.toCompactRawBytes();
    const result = new Uint8Array(65);
    result.set(compact);
    result[64] = sig.recovery ?? 0;
    return result;
  }

  /**
   * Sign a raw transaction payload. For software wallets this is simply
   * `sign(keccak256(rawTx))` — the hash preimage depends on the tx kind
   * but in both EIP-1559 and legacy cases the keccak256 digest is the
   * right thing to sign with secp256k1 once the caller has correctly
   * framed the bytes (EIP-2718 type byte + RLP for type 2, EIP-155
   * RLP for legacy).
   *
   * Hardware backends override this to send `rawTx` to the device.
   *
   * NOTE: `options` is accepted for signature compatibility with the
   * `CustodyBackend` interface but is intentionally unused here — a
   * software wallet does not need the chain id to hash.
   */
  async signTransactionBytes(
    keySlotId: string,
    rawTx: Uint8Array,
    _options?: RawTxSignOptions,
  ): Promise<Uint8Array> {
    if (!(rawTx instanceof Uint8Array) || rawTx.length === 0) {
      throw new Error(
        `LocalCustodyBackend.signTransactionBytes expects a non-empty Uint8Array, got ${rawTx?.length ?? "null"}`,
      );
    }
    const digest = keccak_256(rawTx);
    return this.sign(keySlotId, digest);
  }

  async getPublicKey(keySlotId: string): Promise<Uint8Array> {
    const privateKey = await this.loadPrivateKey(keySlotId);
    return secp256k1.getPublicKey(privateKey, true);
  }

  async deleteKey(keySlotId: string): Promise<void> {
    this.keyCache.delete(keySlotId);
    await this.encryptedStorage.delete(`key-slot:${keySlotId}`);
  }

  private async loadPrivateKey(keySlotId: string): Promise<Uint8Array> {
    const cached = this.keyCache.get(keySlotId);
    if (cached) return cached;

    const stored = await this.encryptedStorage.get<number[]>(`key-slot:${keySlotId}`);
    if (!stored) throw new KeyNotFoundError(keySlotId);

    const key = new Uint8Array(stored);
    this.keyCache.set(keySlotId, key);
    return key;
  }
}
