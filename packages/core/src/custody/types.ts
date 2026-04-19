import type { KeySlot } from "../types";

export interface CustodyCapabilities {
  canGenerate: boolean;
  canImportSeed: boolean;
  canImportPrivateKey: boolean;
  canExportPublicKey: boolean;
  canSign: boolean;
}

/**
 * Type of signed transaction payload that a custody backend can produce.
 * - `eip1559` — EIP-2718 type-2 transaction (the default post-London)
 * - `legacy`  — Pre-EIP-1559 type-0 transaction with EIP-155 replay protection
 */
export type RawTxKind = "eip1559" | "legacy";

/**
 * Optional metadata that callers may supply when asking a custody backend
 * to sign a raw transaction. Hardware wallets (Ledger in particular) need
 * the chainId to produce an EIP-155 compliant `v` for legacy transactions
 * and to show the correct network on their display.
 */
export interface RawTxSignOptions {
  /** Kind of encoded payload. Defaults to "eip1559". */
  kind?: RawTxKind;
  /** EVM chain id. Required for legacy transactions; optional for EIP-1559. */
  chainId?: bigint;
}

export interface CustodyBackend {
  readonly name: string;
  readonly capabilities: CustodyCapabilities;
  generateKeySlot(label: string, hdPath?: string): Promise<KeySlot>;
  importFromSeed(mnemonic: string[], label: string, hdPath: string): Promise<KeySlot>;
  importFromPrivateKey(privateKey: Uint8Array, label: string): Promise<KeySlot>;
  sign(keySlotId: string, data: Uint8Array): Promise<Uint8Array>;
  getPublicKey(keySlotId: string): Promise<Uint8Array>;
  deleteKey(keySlotId: string): Promise<void>;

  /**
   * Sign a raw (unhashed) transaction payload. The backend is responsible
   * for whatever hashing / framing the underlying signer needs.
   *
   * Software wallets hash then delegate to `sign()`; hardware wallets
   * transmit the raw bytes so the device can decode and display the tx
   * to the user before signing. Hardware wallets CANNOT sign an arbitrary
   * pre-computed digest — they must see the serialized tx.
   *
   * Returns a 65-byte recoverable signature `r (32) | s (32) | v (1)`.
   * For EIP-1559 txs `v` is the y-parity (0 or 1); for legacy EIP-155 txs
   * `v` is `35 + 2 * chainId + recovery` (the caller may normalize it).
   *
   * Optional on the interface so existing backends that have not been
   * updated continue to type-check; `LocalCustodyBackend` provides a
   * default implementation.
   */
  signTransactionBytes?(
    keySlotId: string,
    rawTx: Uint8Array,
    options?: RawTxSignOptions,
  ): Promise<Uint8Array>;
}
