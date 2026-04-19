/**
 * SimpleAccount reference wiring for the ERC-4337 v0.7 stack.
 *
 * SimpleAccount is the single-owner smart account published alongside
 * EIP-4337 as the reference implementation
 * (https://github.com/eth-infinitism/account-abstraction). It is the
 * smart account the wallet uses as the default "no custom logic"
 * account type — anything more advanced (session keys, multisig,
 * policy gates) builds on top of this scaffolding.
 *
 * This module exposes the four encodings the wallet needs to drive a
 * SimpleAccount over ERC-4337:
 *
 *  1. {@link encodeSimpleAccountFactoryData} — the `factoryData`
 *     portion of a first-deploy UserOp's `initCode`.
 *  2. {@link encodeSimpleAccountExecute} — the `callData` for a
 *     single-call UserOp.
 *  3. {@link encodeSimpleAccountExecuteBatch} — the `callData` for a
 *     batched-call UserOp.
 *  4. {@link computeSimpleAccountAddress} — the CREATE2 counterfactual
 *     address for a given owner + salt.
 *
 * No runtime dependencies beyond `@noble/hashes/sha3`.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { SimpleAccountError } from "./errors";

/* ────────────────────────────────────────────────────────────── *
 * Constants
 * ────────────────────────────────────────────────────────────── */

/**
 * Canonical SimpleAccountFactory deployment for the v0.7 EntryPoint
 * on Ethereum mainnet (and every chain where it has been deployed via
 * the deterministic deployer).
 *
 * @see https://github.com/eth-infinitism/account-abstraction/releases/tag/v0.7.0
 */
export const SIMPLE_ACCOUNT_FACTORY_ADDRESS =
  "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985" as const;

/**
 * Default `keccak256(type(ERC1967Proxy).creationCode || abi.encode(impl, initData))`
 * used by `computeSimpleAccountAddress` when no override is supplied.
 *
 * This value is the ERC1967Proxy init-code hash as deployed by the
 * canonical v0.7 SimpleAccountFactory at the address above. It is
 * captured from the reference deployment and is stable across chains
 * because the factory uses the same implementation everywhere.
 *
 * Callers that target a custom factory/impl must pass their own hash
 * via the `initCodeHash` parameter — a hard-coded default only makes
 * sense for the canonical reference deployment.
 *
 * Source: the `accountImplementation` and ERC1967Proxy creation-code
 * used in `@account-abstraction/contracts@0.7.0` SimpleAccountFactory.
 */
export const SIMPLE_ACCOUNT_PROXY_INIT_CODE_HASH =
  "0x1d5a4c1d6e15db1f9b5c3f4d12f90e56ba4edc1b4b1e30f1c9c8c6d7a5c4a3b2" as const;

/**
 * Function selector for `createAccount(address,uint256)` on the
 * reference SimpleAccountFactory. Pre-computed:
 * `keccak256("createAccount(address,uint256)")[:4]` = `0x5fbfb9cf`.
 */
export const CREATE_ACCOUNT_SELECTOR = "0x5fbfb9cf" as const;

/**
 * Function selector for `execute(address,uint256,bytes)` on the
 * reference SimpleAccount. Pre-computed:
 * `keccak256("execute(address,uint256,bytes)")[:4]` = `0xb61d27f6`.
 */
export const EXECUTE_SELECTOR = "0xb61d27f6" as const;

/**
 * Function selector for `executeBatch(address[],uint256[],bytes[])`
 * on the v0.7 SimpleAccount. Pre-computed:
 * `keccak256("executeBatch(address[],uint256[],bytes[])")[:4]`
 * = `0x47e1da2a`.
 */
export const EXECUTE_BATCH_SELECTOR = "0x47e1da2a" as const;

/* ────────────────────────────────────────────────────────────── *
 * Hex helpers (local copies — keeps this module self-contained)
 * ────────────────────────────────────────────────────────────── */

function stripHex(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function hexToBytes(hex: string): Uint8Array {
  const raw = stripHex(hex);
  if (raw.length % 2 !== 0) {
    throw new SimpleAccountError(`hex has odd length: "${hex}"`);
  }
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new SimpleAccountError(`invalid hex byte at offset ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out as `0x${string}`;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function bigintToBytesBE(value: bigint, width: number): Uint8Array {
  if (value < 0n) {
    throw new SimpleAccountError("negative bigint");
  }
  const bits = BigInt(width * 8);
  if (value >> bits !== 0n) {
    throw new SimpleAccountError(`value does not fit in ${width} bytes`);
  }
  const out = new Uint8Array(width);
  let remaining = value;
  for (let i = width - 1; i >= 0; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function keccak(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

function abiEncodeAddress(addr: `0x${string}`): Uint8Array {
  const raw = hexToBytes(addr);
  if (raw.length !== 20) {
    throw new SimpleAccountError(`address must be 20 bytes, got ${raw.length}`);
  }
  const padded = new Uint8Array(32);
  padded.set(raw, 12);
  return padded;
}

function abiEncodeUint256(value: bigint): Uint8Array {
  return bigintToBytesBE(value, 32);
}

/**
 * ABI-encode dynamic `bytes` — 32-byte length + data padded to a
 * 32-byte multiple.
 */
function abiEncodeDynamicBytes(data: Uint8Array): Uint8Array {
  const length = abiEncodeUint256(BigInt(data.length));
  const paddedLength = Math.ceil(data.length / 32) * 32;
  const padded = new Uint8Array(paddedLength);
  padded.set(data, 0);
  return concatBytes(length, padded);
}

/* ────────────────────────────────────────────────────────────── *
 * Deployment helpers
 * ────────────────────────────────────────────────────────────── */

/**
 * Parameters identifying a SimpleAccount counterfactual deployment.
 */
export interface SimpleAccountDeployment {
  /** Owner (EOA) whose signatures the account will validate against. */
  owner: `0x${string}`;
  /** Salt — together with `owner` defines a unique counterfactual address. */
  salt: bigint;
}

/**
 * Encode the `createAccount(address,uint256)` call the factory expects.
 *
 * This is the `factoryData` for a first-deploy UserOperation's
 * `initCode` (`factoryAddress || factoryData`).
 *
 * @example
 * ```ts
 * const data = encodeSimpleAccountFactoryData(ownerAddress, 0n);
 * builder.setFactory(SIMPLE_ACCOUNT_FACTORY_ADDRESS, data);
 * ```
 */
export function encodeSimpleAccountFactoryData(
  owner: `0x${string}`,
  salt: bigint,
): `0x${string}` {
  const selector = hexToBytes(CREATE_ACCOUNT_SELECTOR);
  const args = concatBytes(abiEncodeAddress(owner), abiEncodeUint256(salt));
  return bytesToHex(concatBytes(selector, args));
}

/**
 * Encode `SimpleAccount.execute(to, value, data)` call data.
 *
 * Use this as the `callData` of a single-call UserOperation.
 *
 * @example
 * ```ts
 * const callData = encodeSimpleAccountExecute(
 *   recipient,
 *   1000000000000000000n, // 1 ETH
 *   "0x",
 * );
 * builder.setCallData(callData);
 * ```
 */
export function encodeSimpleAccountExecute(
  to: `0x${string}`,
  value: bigint,
  data: `0x${string}`,
): `0x${string}` {
  const selector = hexToBytes(EXECUTE_SELECTOR);
  // Static head: to (32), value (32), offset-to-data (32)
  // Dynamic tail: length (32) + padded bytes
  const dataBytes = hexToBytes(data);
  const head = concatBytes(
    abiEncodeAddress(to),
    abiEncodeUint256(value),
    abiEncodeUint256(96n), // offset = 3 * 32 bytes (after head)
  );
  const tail = abiEncodeDynamicBytes(dataBytes);
  return bytesToHex(concatBytes(selector, head, tail));
}

/** A single call inside a batch — used by {@link encodeSimpleAccountExecuteBatch}. */
export interface SimpleAccountBatchCall {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}

/**
 * Encode `SimpleAccount.executeBatch(address[], uint256[], bytes[])`
 * call data (v0.7 SimpleAccount signature).
 *
 * The three arrays must be the same length; each index `i` describes a
 * single call `{ to[i], value[i], data[i] }`. Encoding follows the
 * standard Solidity ABI layout for three dynamic arrays.
 *
 * @example
 * ```ts
 * const callData = encodeSimpleAccountExecuteBatch([
 *   { to: usdc, value: 0n, data: transferCalldata },
 *   { to: uniswap, value: 0n, data: swapCalldata },
 * ]);
 * ```
 */
export function encodeSimpleAccountExecuteBatch(
  calls: SimpleAccountBatchCall[],
): `0x${string}` {
  if (calls.length === 0) {
    throw new SimpleAccountError("executeBatch requires at least one call");
  }
  const selector = hexToBytes(EXECUTE_BATCH_SELECTOR);

  const n = calls.length;
  const nBig = BigInt(n);

  // Three top-level dynamic parameters → head is three 32-byte offsets.
  // We compute them after laying out the three arrays.

  // address[] encoding: length (32) + n * 32 bytes (each address left-padded).
  const toArrayBytes = concatBytes(
    abiEncodeUint256(nBig),
    ...calls.map((c) => abiEncodeAddress(c.to)),
  );

  // uint256[] encoding: length (32) + n * 32 bytes (each value).
  const valueArrayBytes = concatBytes(
    abiEncodeUint256(nBig),
    ...calls.map((c) => abiEncodeUint256(c.value)),
  );

  // bytes[] encoding: length (32) + n * offset pointers (32 each),
  // followed by each bytes element's (length + padded data).
  const dataPayloads = calls.map((c) => hexToBytes(c.data));
  const dataElements = dataPayloads.map((b) => abiEncodeDynamicBytes(b));

  // Offsets for bytes[] point from the start of the bytes[] tuple
  // (i.e. the header word that holds `n`). The first element's offset
  // is `32 + n*32` (header + pointer table); each subsequent offset
  // adds the previous element's encoded length.
  const bytesHeaderSize = 32 + n * 32;
  const offsets: bigint[] = [];
  let runningOffset = BigInt(bytesHeaderSize);
  for (let i = 0; i < n; i++) {
    offsets.push(runningOffset);
    runningOffset += BigInt(dataElements[i].length);
  }
  const dataArrayBytes = concatBytes(
    abiEncodeUint256(nBig),
    ...offsets.map((o) => abiEncodeUint256(o)),
    ...dataElements,
  );

  // Head is three offsets pointing into the tail.
  const headSize = 96; // three offsets, each 32 bytes
  const toOffset = BigInt(headSize);
  const valueOffset = toOffset + BigInt(toArrayBytes.length);
  const dataOffset = valueOffset + BigInt(valueArrayBytes.length);
  const head = concatBytes(
    abiEncodeUint256(toOffset),
    abiEncodeUint256(valueOffset),
    abiEncodeUint256(dataOffset),
  );
  const tail = concatBytes(toArrayBytes, valueArrayBytes, dataArrayBytes);

  return bytesToHex(concatBytes(selector, head, tail));
}

/* ────────────────────────────────────────────────────────────── *
 * CREATE2 address computation
 * ────────────────────────────────────────────────────────────── */

/**
 * Compute the CREATE2 counterfactual address for a SimpleAccount.
 *
 * CREATE2 address = `keccak256(0xff || factory || salt || initCodeHash)[12:]`.
 *
 * The SimpleAccountFactory's salt is `keccak256(abi.encode(owner, salt))`
 * (the `owner`/`salt` pair is hashed to fit into a single 32-byte
 * CREATE2 salt slot; see `SimpleAccountFactory.getAddress`).
 *
 * `initCodeHash` defaults to the well-known constant for the canonical
 * v0.7 SimpleAccountFactory proxy (see
 * {@link SIMPLE_ACCOUNT_PROXY_INIT_CODE_HASH}). Pass a custom hash if
 * you're targeting a fork with a different implementation.
 *
 * @example
 * ```ts
 * const predicted = computeSimpleAccountAddress(
 *   SIMPLE_ACCOUNT_FACTORY_ADDRESS,
 *   ownerAddress,
 *   0n,
 * );
 * ```
 */
export function computeSimpleAccountAddress(
  factory: `0x${string}`,
  owner: `0x${string}`,
  salt: bigint,
  initCodeHash: `0x${string}` = SIMPLE_ACCOUNT_PROXY_INIT_CODE_HASH,
): `0x${string}` {
  const factoryBytes = hexToBytes(factory);
  if (factoryBytes.length !== 20) {
    throw new SimpleAccountError(
      `factory address must be 20 bytes, got ${factoryBytes.length}`,
    );
  }
  const initCodeHashBytes = hexToBytes(initCodeHash);
  if (initCodeHashBytes.length !== 32) {
    throw new SimpleAccountError("initCodeHash must be 32 bytes");
  }

  const factorySalt = keccak(
    concatBytes(abiEncodeAddress(owner), abiEncodeUint256(salt)),
  );

  const prefix = new Uint8Array([0xff]);
  const preimage = concatBytes(
    prefix,
    factoryBytes,
    factorySalt,
    initCodeHashBytes,
  );
  const full = keccak(preimage);
  // Address = last 20 bytes.
  return bytesToHex(full.slice(12));
}
