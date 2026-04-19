/**
 * Minimal RLP (Recursive Length Prefix) encoder for Ethereum transactions.
 * Used to serialize signed transactions for eth_sendRawTransaction.
 */

type RlpInput = Uint8Array | string | bigint | number | RlpInput[];

export function rlpEncode(input: RlpInput): Uint8Array {
  if (input instanceof Uint8Array) {
    return encodeBytes(input);
  }
  if (typeof input === "string") {
    if (input.startsWith("0x")) {
      return encodeBytes(hexToBytes(input));
    }
    return encodeBytes(new TextEncoder().encode(input));
  }
  if (typeof input === "number" || typeof input === "bigint") {
    const n = BigInt(input);
    if (n === BigInt(0)) return encodeBytes(new Uint8Array(0));
    return encodeBytes(bigintToBytes(n));
  }
  if (Array.isArray(input)) {
    const encoded = input.map(rlpEncode);
    const totalLength = encoded.reduce((sum, item) => sum + item.length, 0);
    const lengthPrefix = encodeLength(totalLength, 0xc0);
    const result = new Uint8Array(lengthPrefix.length + totalLength);
    result.set(lengthPrefix);
    let offset = lengthPrefix.length;
    for (const item of encoded) {
      result.set(item, offset);
      offset += item.length;
    }
    return result;
  }
  throw new Error("Invalid RLP input");
}

function encodeBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 1 && bytes[0] < 0x80) {
    return bytes;
  }
  const lengthPrefix = encodeLength(bytes.length, 0x80);
  const result = new Uint8Array(lengthPrefix.length + bytes.length);
  result.set(lengthPrefix);
  result.set(bytes, lengthPrefix.length);
  return result;
}

function encodeLength(length: number, offset: number): Uint8Array {
  if (length < 56) {
    return new Uint8Array([offset + length]);
  }
  const lengthBytes = bigintToBytes(BigInt(length));
  const result = new Uint8Array(1 + lengthBytes.length);
  result[0] = offset + 55 + lengthBytes.length;
  result.set(lengthBytes, 1);
  return result;
}

function bigintToBytes(n: bigint): Uint8Array {
  if (n === BigInt(0)) return new Uint8Array(0);
  let hex = n.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  return hexToBytes("0x" + hex);
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length === 0) return new Uint8Array(0);
  const padded = h.length % 2 !== 0 ? "0" + h : h;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encodes a signed EIP-1559 transaction for broadcast.
 */
export function encodeSignedTx(tx: {
  chainId: bigint;
  nonce: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  to: Uint8Array | null;
  value: bigint;
  data: Uint8Array;
  accessList: Array<[Uint8Array, Uint8Array[]]>;
  v: number;
  r: Uint8Array;
  s: Uint8Array;
}): Uint8Array {
  const fields: RlpInput[] = [
    tx.chainId,
    tx.nonce,
    tx.maxPriorityFeePerGas,
    tx.maxFeePerGas,
    tx.gasLimit,
    tx.to ?? new Uint8Array(0),
    tx.value,
    tx.data,
    tx.accessList.map(([addr, keys]) => [addr, keys]),
    tx.v,
    tx.r,
    tx.s,
  ];

  const rlp = rlpEncode(fields);
  // EIP-1559 transaction type prefix: 0x02
  const result = new Uint8Array(1 + rlp.length);
  result[0] = 0x02;
  result.set(rlp, 1);
  return result;
}

/**
 * Encodes a signed legacy transaction for broadcast.
 */
export function encodeLegacySignedTx(tx: {
  nonce: bigint;
  gasPrice: bigint;
  gasLimit: bigint;
  to: Uint8Array | null;
  value: bigint;
  data: Uint8Array;
  v: number;
  r: Uint8Array;
  s: Uint8Array;
}): Uint8Array {
  const fields: RlpInput[] = [
    tx.nonce,
    tx.gasPrice,
    tx.gasLimit,
    tx.to ?? new Uint8Array(0),
    tx.value,
    tx.data,
    tx.v,
    tx.r,
    tx.s,
  ];

  return rlpEncode(fields);
}
