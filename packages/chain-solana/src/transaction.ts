/**
 * Solana transaction serialization + signing.
 *
 * The wire format is the one documented at
 * https://solana.com/docs/rpc/http/sendtransaction and implemented by
 * `@solana/web3.js`. At a high level:
 *
 * 1. Collect every account referenced by the message and sort them by
 *    (isSigner DESC, isWritable DESC).
 * 2. Emit a header: `numRequiredSigs, numReadonlySigned, numReadonlyUnsigned`.
 * 3. Emit the account list (compact-u16 length + 32-byte keys).
 * 4. Emit the recent blockhash (32 bytes).
 * 5. Emit each instruction as `(programIdIndex, accounts[], data)`.
 * 6. For v0: emit `addressTableLookups` after the instructions.
 *
 * Signing is `ed25519.sign(rawMessage, secretKey)` — no extra hashing,
 * per the Solana signing model ("signature = Ed25519(rawMessage)").
 */

import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";

import { _addressInternals } from "./address";
import {
  SolanaTransactionError,
  type SolanaInstruction,
  type SolanaMessage,
  type SolanaTransaction,
} from "./types";

const { hexToBytes, bytesToHex0x } = _addressInternals;

/**
 * Minimal little-endian byte writer.
 *
 * Solana's compact-u16 "shortvec" encoding uses variable-length
 * continuation bytes; everything else is little-endian fixed-width.
 */
class ByteWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;

  writeBytes(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }

  writeUint8(n: number): void {
    this.writeBytes(new Uint8Array([n & 0xff]));
  }

  /**
   * Compact-u16 ("shortvec") encoding per
   * https://github.com/solana-labs/solana/blob/master/sdk/program/src/shortvec.rs
   */
  writeCompactU16(n: number): void {
    if (n < 0 || n > 0xffff) {
      throw new SolanaTransactionError(`compact-u16 value out of range: ${n}`);
    }
    let rem = n;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let elem = rem & 0x7f;
      rem >>= 7;
      if (rem === 0) {
        this.writeUint8(elem);
        return;
      }
      elem |= 0x80;
      this.writeUint8(elem);
    }
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

/**
 * Key-equality check against an existing account map. Using
 * `bytesToHex0x` as the canonical form keeps the map keys trivially
 * hashable — Maps don't compare Uint8Array by content.
 */
function pubKeyToString(key: `0x${string}`): string {
  return key.toLowerCase();
}

/**
 * Collect every account referenced by `message`, deduplicated and
 * sorted into the signer/writable sections demanded by the wire
 * format. Returns the sorted account list plus the header counters.
 *
 * Implementation note: Solana requires a very specific ordering
 * (writable signers, read-only signers, writable non-signers,
 * read-only non-signers). We materialise each bucket separately
 * before concatenating — simpler than a comparator that has to carry
 * four key classes.
 */
function collectAccounts(message: SolanaMessage): {
  accounts: Array<`0x${string}`>;
  header: { numRequiredSigs: number; numReadonlySigned: number; numReadonlyUnsigned: number };
} {
  type Entry = { pubKey: `0x${string}`; isSigner: boolean; isWritable: boolean };
  const map = new Map<string, Entry>();

  const merge = (entry: Entry) => {
    const key = pubKeyToString(entry.pubKey);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...entry });
      return;
    }
    existing.isSigner = existing.isSigner || entry.isSigner;
    existing.isWritable = existing.isWritable || entry.isWritable;
  };

  // Fee-payer is always the first writable signer.
  merge({ pubKey: message.feePayer, isSigner: true, isWritable: true });

  for (const ix of message.instructions) {
    merge({ pubKey: ix.programId, isSigner: false, isWritable: false });
    for (const acc of ix.accounts) {
      merge({ pubKey: acc.pubKey, isSigner: acc.isSigner, isWritable: acc.isWritable });
    }
  }

  const writableSigners: Entry[] = [];
  const readonlySigners: Entry[] = [];
  const writableNonSigners: Entry[] = [];
  const readonlyNonSigners: Entry[] = [];

  // Fee payer must occupy index 0. We extract it first then process
  // the remaining accounts in a stable order driven by first-occurrence
  // in the instruction stream — Solana's reference implementation does
  // the same.
  const feePayerKey = pubKeyToString(message.feePayer);
  const feePayerEntry = map.get(feePayerKey);
  if (!feePayerEntry) {
    throw new SolanaTransactionError("fee payer not found in account map");
  }
  writableSigners.push(feePayerEntry);
  map.delete(feePayerKey);

  for (const entry of map.values()) {
    if (entry.isSigner && entry.isWritable) writableSigners.push(entry);
    else if (entry.isSigner && !entry.isWritable) readonlySigners.push(entry);
    else if (!entry.isSigner && entry.isWritable) writableNonSigners.push(entry);
    else readonlyNonSigners.push(entry);
  }

  const accounts: Array<`0x${string}`> = [
    ...writableSigners.map((e) => e.pubKey),
    ...readonlySigners.map((e) => e.pubKey),
    ...writableNonSigners.map((e) => e.pubKey),
    ...readonlyNonSigners.map((e) => e.pubKey),
  ];

  return {
    accounts,
    header: {
      numRequiredSigs: writableSigners.length + readonlySigners.length,
      numReadonlySigned: readonlySigners.length,
      numReadonlyUnsigned: readonlyNonSigners.length,
    },
  };
}

/**
 * Serialize a compiled instruction: `programIdIndex, accounts[], data`.
 */
function serializeInstruction(
  ix: SolanaInstruction,
  keyToIndex: Map<string, number>,
  w: ByteWriter,
): void {
  const programIdIdx = keyToIndex.get(pubKeyToString(ix.programId));
  if (programIdIdx === undefined) {
    throw new SolanaTransactionError(`programId not indexed: ${ix.programId}`);
  }
  w.writeUint8(programIdIdx);
  w.writeCompactU16(ix.accounts.length);
  for (const acc of ix.accounts) {
    const idx = keyToIndex.get(pubKeyToString(acc.pubKey));
    if (idx === undefined) {
      throw new SolanaTransactionError(`account not indexed: ${acc.pubKey}`);
    }
    w.writeUint8(idx);
  }
  const data = hexToBytes(ix.data);
  w.writeCompactU16(data.length);
  w.writeBytes(data);
}

/**
 * Serialize a Solana message into the canonical byte layout used by
 * both signing and broadcast.
 *
 * This is the **signing preimage**: `ed25519.sign(serializeMessage(msg), sk)`
 * is the full signature pipeline. No additional hashing occurs, matching
 * the official RFC 8032 pure-Ed25519 construction Solana uses.
 *
 * @example
 * ```ts
 * const bytes = serializeMessage(msg);
 * const sig = ed25519.sign(bytes, privKey);
 * ```
 */
export function serializeMessage(msg: SolanaMessage): Uint8Array {
  const { accounts, header } = collectAccounts(msg);
  const keyToIndex = new Map<string, number>();
  accounts.forEach((key, idx) => keyToIndex.set(pubKeyToString(key), idx));

  const w = new ByteWriter();

  // Version byte for v0 (high bit set); legacy messages omit it.
  if (msg.version === 0) {
    w.writeUint8(0x80);
  }

  w.writeUint8(header.numRequiredSigs);
  w.writeUint8(header.numReadonlySigned);
  w.writeUint8(header.numReadonlyUnsigned);

  w.writeCompactU16(accounts.length);
  for (const key of accounts) {
    const bytes = hexToBytes(key);
    if (bytes.length !== 32) {
      throw new SolanaTransactionError(`account key must be 32 bytes: ${key}`);
    }
    w.writeBytes(bytes);
  }

  const blockhash = hexToBytes(msg.recentBlockhash);
  if (blockhash.length !== 32) {
    throw new SolanaTransactionError(`recentBlockhash must be 32 bytes; got ${blockhash.length}`);
  }
  w.writeBytes(blockhash);

  w.writeCompactU16(msg.instructions.length);
  for (const ix of msg.instructions) {
    serializeInstruction(ix, keyToIndex, w);
  }

  if (msg.version === 0) {
    const lookups = msg.addressTableLookups ?? [];
    w.writeCompactU16(lookups.length);
    for (const lookup of lookups) {
      const key = hexToBytes(lookup.accountKey);
      if (key.length !== 32) {
        throw new SolanaTransactionError(`address-table key must be 32 bytes`);
      }
      w.writeBytes(key);
      w.writeCompactU16(lookup.writableIndexes.length);
      for (const i of lookup.writableIndexes) {
        if (i < 0 || i > 0xff) throw new SolanaTransactionError(`writable index out of range: ${i}`);
        w.writeUint8(i);
      }
      w.writeCompactU16(lookup.readonlyIndexes.length);
      for (const i of lookup.readonlyIndexes) {
        if (i < 0 || i > 0xff) throw new SolanaTransactionError(`readonly index out of range: ${i}`);
        w.writeUint8(i);
      }
    }
  } else if (msg.addressTableLookups && msg.addressTableLookups.length > 0) {
    throw new SolanaTransactionError("address-table lookups are only valid on v0 messages");
  }

  return w.toBytes();
}

/**
 * Compute the byte sequence an Ed25519 signer must sign.
 *
 * Solana does **not** apply SHA-256 before signing (RFC 8032 Ed25519
 * hashes internally in EdDSA) — the serialized message IS the preimage.
 * This helper exists purely so test harnesses can request the bytes
 * without invoking the signer.
 *
 * @example
 * ```ts
 * const bytes = computeSigningPreimage(tx);
 * // bytes is what the HSM / hardware wallet will be asked to sign.
 * ```
 */
export function computeSigningPreimage(tx: SolanaTransaction): Uint8Array {
  return serializeMessage(tx.message);
}

/**
 * Sign a Solana transaction with a 32-byte Ed25519 private key.
 *
 * Returns a new transaction with the resulting signature appended to
 * the existing signature set — the input is not mutated. Duplicate
 * signer entries are collapsed: if the caller signs twice with the
 * same key, only the latest signature is retained.
 *
 * @example
 * ```ts
 * const signed = await signTransaction(tx, privateKeyHex);
 * broadcast(serializeSignedTransaction(signed));
 * ```
 */
export async function signTransaction(
  tx: SolanaTransaction,
  privateKeyHex: `0x${string}`,
): Promise<SolanaTransaction> {
  const priv = hexToBytes(privateKeyHex);
  if (priv.length !== 32) {
    throw new SolanaTransactionError(
      `Ed25519 private key must be 32 bytes; got ${priv.length}`,
    );
  }
  const pubKey = ed25519.getPublicKey(priv);
  const preimage = computeSigningPreimage(tx);
  const signature = ed25519.sign(preimage, priv);

  const signerHex = bytesToHex0x(pubKey);
  const filtered = tx.signatures.filter(
    (s) => pubKeyToString(s.signer) !== pubKeyToString(signerHex),
  );
  return {
    message: tx.message,
    signatures: [...filtered, { signer: signerHex, signature: bytesToHex0x(signature) }],
  };
}

/**
 * Serialize a signed transaction for broadcast.
 *
 * Output is base58-encoded per `sendTransaction`'s default encoding.
 * Signatures are placed in the correct slots (ordered by the
 * compiled-message signer layout); missing signatures are emitted as
 * 64 zero bytes so the wire format remains well-formed.
 *
 * @example
 * ```ts
 * const wire = serializeSignedTransaction(signedTx);
 * // Can be passed straight to the JSON-RPC `sendTransaction` method.
 * ```
 */
export function serializeSignedTransaction(tx: SolanaTransaction): string {
  const { accounts, header } = collectAccounts(tx.message);
  const sigCount = header.numRequiredSigs;
  const signerSlots = accounts.slice(0, sigCount).map((a) => pubKeyToString(a));
  const sigMap = new Map<string, Uint8Array>();
  for (const s of tx.signatures) {
    sigMap.set(pubKeyToString(s.signer), hexToBytes(s.signature));
  }

  const messageBytes = serializeMessage(tx.message);
  const w = new ByteWriter();
  w.writeCompactU16(sigCount);
  for (const slot of signerSlots) {
    const sig = sigMap.get(slot);
    if (sig && sig.length === 64) {
      w.writeBytes(sig);
    } else if (!sig) {
      w.writeBytes(new Uint8Array(64)); // placeholder for partial signing
    } else {
      throw new SolanaTransactionError(
        `signature for ${slot} must be 64 bytes, got ${sig.length}`,
      );
    }
  }
  w.writeBytes(messageBytes);
  return base58.encode(w.toBytes());
}
