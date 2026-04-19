import type { EIP1193RequestArguments } from "./contracts";

export interface RequestValidationResult {
  valid: boolean;
  errors: string[];
}

const KNOWN_METHODS = new Set([
  // Account / network
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "net_version",

  // Read-only chain queries
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_maxPriorityFeePerGas",
  "eth_call",

  // Signing / sending
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "eth_signTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTypedData_v4",

  // Wallet lifecycle (EIP-1193 / 2255 / 3085 / 747 / 5792)
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_watchAsset",
  "wallet_getCapabilities",
  "wallet_getPermissions",
  "wallet_requestPermissions",
  "wallet_revokePermissions",

  // Subscriptions (polling shim)
  "eth_subscribe",
  "eth_unsubscribe",

  // Aethelred extensions
  "aethelred_getState",
  "aethelred_requestIntent",
]);

/**
 * Validates incoming EIP-1193 RPC requests.
 * Returns validation errors for malformed or unsupported requests.
 */
export function validateRequest(args: EIP1193RequestArguments): RequestValidationResult {
  const errors: string[] = [];

  if (!args.method || typeof args.method !== "string") {
    errors.push("Method is required and must be a string");
  }

  if (args.method && !KNOWN_METHODS.has(args.method)) {
    errors.push(`Unknown method: ${args.method}`);
  }

  if (args.params !== undefined) {
    if (!Array.isArray(args.params) && typeof args.params !== "object") {
      errors.push("Params must be an array or object");
    }
  }

  if (args.method === "aethelred_requestIntent") {
    if (!args.params || (!Array.isArray(args.params) || args.params.length === 0)) {
      errors.push("aethelred_requestIntent requires a payload parameter");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isReadOnlyMethod(method: string): boolean {
  const readOnly = new Set([
    "eth_accounts",
    "eth_chainId",
    "eth_blockNumber",
    "eth_getBalance",
    "net_version",
    "wallet_getCapabilities",
    "wallet_getPermissions",
    "aethelred_getState",
  ]);
  return readOnly.has(method);
}
