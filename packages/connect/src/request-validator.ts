import type { EIP1193RequestArguments } from "./contracts";

export interface RequestValidationResult {
  valid: boolean;
  errors: string[];
  /**
   * A detached, canonical copy of params after method-specific validation.
   * Callers must dispatch this value rather than the original untrusted
   * object so review, policy, signing, and broadcast consume one tuple.
   */
  normalizedParams?: readonly unknown[] | object;
}

const TRANSACTION_OBJECT_METHODS = new Set([
  "eth_sendTransaction",
  "eth_estimateGas",
  "eth_call",
]);

/** EIP-1474 quantity fields accepted on an Ethereum transaction object. */
export const TRANSACTION_QUANTITY_FIELDS = [
  "value",
  "gas",
  "gasLimit",
  "gasPrice",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "nonce",
  "chainId",
  "type",
] as const;

export type TransactionQuantityField =
  (typeof TRANSACTION_QUANTITY_FIELDS)[number];

export type CanonicalTransactionRequest = Record<string, unknown> &
  Partial<Record<TransactionQuantityField, string>>;

export type TransactionRequestNormalizationResult =
  | { valid: true; transaction: CanonicalTransactionRequest }
  | { valid: false; errors: string[] };

/**
 * Validate and detach an EIP-1193 transaction object.
 *
 * JSON-RPC quantities are not arbitrary numeric strings. They must be
 * `0x`-prefixed hexadecimal with no redundant leading zeroes. Accepting a
 * decimal-looking string is especially dangerous because JavaScript BigInt
 * treats it as decimal while the transaction encoder historically treated it
 * as hexadecimal. Upper-case hex digits are valid input and are normalized to
 * lower case so every downstream consumer sees an identical value.
 */
export function normalizeTransactionRequest(
  value: unknown,
): TransactionRequestNormalizationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      valid: false,
      errors: ["Transaction parameter must be an object"],
    };
  }

  const transaction = { ...(value as Record<string, unknown>) } as CanonicalTransactionRequest;
  const errors: string[] = [];
  for (const field of TRANSACTION_QUANTITY_FIELDS) {
    const quantity = transaction[field];
    if (quantity === undefined) continue;
    if (
      typeof quantity !== "string" ||
      !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(quantity)
    ) {
      errors.push(
        `Transaction ${field} must be a canonical 0x-prefixed hex quantity`,
      );
      continue;
    }
    transaction[field] = quantity.toLowerCase();
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, transaction };
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
  // Event log queries. The background dispatcher at background.ts already
  // forwards eth_getLogs to rpcClient.call, but the method was previously
  // missing from this whitelist so every call was rejected with -32601
  // before dispatch. The integration harness caught this contract gap.
  "eth_getLogs",
  "eth_newFilter",
  "eth_newBlockFilter",
  "eth_newPendingTransactionFilter",
  "eth_getFilterChanges",
  "eth_getFilterLogs",
  "eth_uninstallFilter",

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
  let normalizedParams = args.params;

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

  if (TRANSACTION_OBJECT_METHODS.has(args.method)) {
    if (!Array.isArray(args.params) || args.params.length === 0) {
      errors.push(`${args.method} requires a transaction object parameter`);
    } else {
      const normalized = normalizeTransactionRequest(args.params[0]);
      if (!normalized.valid) {
        errors.push(...normalized.errors);
      } else {
        normalizedParams = [normalized.transaction, ...args.params.slice(1)];
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedParams,
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
