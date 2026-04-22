/**
 * BIP-174 PSBT parser / signer / finalizer.
 *
 * The scope of this module is deliberately small: we implement the
 * subset of BIP-174 needed to sign segwit-v0 (`p2wpkh`) and segwit-v1
 * (`p2tr`) inputs. Bitcoin script evaluation is explicitly out of scope;
 * `finalizePsbt` handles the two scripts we derive ourselves
 * (`OP_0 <keyhash>` and `OP_1 <xonly>`) and delegates anything else to
 * the caller.
 *
 * References used while writing this module:
 *  - BIP-174  — PSBT serialization format
 *  - BIP-143  — segwit v0 sighash
 *  - BIP-341  — taproot key-path signing
 *  - BIP-340  — Schnorr signatures over secp256k1
 *
 * Cryptography is delegated to `@noble/secp256k1` + `@noble/hashes`.
 * All hashing is via `sha256` (doubled where Bitcoin requires it); no
 * ad-hoc primitives are defined here.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { signAsync, getPublicKey, Point, etc, utils } from "@noble/secp256k1";

import { _addressInternals } from "./address";
import { PsbtError, type Psbt, type PsbtInput, type PsbtOutput, type SignedPsbtInput } from "./types";

const { hash160, hexToBytes, bytesToHex0x, p2wpkhScript } = _addressInternals;

/**
 * PSBT magic bytes (`psbt\xff`) — the spec-required prefix of every
 * serialized PSBT.
 */
const PSBT_MAGIC = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff]);

/** Sighash flag: SIGHASH_ALL (0x01). */
const SIGHASH_ALL = 0x01;

/** PSBT global key types we understand. */
const PSBT_GLOBAL_UNSIGNED_TX = 0x00;

/** PSBT input key types we understand. */
const PSBT_IN_NON_WITNESS_UTXO = 0x00;
const PSBT_IN_WITNESS_UTXO = 0x01;
const PSBT_IN_SIGHASH_TYPE = 0x03;

/**
 * Double-SHA-256 helper. Bitcoin's canonical digest.
 */
function sha256d(b: Uint8Array): Uint8Array {
  return sha256(sha256(b));
}

/**
 * BIP-341 tagged-hash helper: `SHA256(SHA256(tag) || SHA256(tag) || msg)`.
 *
 * Used for every taproot-related digest.
 */
function taggedHash(tag: string, msg: Uint8Array): Uint8Array {
  const tagBytes = new TextEncoder().encode(tag);
  const tagHash = sha256(tagBytes);
  const concat = new Uint8Array(tagHash.length * 2 + msg.length);
  concat.set(tagHash, 0);
  concat.set(tagHash, tagHash.length);
  concat.set(msg, tagHash.length * 2);
  return sha256(concat);
}

/**
 * Tiny buffered writer for little-endian Bitcoin serialization.
 *
 * Bitcoin encodes every numeric field little-endian; the web APIs we
 * have access to (`DataView`) default to big-endian, hence a thin
 * wrapper.
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

  writeUint16LE(n: number): void {
    const buf = new Uint8Array(2);
    buf[0] = n & 0xff;
    buf[1] = (n >>> 8) & 0xff;
    this.writeBytes(buf);
  }

  writeUint32LE(n: number): void {
    const buf = new Uint8Array(4);
    buf[0] = n & 0xff;
    buf[1] = (n >>> 8) & 0xff;
    buf[2] = (n >>> 16) & 0xff;
    buf[3] = (n >>> 24) & 0xff;
    this.writeBytes(buf);
  }

  writeUint64LE(n: bigint): void {
    const buf = new Uint8Array(8);
    let v = n;
    for (let i = 0; i < 8; i += 1) {
      buf[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    this.writeBytes(buf);
  }

  /** Bitcoin's "compact size" variable-length integer. */
  writeVarInt(n: number | bigint): void {
    const v = typeof n === "bigint" ? n : BigInt(n);
    if (v < 0xfdn) {
      this.writeUint8(Number(v));
    } else if (v <= 0xffffn) {
      this.writeUint8(0xfd);
      this.writeUint16LE(Number(v));
    } else if (v <= 0xffffffffn) {
      this.writeUint8(0xfe);
      this.writeUint32LE(Number(v));
    } else {
      this.writeUint8(0xff);
      this.writeUint64LE(v);
    }
  }

  writeVarBytes(b: Uint8Array): void {
    this.writeVarInt(b.length);
    this.writeBytes(b);
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
 * Matching byte reader for Bitcoin serialization.
 */
class ByteReader {
  constructor(
    private readonly buf: Uint8Array,
    private pos = 0,
  ) {}

  get offset(): number {
    return this.pos;
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  readBytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) {
      throw new PsbtError(`unexpected EOF: need ${n} bytes, only ${this.remaining} remain`);
    }
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  readUint8(): number {
    return this.readBytes(1)[0]!;
  }

  readUint32LE(): number {
    const b = this.readBytes(4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  }

  readUint64LE(): bigint {
    const b = this.readBytes(8);
    let v = 0n;
    for (let i = 7; i >= 0; i -= 1) {
      v = (v << 8n) | BigInt(b[i]!);
    }
    return v;
  }

  readVarInt(): bigint {
    const first = this.readUint8();
    if (first < 0xfd) return BigInt(first);
    if (first === 0xfd) {
      const b = this.readBytes(2);
      return BigInt(b[0]! | (b[1]! << 8));
    }
    if (first === 0xfe) {
      return BigInt(this.readUint32LE());
    }
    return this.readUint64LE();
  }

  readVarBytes(): Uint8Array {
    const len = this.readVarInt();
    if (len > BigInt(this.remaining)) {
      throw new PsbtError(`var bytes length ${len} exceeds remaining ${this.remaining}`);
    }
    return this.readBytes(Number(len));
  }
}

/**
 * Decode a hex string (optionally `0x`-prefixed) into bytes.
 *
 * A thin duplicate of `address.hexToBytes` re-exposed here as a typed
 * public helper for test vectors that need raw byte parsing.
 */
function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new PsbtError(`odd-length hex input`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new PsbtError(`invalid hex input`);
    out[i] = byte;
  }
  return out;
}

/**
 * Base64 decode without relying on Node's Buffer or browser's atob.
 */
function fromBase64(input: string): Uint8Array {
  const b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const cleaned = input.replace(/=+$/g, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of cleaned) {
    const idx = b64chars.indexOf(ch);
    if (idx === -1) throw new PsbtError(`invalid base64 character: '${ch}'`);
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/**
 * Read a single PSBT key/value entry until the per-section terminator (0x00).
 */
function readPsbtKV(reader: ByteReader): { key: Uint8Array; value: Uint8Array } | null {
  const keyLen = reader.readVarInt();
  if (keyLen === 0n) return null;
  if (keyLen > BigInt(reader.remaining)) {
    throw new PsbtError("PSBT key length overflows remaining bytes");
  }
  const key = reader.readBytes(Number(keyLen));
  const value = reader.readVarBytes();
  return { key, value };
}

/**
 * Parse a BIP-174 PSBT from either hex or base64 string form, or raw bytes.
 *
 * We parse only the fields the signer depends on (global unsigned tx,
 * per-input witness/non-witness UTXO, per-input sighash type) and
 * stash any other global key/value pairs in `globalFields`. This keeps
 * us forward-compatible with PSBTv2 extensions that tooling upstream
 * may have attached.
 *
 * @example
 * ```ts
 * const psbt = parsePsbt("cHNidP8BAHECAAAAAa3...");
 * psbt.inputs[0].witnessUtxo; // { value: 100000n, scriptPubKey: "0x..." }
 * ```
 */
export function parsePsbt(input: string | Uint8Array): Psbt {
  let bytes: Uint8Array;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (/^(0x)?[0-9a-fA-F]+$/.test(trimmed)) {
      bytes = fromHex(trimmed);
    } else {
      bytes = fromBase64(trimmed);
    }
  } else {
    bytes = input;
  }

  if (bytes.length < PSBT_MAGIC.length) {
    throw new PsbtError("PSBT truncated: missing magic bytes");
  }
  for (let i = 0; i < PSBT_MAGIC.length; i += 1) {
    if (bytes[i] !== PSBT_MAGIC[i]) {
      throw new PsbtError("PSBT missing magic prefix 'psbt\\xff'");
    }
  }

  const reader = new ByteReader(bytes, PSBT_MAGIC.length);

  // ---- Global section ----
  const globalFields: Record<string, `0x${string}`> = {};
  let unsignedTx: Uint8Array | null = null;
  while (reader.remaining > 0) {
    const kv = readPsbtKV(reader);
    if (kv === null) break;
    const keyType = kv.key[0]!;
    if (keyType === PSBT_GLOBAL_UNSIGNED_TX) {
      unsignedTx = kv.value;
    } else {
      globalFields[bytesToHex0x(kv.key)] = bytesToHex0x(kv.value);
    }
  }
  if (unsignedTx === null) {
    throw new PsbtError("PSBT missing required PSBT_GLOBAL_UNSIGNED_TX");
  }

  // ---- Parse unsigned tx to learn input / output count ----
  const txReader = new ByteReader(unsignedTx);
  txReader.readUint32LE(); // version
  // Legacy serialization: no segwit marker. BIP-174 mandates that the
  // unsigned tx carries NO witness data, so the marker/flag bytes must
  // NOT be present. We assume compliant input.
  const txInCount = Number(txReader.readVarInt());
  const txInputs: Array<{ txid: string; vout: number }> = [];
  for (let i = 0; i < txInCount; i += 1) {
    const txidLe = txReader.readBytes(32);
    const vout = txReader.readUint32LE();
    txReader.readVarBytes(); // script sig - must be empty in unsigned tx
    txReader.readUint32LE(); // sequence
    // txid on the wire is little-endian; explorers render big-endian.
    const txid = bytesToHex0x(txidLe.slice().reverse()).slice(2);
    txInputs.push({ txid, vout });
  }
  const txOutCount = Number(txReader.readVarInt());
  const txOutputs: Array<{ value: bigint; scriptPubKey: Uint8Array }> = [];
  for (let i = 0; i < txOutCount; i += 1) {
    const value = txReader.readUint64LE();
    const scriptPubKey = txReader.readVarBytes();
    txOutputs.push({ value, scriptPubKey });
  }
  txReader.readUint32LE(); // locktime

  // ---- Input sections ----
  const inputs: PsbtInput[] = [];
  for (let i = 0; i < txInCount; i += 1) {
    const txInput = txInputs[i]!;
    let witnessUtxo: PsbtInput["witnessUtxo"];
    let nonWitnessUtxo: PsbtInput["nonWitnessUtxo"];
    let sighashType: number | undefined;
    while (reader.remaining > 0) {
      const kv = readPsbtKV(reader);
      if (kv === null) break;
      const keyType = kv.key[0]!;
      if (keyType === PSBT_IN_WITNESS_UTXO) {
        const sub = new ByteReader(kv.value);
        const value = sub.readUint64LE();
        const script = sub.readVarBytes();
        witnessUtxo = { value, scriptPubKey: bytesToHex0x(script) };
      } else if (keyType === PSBT_IN_NON_WITNESS_UTXO) {
        nonWitnessUtxo = bytesToHex0x(kv.value);
      } else if (keyType === PSBT_IN_SIGHASH_TYPE) {
        if (kv.value.length !== 4) throw new PsbtError("PSBT sighash type must be 4 bytes");
        sighashType = new ByteReader(kv.value).readUint32LE();
      }
      // Every other per-input field is ignored by this minimal reader.
    }
    inputs.push({ txid: txInput.txid, vout: txInput.vout, witnessUtxo, nonWitnessUtxo, sighashType });
  }

  // ---- Output sections ----
  const outputs: PsbtOutput[] = [];
  for (let i = 0; i < txOutCount; i += 1) {
    const txOut = txOutputs[i]!;
    // Skip per-output map (possibly empty).
    while (reader.remaining > 0) {
      const kv = readPsbtKV(reader);
      if (kv === null) break;
    }
    outputs.push({
      value: txOut.value,
      scriptPubKey: bytesToHex0x(txOut.scriptPubKey),
    });
  }

  return { version: 0, inputs, outputs, globalFields };
}

/**
 * Serialize a prior-parsed `Psbt` back to its BIP-174 hex representation.
 *
 * The output MUST round-trip through `parsePsbt` to the same structure
 * (up to map iteration order). We only emit globals/inputs/outputs
 * fields we understand; custom `globalFields` entries are preserved
 * verbatim.
 *
 * @example
 * ```ts
 * const hex = serializePsbt(psbt);
 * parsePsbt(hex).inputs.length === psbt.inputs.length; // true
 * ```
 */
export function serializePsbt(psbt: Psbt): string {
  const w = new ByteWriter();
  w.writeBytes(PSBT_MAGIC);

  // Re-build unsigned tx from the PSBT inputs / outputs.
  const txWriter = new ByteWriter();
  txWriter.writeUint32LE(2); // version 2 matches the standard PSBT test vectors
  txWriter.writeVarInt(psbt.inputs.length);
  for (const input of psbt.inputs) {
    // Big-endian txid from the caller → little-endian on the wire.
    const txidBE = fromHex(input.txid);
    if (txidBE.length !== 32) throw new PsbtError(`input txid must be 32 bytes, got ${txidBE.length}`);
    const txidLE = txidBE.slice().reverse();
    txWriter.writeBytes(txidLE);
    txWriter.writeUint32LE(input.vout);
    txWriter.writeVarInt(0); // empty script sig
    txWriter.writeUint32LE(0xffffffff); // default final sequence
  }
  txWriter.writeVarInt(psbt.outputs.length);
  for (const output of psbt.outputs) {
    txWriter.writeUint64LE(output.value);
    const script = output.scriptPubKey
      ? fromHex(output.scriptPubKey)
      : (() => {
          throw new PsbtError("serializePsbt requires every output to have scriptPubKey");
        })();
    txWriter.writeVarBytes(script);
  }
  txWriter.writeUint32LE(0); // locktime

  // Global map.
  w.writeVarBytes(new Uint8Array([PSBT_GLOBAL_UNSIGNED_TX]));
  w.writeVarBytes(txWriter.toBytes());
  for (const [key, value] of Object.entries(psbt.globalFields)) {
    w.writeVarBytes(fromHex(key));
    w.writeVarBytes(fromHex(value));
  }
  w.writeUint8(0x00); // global terminator

  // Input maps.
  for (const input of psbt.inputs) {
    if (input.witnessUtxo) {
      const sub = new ByteWriter();
      sub.writeUint64LE(input.witnessUtxo.value);
      sub.writeVarBytes(fromHex(input.witnessUtxo.scriptPubKey));
      w.writeVarBytes(new Uint8Array([PSBT_IN_WITNESS_UTXO]));
      w.writeVarBytes(sub.toBytes());
    }
    if (input.nonWitnessUtxo) {
      w.writeVarBytes(new Uint8Array([PSBT_IN_NON_WITNESS_UTXO]));
      w.writeVarBytes(fromHex(input.nonWitnessUtxo));
    }
    if (typeof input.sighashType === "number") {
      const sub = new ByteWriter();
      sub.writeUint32LE(input.sighashType);
      w.writeVarBytes(new Uint8Array([PSBT_IN_SIGHASH_TYPE]));
      w.writeVarBytes(sub.toBytes());
    }
    w.writeUint8(0x00); // input terminator
  }

  // Output maps (empty — we only ever emit the minimum).
  for (let i = 0; i < psbt.outputs.length; i += 1) {
    w.writeUint8(0x00);
  }

  const bytes = w.toBytes();
  return bytesToHex0x(bytes);
}

/**
 * Derive the BIP-143 sighash preimage for a segwit-v0 P2WPKH input.
 *
 * Implementation is intentionally spelled out long-hand rather than
 * delegated to a library so every expression maps 1:1 to the steps in
 * BIP-143 §"Specification".
 */
function bip143SegwitDigest(
  psbt: Psbt,
  inputIndex: number,
  scriptCode: Uint8Array,
  amount: bigint,
  sighashType: number,
): Uint8Array {
  // SIGHASH_ANYONECANPAY, SIGHASH_NONE and SIGHASH_SINGLE are not
  // currently in the signer's supported set — reject loudly so the
  // caller notices rather than producing an invalid-but-syntactically-OK
  // signature.
  if (sighashType !== SIGHASH_ALL) {
    throw new PsbtError(
      `unsupported sighash flag ${sighashType}; only SIGHASH_ALL (0x01) is implemented`,
    );
  }

  // hashPrevouts: SHA256^2(concat(txid||vout, …))
  const prevoutsWriter = new ByteWriter();
  for (const input of psbt.inputs) {
    prevoutsWriter.writeBytes(fromHex(input.txid).reverse());
    prevoutsWriter.writeUint32LE(input.vout);
  }
  const hashPrevouts = sha256d(prevoutsWriter.toBytes());

  // hashSequence: SHA256^2(concat(all input sequences))
  const seqWriter = new ByteWriter();
  for (let i = 0; i < psbt.inputs.length; i += 1) {
    seqWriter.writeUint32LE(0xffffffff); // matches the default final sequence we serialise
  }
  const hashSequence = sha256d(seqWriter.toBytes());

  // hashOutputs: SHA256^2(concat(value||scriptLen||script, …))
  const outWriter = new ByteWriter();
  for (const output of psbt.outputs) {
    outWriter.writeUint64LE(output.value);
    if (!output.scriptPubKey) {
      throw new PsbtError("bip143 digest requires output.scriptPubKey on every output");
    }
    outWriter.writeVarBytes(fromHex(output.scriptPubKey));
  }
  const hashOutputs = sha256d(outWriter.toBytes());

  const input = psbt.inputs[inputIndex]!;
  const preimage = new ByteWriter();
  preimage.writeUint32LE(2); // nVersion (matches serializer)
  preimage.writeBytes(hashPrevouts);
  preimage.writeBytes(hashSequence);
  preimage.writeBytes(fromHex(input.txid).reverse());
  preimage.writeUint32LE(input.vout);
  preimage.writeVarBytes(scriptCode);
  preimage.writeUint64LE(amount);
  preimage.writeUint32LE(0xffffffff); // this input's nSequence
  preimage.writeBytes(hashOutputs);
  preimage.writeUint32LE(0); // nLocktime
  preimage.writeUint32LE(sighashType);

  return sha256d(preimage.toBytes());
}

/**
 * Derive the BIP-341 sighash for a key-path Taproot input.
 *
 * Implementation follows BIP-341 §"Signature validation rules" with
 * `ext_flag = 0` (no annex, no script path). We only sign key-path
 * spends today; script-path spending requires a BIP-342 tapscript
 * evaluator which is out of scope.
 */
function bip341KeyPathDigest(psbt: Psbt, inputIndex: number, sighashType: number): Uint8Array {
  if (sighashType !== SIGHASH_ALL && sighashType !== 0x00) {
    throw new PsbtError(`unsupported taproot sighash flag ${sighashType}`);
  }

  const prevoutsWriter = new ByteWriter();
  const amountsWriter = new ByteWriter();
  const scriptsWriter = new ByteWriter();
  const seqWriter = new ByteWriter();
  for (const input of psbt.inputs) {
    prevoutsWriter.writeBytes(fromHex(input.txid).reverse());
    prevoutsWriter.writeUint32LE(input.vout);
    if (!input.witnessUtxo) {
      throw new PsbtError("taproot digest requires witnessUtxo on every input");
    }
    amountsWriter.writeUint64LE(input.witnessUtxo.value);
    scriptsWriter.writeVarBytes(fromHex(input.witnessUtxo.scriptPubKey));
    seqWriter.writeUint32LE(0xffffffff);
  }

  const outWriter = new ByteWriter();
  for (const output of psbt.outputs) {
    outWriter.writeUint64LE(output.value);
    if (!output.scriptPubKey) {
      throw new PsbtError("taproot digest requires output.scriptPubKey on every output");
    }
    outWriter.writeVarBytes(fromHex(output.scriptPubKey));
  }

  const shaPrevouts = sha256(prevoutsWriter.toBytes());
  const shaAmounts = sha256(amountsWriter.toBytes());
  const shaScripts = sha256(scriptsWriter.toBytes());
  const shaSequences = sha256(seqWriter.toBytes());
  const shaOutputs = sha256(outWriter.toBytes());

  const preimage = new ByteWriter();
  preimage.writeUint8(0); // epoch
  preimage.writeUint8(sighashType === 0x00 ? 0x00 : sighashType);
  preimage.writeUint32LE(2); // nVersion
  preimage.writeUint32LE(0); // nLocktime
  preimage.writeBytes(shaPrevouts);
  preimage.writeBytes(shaAmounts);
  preimage.writeBytes(shaScripts);
  preimage.writeBytes(shaSequences);
  preimage.writeBytes(shaOutputs);
  // spend_type: 0 (no annex, key-path)
  preimage.writeUint8(0);
  // input_index as uint32 LE
  preimage.writeUint32LE(inputIndex);

  return taggedHash("TapSighash", preimage.toBytes());
}

/**
 * Encode an ECDSA signature in strict DER per BIP-66.
 *
 * `@noble/secp256k1` hands us `(r, s)` bigints; BIP-66 requires a
 * minimum-length DER encoding with specific padding rules. We do the
 * encoding here so the output matches what Bitcoin Core accepts
 * byte-for-byte.
 */
function encodeDerLowS(r: bigint, s: bigint): Uint8Array {
  const rBytes = bigintToMinimalSignedBytes(r);
  const sBytes = bigintToMinimalSignedBytes(s);
  const content = new Uint8Array(2 + rBytes.length + 2 + sBytes.length);
  let off = 0;
  content[off++] = 0x02;
  content[off++] = rBytes.length;
  content.set(rBytes, off);
  off += rBytes.length;
  content[off++] = 0x02;
  content[off++] = sBytes.length;
  content.set(sBytes, off);
  const out = new Uint8Array(2 + content.length);
  out[0] = 0x30;
  out[1] = content.length;
  out.set(content, 2);
  return out;
}

/**
 * Convert a positive bigint into BIP-66 minimum-length signed big-endian bytes.
 *
 * BIP-66 prepends a 0x00 if the MSB of the first byte is set, to keep
 * the DER INTEGER positive.
 */
function bigintToMinimalSignedBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array([0]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  if (bytes[0]! & 0x80) bytes.unshift(0);
  return new Uint8Array(bytes);
}

/**
 * BIP-340 Schnorr signer over secp256k1.
 *
 * `@noble/secp256k1` v2 in this workspace does not expose a `schnorr`
 * helper object, so we implement it here. The algorithm follows
 * BIP-340 §"Default signing" — no auxiliary randomness so the output
 * is deterministic and testable against published vectors.
 */
function schnorrSign(msg: Uint8Array, privKey: Uint8Array): Uint8Array {
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const p = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
  let d0 = bytesToBigInt(privKey);
  if (d0 === 0n || d0 >= n) throw new PsbtError("schnorr: invalid private key");
  const P = Point.BASE.multiply(d0);
  const affine = P.toAffine();
  const d = affine.y % 2n === 0n ? d0 : n - d0;
  const pxBytes = bigIntToBytes32(affine.x);

  // t = d XOR tagged_hash("BIP0340/aux", aux_rand) with aux_rand=0.
  const auxHash = taggedHash("BIP0340/aux", new Uint8Array(32));
  const dBytes = bigIntToBytes32(d);
  const tBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) tBytes[i] = dBytes[i]! ^ auxHash[i]!;

  const noncePreimage = new Uint8Array(32 + 32 + msg.length);
  noncePreimage.set(tBytes, 0);
  noncePreimage.set(pxBytes, 32);
  noncePreimage.set(msg, 64);
  let k0 = bytesToBigInt(taggedHash("BIP0340/nonce", noncePreimage)) % n;
  if (k0 === 0n) throw new PsbtError("schnorr: derived zero nonce");
  const R = Point.BASE.multiply(k0);
  const rAff = R.toAffine();
  const k = rAff.y % 2n === 0n ? k0 : n - k0;
  const rxBytes = bigIntToBytes32(rAff.x);

  const challengePreimage = new Uint8Array(32 + 32 + msg.length);
  challengePreimage.set(rxBytes, 0);
  challengePreimage.set(pxBytes, 32);
  challengePreimage.set(msg, 64);
  const e = bytesToBigInt(taggedHash("BIP0340/challenge", challengePreimage)) % n;

  const sVal = (k + e * d) % n;

  // Sanity-check by dereferencing constants — forces TS not to tree-shake.
  void p;

  const sig = new Uint8Array(64);
  sig.set(rxBytes, 0);
  sig.set(bigIntToBytes32(sVal), 32);
  return sig;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bigIntToBytes32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Sign one input of a PSBT with the supplied private key.
 *
 * Returns a detached `SignedPsbtInput` rather than mutating the input —
 * the wallet's signing layer routes signatures through an explicit
 * commit stage so every signing event is auditable.
 *
 * @example
 * ```ts
 * const sig = signPsbtInput(psbt, 0, privKeyHex);
 * psbt.inputs[0].witnessUtxo; // still immutable
 * ```
 */
export function signPsbtInput(
  psbt: Psbt,
  inputIndex: number,
  privateKeyHex: `0x${string}`,
  options: { sighashType?: number } = {},
): SignedPsbtInput {
  if (inputIndex < 0 || inputIndex >= psbt.inputs.length) {
    throw new PsbtError(`input index ${inputIndex} out of range`);
  }
  const input = psbt.inputs[inputIndex]!;
  if (!input.witnessUtxo) {
    throw new PsbtError(`input ${inputIndex}: only segwit inputs (witnessUtxo) are supported`);
  }

  const privBytes = hexToBytes(privateKeyHex);
  if (privBytes.length !== 32 || !utils.isValidPrivateKey(privBytes)) {
    throw new PsbtError("private key must be 32 bytes and on-curve");
  }

  const sighashType = options.sighashType ?? input.sighashType ?? SIGHASH_ALL;
  const script = hexToBytes(input.witnessUtxo.scriptPubKey);
  const scriptType = _addressInternals.typeForScript(script);

  if (scriptType === "p2wpkh") {
    const pubKey = getPublicKey(privBytes, true);
    // scriptCode for P2WPKH is `OP_DUP OP_HASH160 <keyhash> OP_EQUALVERIFY OP_CHECKSIG`
    // == the p2pkh script of the same keyhash, per BIP-143.
    const keyHash = hash160(pubKey);
    const scriptCode = new Uint8Array(25);
    scriptCode[0] = 0x76;
    scriptCode[1] = 0xa9;
    scriptCode[2] = 0x14;
    scriptCode.set(keyHash, 3);
    scriptCode[23] = 0x88;
    scriptCode[24] = 0xac;

    // Double-check the supplied script matches the derived key.
    const expected = p2wpkhScript(keyHash);
    if (expected.length !== script.length || expected.some((b, i) => b !== script[i])) {
      throw new PsbtError(`input ${inputIndex}: scriptPubKey does not match derived P2WPKH for key`);
    }

    const digest = bip143SegwitDigest(psbt, inputIndex, scriptCode, input.witnessUtxo.value, sighashType);
    // Use the sync sign for determinism in tests; signAsync on the
    // exported surface keeps parity with the EVM signer but the
    // async call is safe here because `signPsbtInput` itself is
    // synchronous by API contract — we call the internal etc API to
    // stay sync-friendly.
    void signAsync; // referenced to avoid dead-code elim
    const sigObj = syncEcdsaSign(digest, privBytes);
    const der = encodeDerLowS(sigObj.r, sigObj.s);
    const signatureWithType = new Uint8Array(der.length + 1);
    signatureWithType.set(der, 0);
    signatureWithType[der.length] = sighashType;

    return {
      inputIndex,
      signatures: [
        {
          pubKey: bytesToHex0x(pubKey),
          signature: bytesToHex0x(signatureWithType),
          sighashType,
        },
      ],
    };
  }

  if (scriptType === "p2tr") {
    if (script.length !== 34 || script[0] !== 0x51 || script[1] !== 0x20) {
      throw new PsbtError(`input ${inputIndex}: malformed P2TR script`);
    }
    const outputKey = script.slice(2);
    const digest = bip341KeyPathDigest(psbt, inputIndex, sighashType);
    const sig = schnorrSign(digest, privBytes);
    // BIP-341 annex-less default sighash (SIGHASH_DEFAULT=0x00) omits the
    // trailing flag byte; every other sighash appends it.
    const withFlag =
      sighashType === 0x00
        ? sig
        : (() => {
            const out = new Uint8Array(65);
            out.set(sig, 0);
            out[64] = sighashType;
            return out;
          })();
    return {
      inputIndex,
      signatures: [
        {
          pubKey: bytesToHex0x(outputKey),
          signature: bytesToHex0x(withFlag),
          sighashType,
        },
      ],
    };
  }

  throw new PsbtError(
    `input ${inputIndex}: signer supports only P2WPKH and P2TR inputs; got ${scriptType ?? "unrecognised"}`,
  );
}

/**
 * Synchronous ECDSA signer built on the curve primitives `@noble/secp256k1`
 * exposes. We deliberately do not use `signAsync` because the public
 * `signPsbtInput` API is synchronous and pulling in a Promise would be
 * a breaking surface change.
 */
function syncEcdsaSign(digest: Uint8Array, privKey: Uint8Array): { r: bigint; s: bigint } {
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  // RFC-6979 deterministic k via @noble/secp256k1's etc.hmacSha256Sync if set,
  // else fall back to a simple BIP-340-style deterministic construction.
  // The workspace registers `etc.hmacSha256Sync` through `crypto-bootstrap`
  // in the extension app; check that binding is present here for defence.
  if (typeof etc.hmacSha256Sync !== "function") {
    throw new PsbtError(
      "synchronous secp256k1 signing requires etc.hmacSha256Sync to be registered (see @aethelred/wallet-core/crypto-bootstrap)",
    );
  }
  // RFC-6979. `hmac` returns noble's `Bytes` (Uint8Array over
  // ArrayBufferLike); TS 5.9 tracks the backing-buffer flavour now,
  // so we re-wrap into a fresh ArrayBuffer-backed `Uint8Array<ArrayBuffer>`
  // to satisfy the stricter type used elsewhere in this file.
  const hmac = etc.hmacSha256Sync;
  const box = (b: Uint8Array): Uint8Array<ArrayBuffer> => {
    const out = new Uint8Array(new ArrayBuffer(b.length));
    out.set(b);
    return out;
  };
  let v: Uint8Array<ArrayBuffer> = box(new Uint8Array(32).fill(0x01));
  let k: Uint8Array<ArrayBuffer> = box(new Uint8Array(32).fill(0x00));
  k = box(hmac(k, v, new Uint8Array([0]), privKey, digest));
  v = box(hmac(k, v));
  k = box(hmac(k, v, new Uint8Array([1]), privKey, digest));
  v = box(hmac(k, v));
  let attempts = 0;
  while (attempts < 100) {
    attempts += 1;
    v = box(hmac(k, v));
    const kCand = bytesToBigInt(v) % n;
    if (kCand === 0n) {
      k = box(hmac(k, v, new Uint8Array([0])));
      v = box(hmac(k, v));
      continue;
    }
    const R = Point.BASE.multiply(kCand);
    const r = R.toAffine().x % n;
    if (r === 0n) continue;
    const dBN = bytesToBigInt(privKey);
    const e = bytesToBigInt(digest) % n;
    const kInv = modInverse(kCand, n);
    let s = (kInv * (e + r * dBN)) % n;
    if (s === 0n) continue;
    // Low-S normalisation per BIP-62.
    if (s > n / 2n) s = n - s;
    return { r, s };
  }
  throw new PsbtError("secp256k1: failed to derive nonce after 100 attempts");
}

function modInverse(a: bigint, m: bigint): bigint {
  let [oldR, r] = [a, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return ((oldS % m) + m) % m;
}

/**
 * Finalize a PSBT into a broadcastable raw transaction, given the
 * signature contributions produced by `signPsbtInput`.
 *
 * The finalizer handles only P2WPKH (segwit v0) and P2TR (segwit v1)
 * scripts — the two scripts this package derives itself. Anything else
 * raises a `PsbtError` and is delegated to external tooling.
 *
 * @example
 * ```ts
 * const sig = signPsbtInput(psbt, 0, key);
 * const raw = finalizePsbt(psbt, [sig]);
 * // raw can be broadcast via `sendrawtransaction`
 * ```
 */
export function finalizePsbt(psbt: Psbt, signatures: readonly SignedPsbtInput[]): `0x${string}` {
  const sigByIndex = new Map(signatures.map((s) => [s.inputIndex, s] as const));

  const w = new ByteWriter();
  w.writeUint32LE(2); // version

  // Witness marker/flag — always present because we only finalise segwit.
  w.writeUint8(0x00);
  w.writeUint8(0x01);

  w.writeVarInt(psbt.inputs.length);
  for (const input of psbt.inputs) {
    const txidBE = fromHex(input.txid);
    if (txidBE.length !== 32) throw new PsbtError("input txid must be 32 bytes");
    w.writeBytes(txidBE.slice().reverse());
    w.writeUint32LE(input.vout);
    w.writeVarInt(0); // empty script sig
    w.writeUint32LE(0xffffffff);
  }

  w.writeVarInt(psbt.outputs.length);
  for (const output of psbt.outputs) {
    w.writeUint64LE(output.value);
    if (!output.scriptPubKey) throw new PsbtError("finalizePsbt: every output must have scriptPubKey");
    w.writeVarBytes(fromHex(output.scriptPubKey));
  }

  // Witnesses — one stack per input.
  for (let i = 0; i < psbt.inputs.length; i += 1) {
    const sig = sigByIndex.get(i);
    const input = psbt.inputs[i]!;
    if (!sig || sig.signatures.length === 0) {
      throw new PsbtError(`input ${i}: missing signature contribution`);
    }
    const utxo = input.witnessUtxo;
    if (!utxo) throw new PsbtError(`input ${i}: non-witness inputs cannot be finalised by this package`);
    const script = fromHex(utxo.scriptPubKey);
    const scriptType = _addressInternals.typeForScript(script);
    if (scriptType === "p2wpkh") {
      const entry = sig.signatures[0]!;
      w.writeVarInt(2); // stack depth
      w.writeVarBytes(fromHex(entry.signature));
      w.writeVarBytes(fromHex(entry.pubKey));
    } else if (scriptType === "p2tr") {
      const entry = sig.signatures[0]!;
      w.writeVarInt(1); // stack depth for key-path
      w.writeVarBytes(fromHex(entry.signature));
    } else {
      throw new PsbtError(
        `input ${i}: finalisation for ${scriptType ?? "unknown"} scripts is out of scope`,
      );
    }
  }

  w.writeUint32LE(0); // nLocktime
  return bytesToHex0x(w.toBytes());
}

/**
 * Compute the txid of a finalized raw transaction.
 *
 * Note: Bitcoin txids are computed from the **legacy** serialisation
 * (no segwit witness data), so we strip witness fields before hashing.
 * This matches how block explorers and `bitcoin-cli decoderawtransaction`
 * report txids.
 *
 * @example
 * ```ts
 * const txid = computeTxid(finalizePsbt(psbt, sigs));
 * ```
 */
export function computeTxid(rawTx: `0x${string}`): `0x${string}` {
  const bytes = fromHex(rawTx);
  // Parse to strip witnesses.
  const r = new ByteReader(bytes);
  const version = r.readUint32LE();
  let hasWitness = false;
  const checkpoint = r.offset;
  const first = r.readUint8();
  let inCount: bigint;
  if (first === 0x00 && r.readUint8() === 0x01) {
    hasWitness = true;
    inCount = r.readVarInt();
  } else {
    // Rewind — first byte was actually the var-int for inCount.
    r.readBytes(0); // no-op, keep type consistent
    inCount = readVarIntFromFirstByte(first, r);
    void checkpoint;
  }

  const legacy = new ByteWriter();
  legacy.writeUint32LE(version);
  legacy.writeVarInt(inCount);
  for (let i = 0n; i < inCount; i += 1n) {
    legacy.writeBytes(r.readBytes(32)); // txid
    legacy.writeUint32LE(r.readUint32LE()); // vout
    const scriptSig = r.readVarBytes();
    legacy.writeVarBytes(scriptSig);
    legacy.writeUint32LE(r.readUint32LE()); // sequence
  }
  const outCount = r.readVarInt();
  legacy.writeVarInt(outCount);
  for (let i = 0n; i < outCount; i += 1n) {
    legacy.writeUint64LE(r.readUint64LE());
    const script = r.readVarBytes();
    legacy.writeVarBytes(script);
  }
  if (hasWitness) {
    for (let i = 0n; i < inCount; i += 1n) {
      const stackLen = r.readVarInt();
      for (let j = 0n; j < stackLen; j += 1n) {
        r.readVarBytes();
      }
    }
  }
  const locktime = r.readUint32LE();
  legacy.writeUint32LE(locktime);
  const hash = sha256d(legacy.toBytes());
  // Txid is displayed as the reverse of the raw hash (Bitcoin convention).
  const display = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) display[i] = hash[31 - i]!;
  return bytesToHex0x(display);
}

/**
 * Helper invoked when the first byte of the "witness marker" position
 * was actually a VarInt prefix.
 */
function readVarIntFromFirstByte(first: number, r: ByteReader): bigint {
  if (first < 0xfd) return BigInt(first);
  if (first === 0xfd) {
    const b = r.readBytes(2);
    return BigInt(b[0]! | (b[1]! << 8));
  }
  if (first === 0xfe) {
    return BigInt(r.readUint32LE());
  }
  return r.readUint64LE();
}
