/**
 * Public entry point for `@aethelred/wallet-smart-account`.
 *
 * ERC-4337 v0.7 smart account primitives — types, builder, bundler
 * client, SimpleAccount helpers, paymaster interface. See individual
 * modules for the per-symbol JSDoc.
 */

export type {
  BundlerRpcError,
  PackedUserOperation,
  UserOperation,
  UserOperationReceipt,
} from "./types";

export {
  BundlerError,
  SimpleAccountError,
  UserOperationError,
} from "./errors";

export {
  ENTRYPOINT_V06_ADDRESS,
  ENTRYPOINT_V07_ADDRESS,
  getDefaultEntryPoint,
  getEntryPointForChain,
  isEntryPointVerifiedChain,
  type EntryPointConfig,
  type EntryPointVersion,
} from "./entrypoint";

export {
  UserOperationBuilder,
  computeUserOpHash,
  packUserOperation,
  type UserOperationBuilderConfig,
  type UserOperationGasParams,
  type UserOperationPaymasterParams,
} from "./user-operation";

export {
  CREATE_ACCOUNT_SELECTOR,
  EXECUTE_BATCH_SELECTOR,
  EXECUTE_SELECTOR,
  SIMPLE_ACCOUNT_FACTORY_ADDRESS,
  SIMPLE_ACCOUNT_PROXY_INIT_CODE_HASH,
  computeSimpleAccountAddress,
  encodeSimpleAccountExecute,
  encodeSimpleAccountExecuteBatch,
  encodeSimpleAccountFactoryData,
  type SimpleAccountBatchCall,
  type SimpleAccountDeployment,
} from "./simple-account";

export {
  BundlerClient,
  serializeUserOperation,
  type BundlerClientConfig,
  type UserOperationGasEstimate,
  type UserOperationLookup,
} from "./bundler-client";

export {
  VerifyingPaymasterClient,
  type Paymaster,
  type PaymasterSponsorship,
  type VerifyingPaymasterClientConfig,
} from "./paymaster";
