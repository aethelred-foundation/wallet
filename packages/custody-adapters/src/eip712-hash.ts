/**
 * EIP-712 typed-data hash computation.
 *
 * Every adapter needs to reduce a `TypedDataRequest` to the single
 * 32-byte digest that secp256k1 actually signs. We do the hashing
 * in a shared pure function so each adapter (local, Nitro, Ledger)
 * sees exactly the same bytes — impossible to drift between
 * them and produce signatures that recover to different addresses
 * per adapter.
 *
 * The algorithm (EIP-712 v4):
 *
 *     digest = keccak256(
 *       0x1901
 *       || domainSeparator
 *       || hashStruct(primaryType, message)
 *     )
 *
 * where:
 *
 *     domainSeparator = keccak256(
 *       keccak256(encodeType("EIP712Domain", domainType))
 *       || abi.encode(...domain values)
 *     )
 *
 *     hashStruct(type, value) = keccak256(
 *       keccak256(encodeType(type, allReferencedTypes))
 *       || abi.encode(...value fields)
 *     )
 *
 * This implementation supports the subset of EIP-712 needed for
 * USDC / stablecoin / ERC-20 typed-data signing:
 *
 *   - Primitive types: address, bool, bytesN (1..32), bytes,
 *     string, uint/int (any width).
 *   - Struct references (nested types).
 *   - NO dynamic arrays (arr[] / T[]). EIP-3009 doesn't need them;
 *     if a future flow does, extend this module explicitly — silent
 *     "works-for-me" extensions are how cryptographic bugs land.
 *
 * Guarded: any unsupported type is a thrown `CustodyError` with
 * code `signing-failed` and a precise message naming the type.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";

import type { TypedDataDomain, TypedDataField, TypedDataRequest } from "./types";
import { CustodyError } from "./errors";

/**
 * Compute the 32-byte EIP-712 digest. This is what a secp256k1
 * signer signs.
 */
export function computeTypedDataDigest(req: TypedDataRequest): Uint8Array {
  const domainType: ReadonlyArray<TypedDataField> = [
    // Only include fields that are actually set on domain — EIP-712
    // v4 says: "Protocol designers only need to include the fields
    // that make sense for their signing domain."
    ...(req.domain.name !== undefined ? [{ name: "name", type: "string" }] : []),
    ...(req.domain.version !== undefined ? [{ name: "version", type: "string" }] : []),
    ...(req.domain.chainId !== undefined ? [{ name: "chainId", type: "uint256" }] : []),
    ...(req.domain.verifyingContract !== undefined ? [{ name: "verifyingContract", type: "address" }] : []),
    ...(req.domain.salt !== undefined ? [{ name: "salt", type: "bytes32" }] : []),
  ];

  // domainSeparator = hashStruct("EIP712Domain", domain)
  const allTypes: Record<string, ReadonlyArray<TypedDataField>> = {
    ...req.types,
    EIP712Domain: domainType,
  };
  const domainValues: Record<string, unknown> = {};
  if (req.domain.name !== undefined) domainValues.name = req.domain.name;
  if (req.domain.version !== undefined) domainValues.version = req.domain.version;
  if (req.domain.chainId !== undefined) domainValues.chainId = req.domain.chainId;
  if (req.domain.verifyingContract !== undefined) domainValues.verifyingContract = req.domain.verifyingContract;
  if (req.domain.salt !== undefined) domainValues.salt = req.domain.salt;

  const domainSeparator = hashStruct("EIP712Domain", domainValues, allTypes);
  const messageHash = hashStruct(req.primaryType, req.message, allTypes);

  const preimage = new Uint8Array(2 + 32 + 32);
  preimage[0] = 0x19;
  preimage[1] = 0x01;
  preimage.set(domainSeparator, 2);
  preimage.set(messageHash, 2 + 32);

  return keccak_256(preimage);
}

/**
 * Recursive struct hash. Exported so adapters can hash sub-structs
 * directly when they need to (e.g. for a separate EIP-3009 struct
 * hash used by the x402 facilitator).
 */
export function hashStruct(
  primaryType: string,
  value: Readonly<Record<string, unknown>>,
  types: Readonly<Record<string, ReadonlyArray<TypedDataField>>>,
): Uint8Array {
  const typeHash = keccak_256(utf8Bytes(encodeType(primaryType, types)));
  const encoded = encodeData(primaryType, value, types);

  const preimage = new Uint8Array(32 + encoded.length);
  preimage.set(typeHash, 0);
  preimage.set(encoded, 32);

  return keccak_256(preimage);
}

/**
 * Produce the canonical `encodeType` string for a given primary
 * type. Referenced types are appended in lexicographic order per
 * EIP-712's spec: `"Main(...)SubA(...)SubB(...)"`.
 */
export function encodeType(
  primaryType: string,
  types: Readonly<Record<string, ReadonlyArray<TypedDataField>>>,
): string {
  const referenced = collectReferencedTypes(primaryType, types);
  // primaryType first, then lexicographically-sorted others
  const others = [...referenced].filter((t) => t !== primaryType).sort();
  const all = [primaryType, ...others];
  return all.map((t) => encodeOneType(t, types[t])).join("");
}

function encodeOneType(name: string, fields: ReadonlyArray<TypedDataField> | undefined): string {
  if (!fields) {
    throw new CustodyError("signing-failed", `Unknown type "${name}" referenced in EIP-712 typed data`);
  }
  return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
}

function collectReferencedTypes(
  root: string,
  types: Readonly<Record<string, ReadonlyArray<TypedDataField>>>,
  seen: Set<string> = new Set(),
): Set<string> {
  if (seen.has(root)) return seen;
  const fields = types[root];
  if (!fields) return seen;
  seen.add(root);
  for (const f of fields) {
    // strip array suffix for lookup (we don't support arrays at the
    // value-encoding level; see encodeField below)
    const base = f.type.replace(/\[\d*\]$/, "");
    if (types[base]) {
      collectReferencedTypes(base, types, seen);
    }
  }
  return seen;
}

/**
 * ABI-encode a struct's values into the concatenated 32-byte words
 * that `hashStruct` consumes. Order matches `types[primaryType]`.
 */
function encodeData(
  primaryType: string,
  value: Readonly<Record<string, unknown>>,
  types: Readonly<Record<string, ReadonlyArray<TypedDataField>>>,
): Uint8Array {
  const fields = types[primaryType];
  if (!fields) {
    throw new CustodyError("signing-failed", `Unknown type "${primaryType}"`);
  }
  const parts = fields.map((f) => encodeField(f.type, value[f.name], types, f.name));
  return concatBytes(...parts);
}

function encodeField(
  type: string,
  value: unknown,
  types: Readonly<Record<string, ReadonlyArray<TypedDataField>>>,
  fieldName: string,
): Uint8Array {
  // Arrays — intentionally unsupported (must be checked BEFORE the
  // prefix-based type checks below, because `"uint256[]".startsWith("uint")`
  // would otherwise route arrays into the integer encoder and produce a
  // less precise error).
  if (type.endsWith("]")) {
    throw new CustodyError(
      "signing-failed",
      `Field "${fieldName}": array types (${type}) are not supported by this EIP-712 encoder`,
    );
  }

  // Struct
  if (types[type]) {
    if (typeof value !== "object" || value === null) {
      throw new CustodyError(
        "signing-failed",
        `Field "${fieldName}" of struct type "${type}" must be an object`,
      );
    }
    return hashStruct(type, value as Record<string, unknown>, types);
  }

  // bytes (dynamic) → keccak256(bytes)
  if (type === "bytes") {
    const bytes = hexToBytes(value as `0x${string}`);
    return keccak_256(bytes);
  }

  // string → keccak256(utf8(value))
  if (type === "string") {
    return keccak_256(utf8Bytes(value as string));
  }

  // address → right-padded in 32-byte slot
  if (type === "address") {
    const out = new Uint8Array(32);
    const bytes = hexToBytes(value as `0x${string}`);
    if (bytes.length !== 20) {
      throw new CustodyError(
        "signing-failed",
        `Field "${fieldName}": address must be 20 bytes, got ${bytes.length}`,
      );
    }
    out.set(bytes, 12);
    return out;
  }

  // bytesN — left-aligned in 32-byte slot
  const bytesNMatch = type.match(/^bytes(\d+)$/);
  if (bytesNMatch) {
    const n = Number(bytesNMatch[1]);
    if (n < 1 || n > 32) {
      throw new CustodyError("signing-failed", `Invalid bytesN width: ${type}`);
    }
    const bytes = hexToBytes(value as `0x${string}`);
    if (bytes.length !== n) {
      throw new CustodyError(
        "signing-failed",
        `Field "${fieldName}": ${type} expects ${n} bytes, got ${bytes.length}`,
      );
    }
    const out = new Uint8Array(32);
    out.set(bytes, 0);
    return out;
  }

  // uint*/int* — big-endian in 32-byte slot
  if (type.startsWith("uint") || type.startsWith("int")) {
    return encodeInteger(value, type, fieldName);
  }

  // bool
  if (type === "bool") {
    const out = new Uint8Array(32);
    out[31] = value ? 1 : 0;
    return out;
  }

  throw new CustodyError("signing-failed", `Unsupported EIP-712 type: ${type}`);
}

function encodeInteger(value: unknown, type: string, fieldName: string): Uint8Array {
  // Accept string (for large numbers), number, bigint
  let n: bigint;
  if (typeof value === "bigint") {
    n = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new CustodyError(
        "signing-failed",
        `Field "${fieldName}": integer value ${value} is not a safe integer; use bigint or string`,
      );
    }
    n = BigInt(value);
  } else if (typeof value === "string") {
    // Accept 0x-hex or decimal
    n = value.startsWith("0x") ? BigInt(value) : BigInt(value);
  } else {
    throw new CustodyError(
      "signing-failed",
      `Field "${fieldName}": integer type "${type}" received ${typeof value}`,
    );
  }

  const out = new Uint8Array(32);
  const isSigned = type.startsWith("int");

  // Two's complement for negative signed integers
  let unsigned = n;
  if (isSigned && n < 0n) {
    unsigned = (1n << 256n) + n;
  }

  for (let i = 31; i >= 0 && unsigned > 0n; i -= 1) {
    out[i] = Number(unsigned & 0xffn);
    unsigned >>= 8n;
  }
  return out;
}

// ─── Small helpers ──────────────────────────────────────────────

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  if (typeof hex !== "string" || !hex.startsWith("0x")) {
    throw new CustodyError("signing-failed", `Expected 0x-prefixed hex string, got ${typeof hex}`);
  }
  const s = hex.slice(2);
  if (s.length % 2 !== 0) {
    throw new CustodyError("signing-failed", `Odd-length hex string: ${hex.slice(0, 18)}...`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

/** Expose domain type — useful for tests that want to verify
 *  the encoder builds the correct domain descriptor. */
export function computeDomainType(domain: TypedDataDomain): ReadonlyArray<TypedDataField> {
  return [
    ...(domain.name !== undefined ? [{ name: "name", type: "string" }] : []),
    ...(domain.version !== undefined ? [{ name: "version", type: "string" }] : []),
    ...(domain.chainId !== undefined ? [{ name: "chainId", type: "uint256" }] : []),
    ...(domain.verifyingContract !== undefined ? [{ name: "verifyingContract", type: "address" }] : []),
    ...(domain.salt !== undefined ? [{ name: "salt", type: "bytes32" }] : []),
  ];
}
