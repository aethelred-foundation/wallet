/**
 * Trust Kernel type definitions.
 * These types are internal to the kernel - the signing boundary.
 * No private key material is ever exposed through these types.
 */

export type KeyCurve = "secp256k1";

export type KeyOrigin = "generated" | "imported" | "derived";

export interface KeySlot {
  id: string;
  label: string;
  curve: KeyCurve;
  origin: KeyOrigin;
  publicKey: Uint8Array;
  address: string;
  createdAt: number;
  hdPath?: string;
}

export interface AccountHandle {
  id: string;
  label: string;
  keySlotId: string;
  address: string;
  namespace: "eip155" | "aethelred";
  createdAt: number;
}

export interface SigningRequest {
  keySlotId: string;
  data: Uint8Array;
  type: "message" | "transaction" | "typed-data";
}

export interface SigningResult {
  signature: Uint8Array;
  recoverableSignature?: {
    r: Uint8Array;
    s: Uint8Array;
    recovery: number;
  };
}

export interface EncryptedBlob {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
}

export type StorageKey =
  | "master-key-check"
  | "key-slots"
  | "account-handles"
  | "mnemonic"
  | `key-slot:${string}`;

export interface MasterKeyState {
  locked: boolean;
  lastActivity: number;
}

export interface WalletInitResult {
  mnemonic: string[];
  address: string;
  accountId: string;
}

export interface ImportResult {
  address: string;
  accountId: string;
}

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
