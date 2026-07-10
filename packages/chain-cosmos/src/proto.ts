/**
 * Minimal protobuf (proto3) wire-format writer.
 *
 * The native Cosmos transaction path needs to *emit* a handful of well-known
 * message types (`TxBody`, `AuthInfo`, `SignDoc`, `TxRaw`, `MsgSend`, …) with
 * byte-exact, canonical encoding — it never needs a general-purpose protobuf
 * runtime, descriptor reflection, or decoding. Following the wallet's
 * trust-kernel idiom (own RLP encoder in `@aethelred/wallet-core`, own PSBT
 * writer in `chain-btc`), the encoder is written from scratch so the trust
 * path stays free of a heavyweight third-party protobuf dependency.
 *
 * Wire rules implemented (all this module needs):
 *   - wire type 0 (varint)            — uint64 / enums
 *   - wire type 2 (length-delimited)  — string / bytes / embedded messages
 *
 * Canonicalization matches gogoproto's deterministic marshaling as used by
 * the Cosmos SDK:
 *   - scalar fields are OMITTED when they hold the proto3 default value
 *     (0 / "" / empty bytes) — see {@link ProtoWriter.uint64} etc.;
 *   - embedded messages are emitted whenever semantically present (gogo
 *     emits any non-nil pointer, even if its contents are all defaults) —
 *     see {@link ProtoWriter.embedded};
 *   - fields are written in ascending field-number order by construction
 *     (callers write them in declaration order).
 *
 * The chain-side proof that this canonicalization is byte-compatible with
 * the real Aethelred node lives in the aethelred repo (a Go test decodes a
 * TxRaw produced here with the app's own codec and verifies the signature).
 */

/** Protobuf wire types used by this writer. */
const WIRE_VARINT = 0;
const WIRE_LEN = 2;

/** Maximum value representable in an unsigned 64-bit protobuf varint. */
const U64_MAX = (1n << 64n) - 1n;

/** Error thrown when a caller provides an unencodable value. */
export class ProtoEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtoEncodeError";
  }
}

/** Encode `value` as a base-128 varint into `out`. */
function writeVarint(out: number[], value: bigint): void {
  if (value < 0n || value > U64_MAX) {
    throw new ProtoEncodeError(`varint out of uint64 range: ${value}`);
  }
  let v = value;
  while (v >= 0x80n) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
}

/** Field tag: `(fieldNumber << 3) | wireType`, itself varint-encoded. */
function writeTag(out: number[], fieldNumber: number, wireType: number): void {
  if (!Number.isInteger(fieldNumber) || fieldNumber < 1) {
    throw new ProtoEncodeError(`invalid field number: ${fieldNumber}`);
  }
  writeVarint(out, BigInt((fieldNumber << 3) | wireType));
}

/**
 * Accumulating writer for a single protobuf message.
 *
 * Usage: construct, write fields in ascending field-number order, `finish()`.
 * Each writer instance is single-use.
 */
export class ProtoWriter {
  private readonly out: number[] = [];

  /**
   * Write a `uint64` (or enum) field. Omitted when zero — the proto3
   * default — matching gogoproto's deterministic marshaling.
   */
  uint64(fieldNumber: number, value: bigint | number): this {
    const v = typeof value === "number" ? BigInt(value) : value;
    if (v !== 0n) {
      writeTag(this.out, fieldNumber, WIRE_VARINT);
      writeVarint(this.out, v);
    }
    return this;
  }

  /** Write a `string` field. Omitted when empty (proto3 default). */
  string(fieldNumber: number, value: string): this {
    if (value.length > 0) {
      this.lengthDelimited(fieldNumber, new TextEncoder().encode(value));
    }
    return this;
  }

  /** Write a `bytes` field. Omitted when empty (proto3 default). */
  bytes(fieldNumber: number, value: Uint8Array): this {
    if (value.length > 0) {
      this.lengthDelimited(fieldNumber, value);
    }
    return this;
  }

  /**
   * Write an embedded message field. ALWAYS emitted, even when the encoded
   * body is empty — an embedded message models a non-nil pointer in
   * gogoproto, whose presence is semantic (e.g. an `AuthInfo.fee` with all
   * default fields still marshals as `tag, len=0`).
   */
  embedded(fieldNumber: number, encoded: Uint8Array): this {
    this.lengthDelimited(fieldNumber, encoded);
    return this;
  }

  private lengthDelimited(fieldNumber: number, payload: Uint8Array): void {
    writeTag(this.out, fieldNumber, WIRE_LEN);
    writeVarint(this.out, BigInt(payload.length));
    for (const b of payload) this.out.push(b);
  }

  /** Return the encoded message bytes. */
  finish(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}
