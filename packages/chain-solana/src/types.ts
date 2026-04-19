/**
 * Solana chain package — public type surface.
 *
 * Every public symbol consumers rely on lives here so type-only changes
 * can be reviewed in isolation. Wire-format choices mirror the wallet's
 * existing EVM + BTC packages: hex-prefixed byte strings
 * (`0x${string}`) for binary blobs, `bigint` for anything larger than
 * `Number.MAX_SAFE_INTEGER`.
 *
 * The types follow the Solana web3.js layout where possible so the
 * wallet's future RPC layer can pass values through without
 * re-serialisation.
 */

/**
 * Solana networks the wallet currently targets.
 *
 * `mainnet-beta` is the production cluster. `devnet` and `testnet`
 * are the long-lived developer and release-candidate clusters per
 * https://docs.solana.com/clusters.
 */
export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet";

/**
 * One instruction inside a Solana message.
 *
 * Shape matches the on-wire layout for a compiled instruction (BIP-ish
 * `AccountsMap -> u8 -> length -> data`) except we keep account
 * references as raw 32-byte public keys instead of integer indexes —
 * the serializer assigns indexes at encode time.
 */
export interface SolanaInstruction {
  /** Raw 32-byte program id this instruction invokes. */
  readonly programId: `0x${string}`;
  /** Accounts passed to the instruction, in declaration order. */
  readonly accounts: ReadonlyArray<{
    readonly pubKey: `0x${string}`;
    readonly isSigner: boolean;
    readonly isWritable: boolean;
  }>;
  /** Program-specific payload. */
  readonly data: `0x${string}`;
}

/**
 * Compiled message ready for signing.
 *
 * Supports both legacy (`"legacy"`) and v0 (`0`) transaction formats.
 * `addressTableLookups` is only meaningful when `version === 0`.
 */
export interface SolanaMessage {
  /** Message version. `"legacy"` for pre-v0 transactions; `0` for post-1.10. */
  readonly version: 0 | "legacy";
  /** 32-byte recent blockhash pinned by the client. */
  readonly recentBlockhash: `0x${string}`;
  /** 32-byte fee-payer public key. */
  readonly feePayer: `0x${string}`;
  /** Instructions to execute. */
  readonly instructions: readonly SolanaInstruction[];
  /**
   * Address table lookup references (v0 only).
   *
   * Each entry references one on-chain address-lookup table and the
   * indexes within it that this transaction consumes. Only valid when
   * `version === 0`.
   */
  readonly addressTableLookups?: ReadonlyArray<{
    readonly accountKey: `0x${string}`;
    readonly writableIndexes: readonly number[];
    readonly readonlyIndexes: readonly number[];
  }>;
}

/**
 * A signed or partially-signed Solana transaction.
 *
 * `signatures` is indexed by signer in the same order the signers
 * appear in the compiled message header. Missing slots are allowed
 * during the partially-signed window and appear as 64-byte zero
 * signatures on the wire.
 */
export interface SolanaTransaction {
  /** Underlying message. */
  readonly message: SolanaMessage;
  /** Signatures collected so far. */
  readonly signatures: ReadonlyArray<{
    readonly signer: `0x${string}`;
    readonly signature: `0x${string}`;
  }>;
}

/**
 * Error raised by the Solana address encoder / decoder.
 */
export class SolanaAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaAddressError";
  }
}

/**
 * Error raised by the Solana transaction serializer / signer.
 */
export class SolanaTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolanaTransactionError";
  }
}
