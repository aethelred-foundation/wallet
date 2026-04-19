/**
 * EIP-712 typed-data hashing.
 *
 * Implements the subset of https://eips.ethereum.org/EIPS/eip-712 needed to
 * produce the 32-byte digest that `personal_sign`/`eth_signTypedData_v4`
 * must sign. This replaces the previous `TextEncoder().encode(json)`
 * nonsense in background.ts which signed JSON bytes instead of the
 * domain-separated struct hash.
 *
 * Scope:
 *   - Types: address, bool, bytes, bytes1..32, string, uintN (N up to 256),
 *     intN (N up to 256), fixed-length and dynamic arrays, nested structs.
 *   - Domain: EIP712Domain (name, version, chainId, verifyingContract, salt)
 *     with all fields optional per the spec.
 *   - Primary type: any user-defined struct.
 *
 * Not implemented: `fixed`, `ufixed` — Solidity deprecates these and no
 * mainstream contract uses them in EIP-712 domains.
 */

import { keccak_256 } from "@noble/hashes/sha3";

/** A field in a typed struct, e.g. { name: "from", type: "address" } */
export interface TypedDataField {
  name: string;
  type: string;
}

/** Map from struct name → ordered field list */
export type TypedDataTypes = Record<string, TypedDataField[]>;

/** A typed-data message, shaped like the EIP-712 JSON that dApps send */
export interface TypedDataV4 {
  types: TypedDataTypes;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
}

/* ───────────── Primitive encoders ───────────── */

function encodeUint256(value: unknown): Uint8Array {
  const n = typeof value === "bigint" ? value : BigInt(value as string | number);
  if (n < 0n) throw new Error(`EIP-712 uint256 cannot be negative: ${value}`);
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function encodeInt256(value: unknown): Uint8Array {
  let n = typeof value === "bigint" ? value : BigInt(value as string | number);
  // Two's complement for negatives
  if (n < 0n) {
    n = (1n << 256n) + n;
  }
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function encodeBool(value: unknown): Uint8Array {
  const out = new Uint8Array(32);
  out[31] = value ? 1 : 0;
  return out;
}

function encodeAddress(value: unknown): Uint8Array {
  const hex = normalizeHex(value);
  if (hex.length !== 40) throw new Error(`EIP-712 address must be 20 bytes (40 hex chars), got ${hex.length}`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 20; i++) {
    out[12 + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function encodeBytesFixed(value: unknown, size: number): Uint8Array {
  const bytes = hexOrUtf8ToBytes(value);
  if (bytes.length !== size) {
    throw new Error(`EIP-712 bytes${size} expected ${size} bytes, got ${bytes.length}`);
  }
  const out = new Uint8Array(32);
  out.set(bytes, 0); // left-aligned
  return out;
}

function encodeBytesDynamic(value: unknown): Uint8Array {
  const bytes = hexOrUtf8ToBytes(value);
  return keccak_256(bytes);
}

function encodeString(value: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  return keccak_256(bytes);
}

/* ───────────── Helpers ───────────── */

function normalizeHex(v: unknown): string {
  const s = String(v ?? "");
  return (s.startsWith("0x") ? s.slice(2) : s).toLowerCase();
}

function hexOrUtf8ToBytes(v: unknown): Uint8Array {
  const s = String(v ?? "");
  if (s.startsWith("0x") || s.startsWith("0X")) {
    const hex = s.slice(2);
    const padded = hex.length % 2 === 0 ? hex : "0" + hex;
    const bytes = new Uint8Array(padded.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  return new TextEncoder().encode(s);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

/* ───────────── Type resolution ───────────── */

/**
 * Walk the struct graph from `primaryType` and return the ordered set
 * of referenced struct names (excluding the primary itself) for the
 * `encodeType` concatenation.
 */
function findDependencies(
  primaryType: string,
  types: TypedDataTypes,
  found: Set<string> = new Set(),
): Set<string> {
  if (found.has(primaryType)) return found;
  if (!types[primaryType]) return found;
  found.add(primaryType);
  for (const field of types[primaryType]) {
    // Strip array brackets to get the base type
    const base = field.type.replace(/\[.*\]/g, "");
    if (types[base]) findDependencies(base, types, found);
  }
  return found;
}

/**
 * Canonical EIP-712 type string: primary first, then referenced structs
 * sorted alphabetically. Fields rendered as `type name`.
 */
export function encodeType(primaryType: string, types: TypedDataTypes): string {
  const deps = findDependencies(primaryType, types);
  deps.delete(primaryType);
  const sorted = [primaryType, ...Array.from(deps).sort()];
  return sorted
    .map((t) => `${t}(${(types[t] ?? []).map((f) => `${f.type} ${f.name}`).join(",")})`)
    .join("");
}

/** 32-byte typeHash — keccak256 of the canonical type string. */
export function typeHash(primaryType: string, types: TypedDataTypes): Uint8Array {
  return keccak_256(new TextEncoder().encode(encodeType(primaryType, types)));
}

/* ───────────── Value encoding ───────────── */

function encodeField(
  type: string,
  value: unknown,
  types: TypedDataTypes,
): Uint8Array {
  // Nested struct
  if (types[type]) {
    return keccak_256(encodeData(type, value as Record<string, unknown>, types));
  }

  // Arrays (both fixed and dynamic)
  const arrayMatch = type.match(/^(.*)(\[\d*\])$/);
  if (arrayMatch) {
    const baseType = arrayMatch[1];
    const arr = (value as unknown[]) ?? [];
    const encoded = arr.map((v) => encodeField(baseType, v, types));
    return keccak_256(concatBytes(...encoded));
  }

  // Primitives
  if (type === "address") return encodeAddress(value);
  if (type === "bool") return encodeBool(value);
  if (type === "string") return encodeString(value);
  if (type === "bytes") return encodeBytesDynamic(value);

  const bytesMatch = type.match(/^bytes(\d+)$/);
  if (bytesMatch) return encodeBytesFixed(value, parseInt(bytesMatch[1], 10));

  if (type.startsWith("uint") || type === "uint") return encodeUint256(value);
  if (type.startsWith("int") || type === "int") return encodeInt256(value);

  throw new Error(`EIP-712: unsupported type "${type}"`);
}

/**
 * Struct body encoding: typeHash || encodedFieldsInOrder
 */
export function encodeData(
  primaryType: string,
  data: Record<string, unknown>,
  types: TypedDataTypes,
): Uint8Array {
  const th = typeHash(primaryType, types);
  const fields = types[primaryType] ?? [];
  const encodedFields = fields.map((f) => encodeField(f.type, data[f.name], types));
  return concatBytes(th, ...encodedFields);
}

/** 32-byte struct hash — keccak256 of typeHash || encodedFields. */
export function structHash(
  primaryType: string,
  data: Record<string, unknown>,
  types: TypedDataTypes,
): Uint8Array {
  return keccak_256(encodeData(primaryType, data, types));
}

/**
 * The EIP-712 domain separator. If the domain omits `EIP712Domain` from
 * its types, we synthesize a standard one based on which fields the
 * domain object actually contains — matching MetaMask's behavior.
 */
export function domainSeparator(typedData: TypedDataV4): Uint8Array {
  const { domain, types } = typedData;
  let domainTypes = types["EIP712Domain"];

  if (!domainTypes) {
    // Auto-derive the domain fields the dApp actually supplied
    const auto: TypedDataField[] = [];
    if (domain.name != null) auto.push({ name: "name", type: "string" });
    if (domain.version != null) auto.push({ name: "version", type: "string" });
    if (domain.chainId != null) auto.push({ name: "chainId", type: "uint256" });
    if (domain.verifyingContract != null) auto.push({ name: "verifyingContract", type: "address" });
    if (domain.salt != null) auto.push({ name: "salt", type: "bytes32" });
    domainTypes = auto;
  }

  const domainTypesWithDomain: TypedDataTypes = {
    ...types,
    EIP712Domain: domainTypes,
  };
  return structHash("EIP712Domain", domain, domainTypesWithDomain);
}

/**
 * The final digest to be signed: keccak256(0x1901 || domainSep || structHash).
 * This is what ecrecover will verify against the signer's address.
 */
export function hashTypedDataV4(typedData: TypedDataV4): Uint8Array {
  const domSep = domainSeparator(typedData);
  const msgHash = structHash(typedData.primaryType, typedData.message, typedData.types);
  const payload = new Uint8Array(2 + 32 + 32);
  payload[0] = 0x19;
  payload[1] = 0x01;
  payload.set(domSep, 2);
  payload.set(msgHash, 34);
  return keccak_256(payload);
}

/**
 * Convenience: accepts the raw JSON string a dApp passes to
 * `eth_signTypedData_v4`, parses it, and returns the 32-byte digest.
 * Throws if the JSON is malformed or missing required fields.
 */
export function hashTypedDataV4Json(json: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`EIP-712: invalid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("EIP-712: payload must be an object");
  }
  const td = parsed as Partial<TypedDataV4>;
  if (!td.types || !td.primaryType || !td.domain || !td.message) {
    throw new Error("EIP-712: missing required fields (types, primaryType, domain, message)");
  }
  return hashTypedDataV4(td as TypedDataV4);
}
