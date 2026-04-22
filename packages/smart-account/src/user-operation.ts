/**
 * ERC-4337 v0.7 UserOperation builder, packer, and hash computer.
 *
 * This module implements the on-wire spec exactly — it is the layer
 * the rest of the wallet trusts for correctness, so every helper
 * ships with an explicit reference to the EIP-4337 v0.7 specification
 * section it implements.
 *
 * Responsibilities:
 *
 *  1. Expose {@link UserOperationBuilder}, a fluent ergonomics layer
 *     that accumulates the UserOperation fields and produces either
 *     the unpacked or packed representation.
 *  2. Expose {@link packUserOperation}, the pure transformation from
 *     {@link UserOperation} to {@link PackedUserOperation}. Isolated
 *     from the builder so tests and alternative builders can reuse
 *     the packing logic.
 *  3. Expose {@link computeUserOpHash}, the canonical ERC-4337 hash
 *     used as a replay-protection / signing digest. This is **the**
 *     hash a smart account validates its owner's signature against.
 *
 * Zero runtime deps beyond `@noble/hashes/sha3` — the wallet already
 * vendors @noble everywhere.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { UserOperationError } from "./errors";
import type { PackedUserOperation, UserOperation } from "./types";

/* ────────────────────────────────────────────────────────────── *
 * Hex / byte utilities
 *
 * Kept local to this file so the package has no internal imports
 * outside `./types` and `./errors` — this keeps the crypto surface
 * auditable as a single file.
 * ────────────────────────────────────────────────────────────── */

/** Strip the `0x` prefix if present. Safe for already-bare input. */
function stripHex(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

/** Convert a hex string (with or without `0x`) to raw bytes. */
function hexToBytes(hex: string): Uint8Array {
  const raw = stripHex(hex);
  if (raw.length % 2 !== 0) {
    throw new UserOperationError(
      `hex string has odd length (${raw.length}): "${hex}"`,
    );
  }
  const out = new Uint8Array(raw.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(raw.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new UserOperationError(`invalid hex byte at offset ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

/** Format raw bytes as a `0x`-prefixed lowercase hex string. */
function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let out = "0x";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out as `0x${string}`;
}

/**
 * Left-pad a `bigint` to a fixed-width big-endian byte array.
 *
 * Used both to build `abi.encode` words (32 bytes) and the 16-byte
 * halves of `accountGasLimits` / `gasFees`.
 */
function bigintToBytesBE(value: bigint, width: number): Uint8Array {
  if (value < 0n) {
    throw new UserOperationError("negative bigint cannot be encoded");
  }
  const bits = BigInt(width * 8);
  if (value >> bits !== 0n) {
    throw new UserOperationError(
      `value ${value} does not fit in ${width} bytes`,
    );
  }
  const out = new Uint8Array(width);
  let remaining = value;
  for (let i = width - 1; i >= 0; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

/** Concatenate two or more byte arrays into one. */
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

/** keccak256 wrapper that returns a 32-byte `Uint8Array`. */
function keccak(bytes: Uint8Array): Uint8Array {
  return keccak_256(bytes);
}

/**
 * ABI-encode an address as a left-padded 32-byte big-endian word
 * (zero-padding in the high 12 bytes). The address is case-insensitive
 * on input — EVM addresses are hex; checksums are a UX concern only.
 */
function abiEncodeAddress(addr: `0x${string}`): Uint8Array {
  const raw = hexToBytes(addr);
  if (raw.length !== 20) {
    throw new UserOperationError(
      `address must be 20 bytes, got ${raw.length}: ${addr}`,
    );
  }
  const padded = new Uint8Array(32);
  padded.set(raw, 12);
  return padded;
}

/** ABI-encode a `uint256` as a big-endian 32-byte word. */
function abiEncodeUint256(value: bigint): Uint8Array {
  return bigintToBytesBE(value, 32);
}

/** ABI-encode a `bytes32` value provided as a `0x`-prefixed 32-byte hex. */
function abiEncodeBytes32(hex: `0x${string}`): Uint8Array {
  const raw = hexToBytes(hex);
  if (raw.length !== 32) {
    throw new UserOperationError(
      `bytes32 must be 32 bytes, got ${raw.length}: ${hex}`,
    );
  }
  return raw;
}

/* ────────────────────────────────────────────────────────────── *
 * Packing
 * ────────────────────────────────────────────────────────────── */

/**
 * Transform a developer-facing {@link UserOperation} into the on-wire
 * {@link PackedUserOperation} the EntryPoint consumes.
 *
 * Packing rules (EIP-4337 v0.7):
 *
 *  - `initCode` = `factory || factoryData` (both are optional and MUST
 *    appear together; throws if only one is set).
 *  - `accountGasLimits` = `verificationGasLimit << 128 | callGasLimit`
 *    encoded as a single 32-byte hex word.
 *  - `gasFees` = `maxPriorityFeePerGas << 128 | maxFeePerGas` encoded
 *    as a single 32-byte hex word.
 *  - `paymasterAndData` is `0x` when no paymaster is set; otherwise
 *    `paymaster (20) || paymasterVerificationGasLimit (16) || paymasterPostOpGasLimit (16) || paymasterData`.
 *
 * `entryPoint` and `chainId` are accepted but not used here — the
 * packed shape is independent of them. They are part of the signature
 * of this function so it can be chained with {@link computeUserOpHash}
 * without rethreading parameters in the builder.
 *
 * @example
 * ```ts
 * const packed = packUserOperation(op, ENTRYPOINT_V07_ADDRESS, 1);
 * ```
 */
export function packUserOperation(
  op: UserOperation,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for signature parity with helpers that need them
  _entryPoint?: `0x${string}`,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for signature parity with helpers that need them
  _chainId?: number,
): PackedUserOperation {
  const initCode = packInitCode(op);
  const accountGasLimits = bytesToHex(
    concatBytes(
      bigintToBytesBE(op.verificationGasLimit, 16),
      bigintToBytesBE(op.callGasLimit, 16),
    ),
  );
  const gasFees = bytesToHex(
    concatBytes(
      bigintToBytesBE(op.maxPriorityFeePerGas, 16),
      bigintToBytesBE(op.maxFeePerGas, 16),
    ),
  );
  const paymasterAndData = packPaymasterAndData(op);

  return {
    sender: op.sender,
    nonce: op.nonce,
    initCode,
    callData: op.callData,
    accountGasLimits,
    preVerificationGas: op.preVerificationGas,
    gasFees,
    paymasterAndData,
    signature: op.signature,
  };
}

/** Pack `factory` + `factoryData` into the `initCode` field. */
function packInitCode(op: UserOperation): `0x${string}` {
  const hasFactory = op.factory !== undefined;
  const hasData = op.factoryData !== undefined;
  if (hasFactory !== hasData) {
    throw new UserOperationError(
      "factory and factoryData must be set together or omitted together",
    );
  }
  if (!hasFactory) return "0x";
  const factoryBytes = hexToBytes(op.factory as `0x${string}`);
  if (factoryBytes.length !== 20) {
    throw new UserOperationError(
      `factory address must be 20 bytes, got ${factoryBytes.length}`,
    );
  }
  const dataBytes = hexToBytes(op.factoryData as `0x${string}`);
  return bytesToHex(concatBytes(factoryBytes, dataBytes));
}

/** Pack paymaster fields into the `paymasterAndData` field. */
function packPaymasterAndData(op: UserOperation): `0x${string}` {
  if (!op.paymaster) return "0x";
  const paymasterBytes = hexToBytes(op.paymaster);
  if (paymasterBytes.length !== 20) {
    throw new UserOperationError(
      `paymaster address must be 20 bytes, got ${paymasterBytes.length}`,
    );
  }
  const verifyGas = bigintToBytesBE(op.paymasterVerificationGasLimit ?? 0n, 16);
  const postGas = bigintToBytesBE(op.paymasterPostOpGasLimit ?? 0n, 16);
  const data = op.paymasterData ? hexToBytes(op.paymasterData) : new Uint8Array(0);
  return bytesToHex(concatBytes(paymasterBytes, verifyGas, postGas, data));
}

/* ────────────────────────────────────────────────────────────── *
 * UserOp hash
 * ────────────────────────────────────────────────────────────── */

/**
 * Compute the canonical EIP-4337 v0.7 `userOpHash` for a
 * {@link PackedUserOperation}.
 *
 * Per the spec (v0.7 EntryPoint `getUserOpHash`):
 *
 * ```solidity
 * bytes32 hashedPacked = keccak256(abi.encode(
 *     userOp.sender,
 *     userOp.nonce,
 *     keccak256(userOp.initCode),
 *     keccak256(userOp.callData),
 *     userOp.accountGasLimits,
 *     userOp.preVerificationGas,
 *     userOp.gasFees,
 *     keccak256(userOp.paymasterAndData)
 * ));
 * userOpHash = keccak256(abi.encode(hashedPacked, entryPoint, chainId));
 * ```
 *
 * Smart accounts verify their owner's signature against this hash, so
 * any drift in the implementation silently breaks signing. The
 * packager and hasher are unit-tested against the ERC-4337 reference
 * output (see tests).
 *
 * @example
 * ```ts
 * const hash = computeUserOpHash(packed, ENTRYPOINT_V07_ADDRESS, 1);
 * // hash is the 32-byte digest the account validates `signature` over.
 * ```
 */
export function computeUserOpHash(
  packed: PackedUserOperation,
  entryPoint: `0x${string}`,
  chainId: number,
): `0x${string}` {
  const hashedPacked = keccak(
    concatBytes(
      abiEncodeAddress(packed.sender),
      abiEncodeUint256(packed.nonce),
      abiEncodeBytes32(bytesToHex(keccak(hexToBytes(packed.initCode)))),
      abiEncodeBytes32(bytesToHex(keccak(hexToBytes(packed.callData)))),
      abiEncodeBytes32(packed.accountGasLimits),
      abiEncodeUint256(packed.preVerificationGas),
      abiEncodeBytes32(packed.gasFees),
      abiEncodeBytes32(bytesToHex(keccak(hexToBytes(packed.paymasterAndData)))),
    ),
  );

  const finalHash = keccak(
    concatBytes(
      abiEncodeBytes32(bytesToHex(hashedPacked)),
      abiEncodeAddress(entryPoint),
      abiEncodeUint256(BigInt(chainId)),
    ),
  );
  return bytesToHex(finalHash);
}

/* ────────────────────────────────────────────────────────────── *
 * Builder
 * ────────────────────────────────────────────────────────────── */

/** Configuration accepted by {@link UserOperationBuilder.constructor}. */
export interface UserOperationBuilderConfig {
  /** Target chain the UserOperation will be submitted on. */
  chainId: number;
  /** EntryPoint the UserOperation targets (must match `chainId`). */
  entryPointAddress: `0x${string}`;
  /** Smart account sending the UserOperation. */
  sender: `0x${string}`;
}

/** Gas parameters accepted by {@link UserOperationBuilder.setGas}. */
export interface UserOperationGasParams {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** Paymaster parameters accepted by {@link UserOperationBuilder.setPaymaster}. */
export interface UserOperationPaymasterParams {
  paymaster: `0x${string}`;
  data?: `0x${string}`;
  verificationGasLimit?: bigint;
  postOpGasLimit?: bigint;
}

/**
 * Fluent builder for a {@link UserOperation}.
 *
 * The builder is stateful and returns `this` from every mutator so
 * callers can chain:
 *
 * @example
 * ```ts
 * const op = new UserOperationBuilder({
 *   chainId: 1,
 *   entryPointAddress: ENTRYPOINT_V07_ADDRESS,
 *   sender: account,
 * })
 *   .setNonce(0n)
 *   .setCallData(encodeSimpleAccountExecute(to, 0n, "0x"))
 *   .setGas(gasEstimate)
 *   .setSignature(signature)
 *   .build();
 * ```
 *
 * `build()` throws if any required field is unset (callData, nonce, gas
 * params). `buildPacked()` and `hash()` are thin convenience wrappers
 * over `build()` + `packUserOperation` + `computeUserOpHash`.
 */
export class UserOperationBuilder {
  private readonly chainId: number;
  private readonly entryPointAddress: `0x${string}`;
  private readonly sender: `0x${string}`;

  private nonceValue: bigint | undefined;
  private callDataValue: `0x${string}` | undefined;
  private gasParams: UserOperationGasParams | undefined;
  private factoryValue: `0x${string}` | undefined;
  private factoryDataValue: `0x${string}` | undefined;
  private paymasterValue: `0x${string}` | undefined;
  private paymasterDataValue: `0x${string}` | undefined;
  private paymasterVerificationGasLimit: bigint | undefined;
  private paymasterPostOpGasLimit: bigint | undefined;
  private signatureValue: `0x${string}` = "0x";

  constructor(config: UserOperationBuilderConfig) {
    this.chainId = config.chainId;
    this.entryPointAddress = config.entryPointAddress;
    this.sender = config.sender;
  }

  /** Set the anti-replay nonce (upper 192b key, lower 64b seq). */
  setNonce(nonce: bigint): this {
    if (nonce < 0n) {
      throw new UserOperationError("nonce must be non-negative");
    }
    this.nonceValue = nonce;
    return this;
  }

  /** Set the calldata the account will execute. */
  setCallData(callData: `0x${string}`): this {
    this.callDataValue = callData;
    return this;
  }

  /** Set all five gas parameters in one call. */
  setGas(gas: UserOperationGasParams): this {
    this.gasParams = { ...gas };
    return this;
  }

  /** Attach a paymaster sponsoring the operation. */
  setPaymaster(config: UserOperationPaymasterParams): this {
    this.paymasterValue = config.paymaster;
    this.paymasterDataValue = config.data;
    this.paymasterVerificationGasLimit = config.verificationGasLimit;
    this.paymasterPostOpGasLimit = config.postOpGasLimit;
    return this;
  }

  /**
   * Attach a factory + factoryData for first-deploy UserOps. Call
   * this exactly once on the very first UserOp for a counterfactual
   * account; omit on all subsequent UserOps.
   */
  setFactory(factory: `0x${string}`, data: `0x${string}`): this {
    this.factoryValue = factory;
    this.factoryDataValue = data;
    return this;
  }

  /** Set the owner signature over the UserOp hash. */
  setSignature(sig: `0x${string}`): this {
    this.signatureValue = sig;
    return this;
  }

  /** Materialise the unpacked {@link UserOperation}. */
  build(): UserOperation {
    if (this.callDataValue === undefined) {
      throw new UserOperationError("callData is required");
    }
    if (this.nonceValue === undefined) {
      throw new UserOperationError("nonce is required");
    }
    if (this.gasParams === undefined) {
      throw new UserOperationError("gas params are required (setGas)");
    }

    const op: UserOperation = {
      sender: this.sender,
      nonce: this.nonceValue,
      callData: this.callDataValue,
      callGasLimit: this.gasParams.callGasLimit,
      verificationGasLimit: this.gasParams.verificationGasLimit,
      preVerificationGas: this.gasParams.preVerificationGas,
      maxFeePerGas: this.gasParams.maxFeePerGas,
      maxPriorityFeePerGas: this.gasParams.maxPriorityFeePerGas,
      signature: this.signatureValue,
    };

    if (this.factoryValue !== undefined && this.factoryDataValue !== undefined) {
      op.factory = this.factoryValue;
      op.factoryData = this.factoryDataValue;
    }

    if (this.paymasterValue !== undefined) {
      op.paymaster = this.paymasterValue;
      if (this.paymasterDataValue !== undefined) {
        op.paymasterData = this.paymasterDataValue;
      }
      if (this.paymasterVerificationGasLimit !== undefined) {
        op.paymasterVerificationGasLimit = this.paymasterVerificationGasLimit;
      }
      if (this.paymasterPostOpGasLimit !== undefined) {
        op.paymasterPostOpGasLimit = this.paymasterPostOpGasLimit;
      }
    }

    return op;
  }

  /** Materialise the on-wire {@link PackedUserOperation}. */
  buildPacked(): PackedUserOperation {
    return packUserOperation(this.build(), this.entryPointAddress, this.chainId);
  }

  /**
   * Compute the canonical `userOpHash` that a smart account's
   * `validateUserOp` expects the signature to cover.
   */
  hash(): `0x${string}` {
    return computeUserOpHash(
      this.buildPacked(),
      this.entryPointAddress,
      this.chainId,
    );
  }
}
