/**
 * ERC-4337 v0.7 type definitions.
 *
 * These mirror the fields defined in the EIP-4337 v0.7 specification
 * (https://eips.ethereum.org/EIPS/eip-4337). v0.7 is the current
 * production EntryPoint; v0.6 is deprecated and kept only for legacy
 * compatibility helpers.
 *
 * Two shapes are modelled:
 *
 *  - {@link UserOperation} — the "unpacked" developer-facing shape.
 *    Most of the wallet (builder APIs, bundler RPCs, UI surfaces)
 *    works against this because it keeps every gas parameter as its
 *    own `bigint`.
 *  - {@link PackedUserOperation} — the on-wire shape the EntryPoint
 *    contract itself consumes. It packs the gas limits and fee values
 *    into 32-byte words so the contract can `abi.decode` them in a
 *    single read. The builder converts between the two via
 *    `packUserOperation`.
 *
 * All numeric fields are `bigint` — gas parameters routinely exceed
 * 2^53 once denominated in wei, so `number` would silently truncate.
 * All hex strings are typed as the Viem-style branded literal
 * `` `0x${string}` `` so they cannot be confused with arbitrary strings.
 */

/**
 * ERC-4337 v0.7 "packed" UserOperation — the struct that the
 * EntryPoint's `handleOps` function consumes and that `userOpHash`
 * is computed over.
 *
 * Packing layout (each 32-byte word):
 *   - `accountGasLimits`  = `verificationGasLimit << 128 | callGasLimit`
 *   - `gasFees`           = `maxPriorityFeePerGas << 128 | maxFeePerGas`
 *   - `paymasterAndData`  = paymaster (20 bytes)
 *                         || paymasterVerificationGasLimit (16 bytes)
 *                         || paymasterPostOpGasLimit (16 bytes)
 *                         || paymasterData (remaining bytes)
 *
 * @example
 * ```ts
 * const packed: PackedUserOperation = packUserOperation(op, entryPoint, chainId);
 * // packed.accountGasLimits starts with the 16-byte big-endian
 * // verificationGasLimit followed by the 16-byte big-endian callGasLimit.
 * ```
 */
export interface PackedUserOperation {
  /** Smart account sending the UserOperation. */
  sender: `0x${string}`;
  /** Anti-replay nonce — upper 192 bits are the "key", lower 64 are the sequence. */
  nonce: bigint;
  /** `factory || factoryData` if the account needs deployment, `0x` otherwise. */
  initCode: `0x${string}`;
  /** Calldata the EntryPoint will pass to the account's `execute` (or equivalent). */
  callData: `0x${string}`;
  /** `verificationGasLimit << 128 | callGasLimit`, packed as a 32-byte hex word. */
  accountGasLimits: `0x${string}`;
  /** Overhead gas the bundler is compensated for (pre-verification). */
  preVerificationGas: bigint;
  /** `maxPriorityFeePerGas << 128 | maxFeePerGas`, packed as a 32-byte hex word. */
  gasFees: `0x${string}`;
  /**
   * Paymaster address (20 bytes) + packed verification/postOp gas limits
   * (16 + 16 bytes) + paymaster-specific data, or `0x` if self-sponsored.
   */
  paymasterAndData: `0x${string}`;
  /** Owner signature — opaque to the EntryPoint; validated inside the account. */
  signature: `0x${string}`;
}

/**
 * Developer-facing, unpacked UserOperation shape.
 *
 * This is the form the wallet builds, estimates, mutates, and
 * exchanges with bundlers. It matches the JSON payload that
 * `eth_sendUserOperation` and `eth_estimateUserOperationGas` accept
 * once `bigint` values are serialised as `0x`-prefixed hex.
 *
 * `factory`/`factoryData` are only present on the first UserOperation
 * for a counterfactual account — subsequent UserOps omit them.
 * `paymaster*` fields are only present when a paymaster is sponsoring
 * the operation.
 *
 * @example
 * ```ts
 * const op: UserOperation = builder
 *   .setCallData(encodeSimpleAccountExecute(to, 0n, "0x"))
 *   .setGas({ ...estimate })
 *   .build();
 * ```
 */
export interface UserOperation {
  /** Smart account sending the UserOperation. */
  sender: `0x${string}`;
  /** Anti-replay nonce — upper 192 bits are the "key", lower 64 are the sequence. */
  nonce: bigint;
  /** Factory address, set on first-deploy UserOps only. */
  factory?: `0x${string}`;
  /** Encoded factory call (typically `createAccount(owner, salt)`). */
  factoryData?: `0x${string}`;
  /** Calldata the account will execute (usually an encoded `execute` call). */
  callData: `0x${string}`;
  /** Gas the account's inner `execute` is allowed to burn. */
  callGasLimit: bigint;
  /** Gas the account's `validateUserOp` is allowed to burn. */
  verificationGasLimit: bigint;
  /** Fixed overhead reimbursed to the bundler for calldata + signature checks. */
  preVerificationGas: bigint;
  /** EIP-1559 max fee (wei per gas) the sender is willing to pay. */
  maxFeePerGas: bigint;
  /** EIP-1559 priority fee (wei per gas) paid to the bundler. */
  maxPriorityFeePerGas: bigint;
  /** Paymaster contract covering gas, if any. */
  paymaster?: `0x${string}`;
  /** Gas budget for the paymaster's `validatePaymasterUserOp`. */
  paymasterVerificationGasLimit?: bigint;
  /** Gas budget for the paymaster's `postOp`. */
  paymasterPostOpGasLimit?: bigint;
  /** Paymaster-specific opaque payload (typically an off-chain signature). */
  paymasterData?: `0x${string}`;
  /** Owner signature validated by the account's `validateUserOp`. */
  signature: `0x${string}`;
}

/**
 * Shape returned by the bundler's `eth_getUserOperationReceipt`.
 *
 * `logs` and `receipt` are deliberately `unknown` — the bundler spec
 * delegates these to the underlying `eth_getTransactionReceipt` RPC,
 * so they carry whatever shape the host chain returns. The wallet
 * should narrow them with a parser before using them.
 */
export interface UserOperationReceipt {
  /** Hash the bundler handed back from `eth_sendUserOperation`. */
  userOpHash: `0x${string}`;
  /** EntryPoint address that included the UserOperation. */
  entryPoint: `0x${string}`;
  /** Smart account that sent the UserOperation. */
  sender: `0x${string}`;
  /** Nonce used by the UserOperation. */
  nonce: bigint;
  /** Paymaster that sponsored the op, if any. */
  paymaster?: `0x${string}`;
  /** Actual gas cost in wei (post-execution). */
  actualGasCost: bigint;
  /** Actual gas units consumed (post-execution). */
  actualGasUsed: bigint;
  /** `true` if the inner call did not revert. */
  success: boolean;
  /** Revert reason when `success` is false, if the bundler surfaced one. */
  reason?: string;
  /** Event logs emitted during the UserOperation. */
  logs: Array<unknown>;
  /** Underlying transaction receipt (pass-through from `eth_getTransactionReceipt`). */
  receipt: unknown;
}

/**
 * Shape of the `error` member in a JSON-RPC response from a bundler.
 *
 * Bundlers reuse the standard JSON-RPC error envelope
 * (`{ code, message, data }`) and overload the `code` with 4337
 * validation errors (e.g. `-32500` "rejected by EntryPoint").
 * `BundlerError` (see `bundler-client.ts`) wraps this shape into a
 * typed exception.
 */
export interface BundlerRpcError {
  /** JSON-RPC error code (standard + ERC-4337 validation codes). */
  code: number;
  /** Human-readable summary of the failure. */
  message: string;
  /** Optional bundler-specific diagnostic payload. */
  data?: unknown;
}
