/**
 * Transaction assembly for EIP-1559 (and legacy) transactions.
 *
 * This is the missing link between `Signer` and `TxManager.broadcast`:
 * the wallet has an RLP encoder (`rlp.ts`) and a raw-tx broadcaster,
 * but until now nothing built a real signed transaction — `background.ts`
 * was signing `JSON.stringify(tx)` bytes and returning a random 32-byte
 * hash without ever calling `eth_sendRawTransaction`.
 *
 * This module exports:
 *   - `buildUnsignedEip1559Tx` — produces the keccak256 digest that the
 *     custody backend signs.
 *   - `assembleSignedEip1559Tx` — given the unsigned fields + the
 *     65-byte (r|s|v) signature, produces the hex `0x02...` payload
 *     that `eth_sendRawTransaction` accepts.
 *   - `buildAndSignEip1559Tx` — convenience wrapper that takes a
 *     `Signer`, a key-slot id, and a policy token and returns the
 *     ready-to-broadcast hex string.
 *   - `computeTxHash` — keccak256 of the encoded signed tx, matching
 *     the hash the JSON-RPC node will return from broadcast.
 *
 * Scope: EIP-1559 type-2 transactions (the default on mainnet post-London).
 * A thin legacy type-0 path is provided for chains that still require it.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import * as secp256k1 from "@noble/secp256k1";
import { rlpEncode, encodeSignedTx, encodeLegacySignedTx, bytesToHex } from "./rlp";
import type { Signer } from "./signer";
import type { PolicyDecisionToken } from "./signer";

export interface UnsignedEip1559Tx {
  chainId: bigint;
  nonce: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  /** Recipient (null for contract deployment) */
  to: Uint8Array | null;
  value: bigint;
  data: Uint8Array;
  /** EIP-2930 access list — usually empty */
  accessList?: Array<[Uint8Array, Uint8Array[]]>;
}

export interface UnsignedLegacyTx {
  chainId: bigint;
  nonce: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  to: Uint8Array | null;
  value: bigint;
  data: Uint8Array;
}

export interface SignedTxOutput {
  /** `0x`-prefixed payload for `eth_sendRawTransaction` */
  rawTx: string;
  /** 32-byte keccak256 of rawTx (excluding `0x`) — the tx hash */
  hash: string;
}

/* ─── Helpers ─────────────────────────────────────────────────── */

/** Parse a `0x`-prefixed hex string to a bigint. Empty/missing → 0n. */
export function hexToBigInt(v: string | undefined | null): bigint {
  if (v == null || v === "" || v === "0x") return 0n;
  return BigInt(v.startsWith("0x") ? v : `0x${v}`);
}

/** Parse a `0x`-prefixed hex string to raw bytes. */
export function hexToBytes(v: string | undefined | null): Uint8Array {
  if (v == null || v === "" || v === "0x") return new Uint8Array(0);
  const hex = v.startsWith("0x") ? v.slice(2) : v;
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Parse a 20-byte Ethereum address from its hex form. Returns `null` on nullish input. */
export function addressToBytes(addr: string | null | undefined): Uint8Array | null {
  if (!addr) return null;
  const hex = addr.startsWith("0x") ? addr.slice(2) : addr;
  if (hex.length !== 40) throw new Error(`Invalid address length: ${addr}`);
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/* ─── Unsigned tx hashing (the thing the signer actually signs) ─── */

/**
 * Produces the wire-format unsigned-tx bytes for an EIP-1559 transaction —
 * the `0x02` EIP-2718 type byte followed by the RLP-encoded body. This is
 * the preimage of the signing digest (hardware wallets need THESE bytes,
 * not the hash, so they can decode + display the tx to the user).
 *
 * RLP body (per EIP-1559):
 *   [chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit,
 *    to, value, data, accessList]
 */
export function buildUnsignedEip1559TxBytes(tx: UnsignedEip1559Tx): Uint8Array {
  const accessList = tx.accessList ?? [];
  const fields = [
    tx.chainId,
    tx.nonce,
    tx.maxPriorityFeePerGas,
    tx.maxFeePerGas,
    tx.gasLimit,
    tx.to ?? new Uint8Array(0),
    tx.value,
    tx.data,
    accessList,
  ];
  const rlp = rlpEncode(fields);
  const prefixed = new Uint8Array(1 + rlp.length);
  prefixed[0] = 0x02;
  prefixed.set(rlp, 1);
  return prefixed;
}

/**
 * Produces the keccak256 digest that the signer must sign for an
 * EIP-1559 transaction. This is `keccak256(buildUnsignedEip1559TxBytes(tx))`.
 * Kept as a separate function so callers that want the digest (software
 * wallets) and callers that want the bytes (hardware wallets) can pick.
 */
export function buildUnsignedEip1559Tx(tx: UnsignedEip1559Tx): Uint8Array {
  return keccak_256(buildUnsignedEip1559TxBytes(tx));
}

/**
 * Produces the wire-format unsigned-tx bytes for a legacy (type 0)
 * transaction using EIP-155 chain-id replay protection:
 *   RLP([nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0])
 */
export function buildUnsignedLegacyTxBytes(tx: UnsignedLegacyTx): Uint8Array {
  const fields = [
    tx.nonce,
    tx.gasPrice,
    tx.gasLimit,
    tx.to ?? new Uint8Array(0),
    tx.value,
    tx.data,
    tx.chainId,
    0n,
    0n,
  ];
  return rlpEncode(fields);
}

/**
 * Produces the keccak256 digest for a legacy (type 0) transaction
 * using EIP-155 chain-id replay protection.
 */
export function buildUnsignedLegacyTx(tx: UnsignedLegacyTx): Uint8Array {
  return keccak_256(buildUnsignedLegacyTxBytes(tx));
}

/* ─── Signature splitting ───────────────────────────────────── */

/**
 * Split a 65-byte recoverable signature (r||s||v) into its r/s/v parts.
 * For EIP-1559 type-2 transactions the `y_parity` is just the recovery
 * bit (0 or 1); legacy txs use `v = 27+recovery` or `v = 35 + 2*chainId + recovery`.
 */
export function splitSignature(sig65: Uint8Array): {
  r: Uint8Array;
  s: Uint8Array;
  recovery: number;
} {
  if (sig65.length !== 65) {
    throw new Error(`Expected 65-byte signature, got ${sig65.length}`);
  }
  return {
    r: sig65.slice(0, 32),
    s: sig65.slice(32, 64),
    recovery: sig65[64] & 0x01,
  };
}

/* ─── Signed tx assembly ───────────────────────────────────── */

/**
 * Given the unsigned tx fields + the 65-byte signature produced by
 * the custody backend, build the broadcast payload for
 * `eth_sendRawTransaction` plus the expected tx hash.
 */
export function assembleSignedEip1559Tx(
  tx: UnsignedEip1559Tx,
  sig65: Uint8Array,
): SignedTxOutput {
  const { r, s, recovery } = splitSignature(sig65);
  const encoded = encodeSignedTx({
    chainId: tx.chainId,
    nonce: tx.nonce,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    maxFeePerGas: tx.maxFeePerGas,
    gasLimit: tx.gasLimit,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    accessList: tx.accessList ?? [],
    v: recovery,
    r,
    s,
  });
  const hash = keccak_256(encoded);
  return {
    rawTx: bytesToHex(encoded),
    hash: bytesToHex(hash),
  };
}

/**
 * Legacy (type 0) signed-tx assembly. v is computed per EIP-155:
 *   v = 35 + 2*chainId + recovery
 */
export function assembleSignedLegacyTx(
  tx: UnsignedLegacyTx,
  sig65: Uint8Array,
): SignedTxOutput {
  const { r, s, recovery } = splitSignature(sig65);
  const v = 35 + 2 * Number(tx.chainId) + recovery;
  const encoded = encodeLegacySignedTx({
    nonce: tx.nonce,
    gasPrice: tx.gasPrice,
    gasLimit: tx.gasLimit,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    v,
    r,
    s,
  });
  const hash = keccak_256(encoded);
  return {
    rawTx: bytesToHex(encoded),
    hash: bytesToHex(hash),
  };
}

/* ─── End-to-end: build + sign + assemble ───────────────────── */

/**
 * Convenience wrapper that ties the pieces together:
 *   1. Build the wire-format unsigned-tx bytes.
 *   2. Ask the signer to sign them.
 *      - If the underlying custody backend supports raw-tx signing
 *        (hardware wallets, plus `LocalCustodyBackend` now), the bytes
 *        go straight to `signTransactionRaw` so a Ledger can decode and
 *        display the tx on-device.
 *      - Otherwise we hash first and go through `signTransaction` — the
 *        original software-wallet path.
 *   3. Assemble the signed RLP payload + hash.
 *
 * The returned `rawTx` is ready to hand to `TxManager.broadcast()`.
 * The returned `hash` matches what the JSON-RPC node will return after
 * broadcast — we pre-compute it so the caller can optimistically track
 * the transaction.
 */
export async function buildAndSignEip1559Tx(
  tx: UnsignedEip1559Tx,
  signer: Signer,
  keySlotId: string,
  policyToken: PolicyDecisionToken,
): Promise<SignedTxOutput> {
  let signature: Uint8Array;
  if (signer.supportsRawTransactionSigning()) {
    const rawBytes = buildUnsignedEip1559TxBytes(tx);
    const sigResult = await signer.signTransactionRaw(
      { keySlotId, data: rawBytes, type: "transaction" },
      policyToken,
      { kind: "eip1559", chainId: tx.chainId },
    );
    signature = sigResult.signature;
  } else {
    const digest = buildUnsignedEip1559Tx(tx);
    const sigResult = await signer.signTransaction(
      { keySlotId, data: digest, type: "transaction" },
      policyToken,
    );
    signature = sigResult.signature;
  }
  return assembleSignedEip1559Tx(tx, signature);
}

/** Same as buildAndSignEip1559Tx but for legacy type-0 transactions. */
export async function buildAndSignLegacyTx(
  tx: UnsignedLegacyTx,
  signer: Signer,
  keySlotId: string,
  policyToken: PolicyDecisionToken,
): Promise<SignedTxOutput> {
  let signature: Uint8Array;
  if (signer.supportsRawTransactionSigning()) {
    const rawBytes = buildUnsignedLegacyTxBytes(tx);
    const sigResult = await signer.signTransactionRaw(
      { keySlotId, data: rawBytes, type: "transaction" },
      policyToken,
      { kind: "legacy", chainId: tx.chainId },
    );
    signature = sigResult.signature;
  } else {
    const digest = buildUnsignedLegacyTx(tx);
    const sigResult = await signer.signTransaction(
      { keySlotId, data: digest, type: "transaction" },
      policyToken,
    );
    signature = sigResult.signature;
  }
  return assembleSignedLegacyTx(tx, signature);
}

/* ─── Recovery helper ───────────────────────────────────────── */

/**
 * Recover the signer address from a 65-byte signature and the digest
 * that was signed. Useful for post-flight verification (the wallet can
 * confirm the signature it just produced actually recovers to the
 * expected address).
 */
export function recoverSignerAddress(digest: Uint8Array, sig65: Uint8Array): string {
  const { r, s, recovery } = splitSignature(sig65);
  const compact = new Uint8Array(64);
  compact.set(r, 0);
  compact.set(s, 32);
  const sig = secp256k1.Signature.fromCompact(compact).addRecoveryBit(recovery);
  const pubKey = sig.recoverPublicKey(digest).toRawBytes(false);
  const hash = keccak_256(pubKey.slice(1));
  const addressBytes = hash.slice(-20);
  const hex = Array.from(addressBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex}`;
}
