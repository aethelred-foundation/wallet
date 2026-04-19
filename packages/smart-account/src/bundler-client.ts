/**
 * JSON-RPC client for an ERC-4337 v0.7 bundler.
 *
 * Bundlers expose a small superset of the standard Ethereum JSON-RPC
 * surface (`eth_sendUserOperation`, `eth_estimateUserOperationGas`,
 * `eth_getUserOperationReceipt`, `eth_getUserOperationByHash`,
 * `eth_supportedEntryPoints`). This client wraps those calls,
 * converting between the wallet's `bigint`-typed {@link UserOperation}
 * shape and the `0x`-prefixed-hex wire format bundlers expect.
 *
 * Design choices:
 *
 *  - **No runtime deps.** Uses `fetch` directly — the extension runs
 *    in a service worker and UI, both of which have a global `fetch`.
 *  - **bigint-safe serialisation.** `bigint` fields are serialised
 *    exactly once, in one place (`serializeUserOperation`), so the
 *    packer and the RPC client cannot drift apart.
 *  - **Typed errors.** Bundler errors surface as {@link BundlerError}
 *    so consumers can discriminate on `instanceof` and introspect
 *    the JSON-RPC error code (e.g. `-32500` = rejected by EntryPoint).
 *  - **Configurable timeout.** `AbortController` enforces the timeout
 *    on the underlying fetch so a stalled bundler can't block the
 *    caller indefinitely.
 */

import { BundlerError } from "./errors";
import type {
  BundlerRpcError,
  UserOperation,
  UserOperationReceipt,
} from "./types";

/* ────────────────────────────────────────────────────────────── *
 * Config and types
 * ────────────────────────────────────────────────────────────── */

/** Minimum config required to construct a {@link BundlerClient}. */
export interface BundlerClientConfig {
  /** HTTP(S) endpoint of the bundler (e.g. Alchemy / Pimlico / Stackup). */
  url: string;
  /** Chain id the bundler is configured for — sanity-checked in dev. */
  chainId: number;
  /** Request timeout in milliseconds. Defaults to 30_000ms. */
  timeout?: number;
  /** Optional custom `fetch` implementation — handy for tests. */
  fetchImpl?: typeof fetch;
  /** Optional headers to add to every request (e.g. auth). */
  headers?: Record<string, string>;
}

/** Shape returned by `eth_estimateUserOperationGas`. */
export interface UserOperationGasEstimate {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  /** Some bundlers also return paymaster-specific gas budgets. */
  paymasterVerificationGasLimit?: bigint;
  paymasterPostOpGasLimit?: bigint;
}

/** Shape returned by `eth_getUserOperationByHash`. */
export interface UserOperationLookup {
  userOperation: UserOperation;
  entryPoint: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
}

/* ────────────────────────────────────────────────────────────── *
 * JSON-RPC envelope types
 * ────────────────────────────────────────────────────────────── */

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown[];
}

interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: number;
  result: T;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number;
  error: BundlerRpcError;
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

function isJsonRpcFailure<T>(r: JsonRpcResponse<T>): r is JsonRpcFailure {
  return (r as JsonRpcFailure).error !== undefined;
}

/* ────────────────────────────────────────────────────────────── *
 * Hex <-> bigint helpers (local, kept minimal)
 * ────────────────────────────────────────────────────────────── */

function bigintToHex(value: bigint): `0x${string}` {
  if (value < 0n) {
    throw new BundlerError({
      code: -32602,
      message: `cannot serialise negative bigint: ${value}`,
    });
  }
  return `0x${value.toString(16)}`;
}

function hexToBigInt(hex: string): bigint {
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) {
    throw new BundlerError({
      code: -32603,
      message: `bundler returned invalid hex value: ${hex}`,
    });
  }
  return hex === "0x" ? 0n : BigInt(hex);
}

/**
 * Serialise a {@link UserOperation} into the JSON shape bundlers expect.
 *
 * Every `bigint` becomes a `0x`-prefixed lowercase hex string. Optional
 * fields are omitted (never serialised as `null` — some bundlers reject
 * that).
 */
export function serializeUserOperation(
  op: Partial<UserOperation>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (op.sender !== undefined) out.sender = op.sender;
  if (op.nonce !== undefined) out.nonce = bigintToHex(op.nonce);
  if (op.factory !== undefined) out.factory = op.factory;
  if (op.factoryData !== undefined) out.factoryData = op.factoryData;
  if (op.callData !== undefined) out.callData = op.callData;
  if (op.callGasLimit !== undefined) {
    out.callGasLimit = bigintToHex(op.callGasLimit);
  }
  if (op.verificationGasLimit !== undefined) {
    out.verificationGasLimit = bigintToHex(op.verificationGasLimit);
  }
  if (op.preVerificationGas !== undefined) {
    out.preVerificationGas = bigintToHex(op.preVerificationGas);
  }
  if (op.maxFeePerGas !== undefined) {
    out.maxFeePerGas = bigintToHex(op.maxFeePerGas);
  }
  if (op.maxPriorityFeePerGas !== undefined) {
    out.maxPriorityFeePerGas = bigintToHex(op.maxPriorityFeePerGas);
  }
  if (op.paymaster !== undefined) out.paymaster = op.paymaster;
  if (op.paymasterVerificationGasLimit !== undefined) {
    out.paymasterVerificationGasLimit = bigintToHex(
      op.paymasterVerificationGasLimit,
    );
  }
  if (op.paymasterPostOpGasLimit !== undefined) {
    out.paymasterPostOpGasLimit = bigintToHex(op.paymasterPostOpGasLimit);
  }
  if (op.paymasterData !== undefined) out.paymasterData = op.paymasterData;
  if (op.signature !== undefined) out.signature = op.signature;
  return out;
}

/**
 * Deserialise a JSON UserOperation (all fields hex) back into the
 * wallet's `bigint`-typed {@link UserOperation}.
 */
function deserializeUserOperation(raw: Record<string, unknown>): UserOperation {
  const op: UserOperation = {
    sender: raw.sender as `0x${string}`,
    nonce: hexToBigInt(raw.nonce as string),
    callData: raw.callData as `0x${string}`,
    callGasLimit: hexToBigInt(raw.callGasLimit as string),
    verificationGasLimit: hexToBigInt(raw.verificationGasLimit as string),
    preVerificationGas: hexToBigInt(raw.preVerificationGas as string),
    maxFeePerGas: hexToBigInt(raw.maxFeePerGas as string),
    maxPriorityFeePerGas: hexToBigInt(raw.maxPriorityFeePerGas as string),
    signature: raw.signature as `0x${string}`,
  };
  if (raw.factory) op.factory = raw.factory as `0x${string}`;
  if (raw.factoryData) op.factoryData = raw.factoryData as `0x${string}`;
  if (raw.paymaster) op.paymaster = raw.paymaster as `0x${string}`;
  if (raw.paymasterVerificationGasLimit) {
    op.paymasterVerificationGasLimit = hexToBigInt(
      raw.paymasterVerificationGasLimit as string,
    );
  }
  if (raw.paymasterPostOpGasLimit) {
    op.paymasterPostOpGasLimit = hexToBigInt(
      raw.paymasterPostOpGasLimit as string,
    );
  }
  if (raw.paymasterData) op.paymasterData = raw.paymasterData as `0x${string}`;
  return op;
}

/* ────────────────────────────────────────────────────────────── *
 * Client
 * ────────────────────────────────────────────────────────────── */

/**
 * HTTP JSON-RPC client for an ERC-4337 bundler.
 *
 * Each method maps 1:1 to a bundler RPC. Responses are parsed into
 * the wallet's strongly-typed shapes; JSON-RPC error envelopes raise
 * {@link BundlerError}.
 *
 * @example
 * ```ts
 * const client = new BundlerClient({
 *   url: "https://api.pimlico.io/v2/1/rpc",
 *   chainId: 1,
 * });
 * const hash = await client.sendUserOperation(op, ENTRYPOINT_V07_ADDRESS);
 * const receipt = await client.getUserOperationReceipt(hash);
 * ```
 */
export class BundlerClient {
  private readonly url: string;
  private readonly chainId: number;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  private nextRequestId = 1;

  constructor(config: BundlerClientConfig) {
    this.url = config.url;
    this.chainId = config.chainId;
    this.timeout = config.timeout ?? 30_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.headers = { ...(config.headers ?? {}) };
  }

  /** Chain id this client was constructed for. */
  getChainId(): number {
    return this.chainId;
  }

  /**
   * Submit a fully-signed UserOperation to the bundler.
   *
   * @returns The `userOpHash` the bundler accepted.
   */
  async sendUserOperation(
    op: UserOperation,
    entryPoint: `0x${string}`,
  ): Promise<`0x${string}`> {
    const result = await this.rpcCall<`0x${string}`>("eth_sendUserOperation", [
      serializeUserOperation(op),
      entryPoint,
    ]);
    return result;
  }

  /**
   * Ask the bundler to estimate the gas fields for a UserOperation.
   *
   * The op passed in typically omits `callGasLimit` /
   * `verificationGasLimit` / `preVerificationGas` (those are what we're
   * estimating) but must carry `sender`, `nonce`, `callData`, and a
   * placeholder `signature` so the EntryPoint can run the full
   * validation trace.
   */
  async estimateUserOperationGas(
    op: Partial<UserOperation>,
    entryPoint: `0x${string}`,
  ): Promise<UserOperationGasEstimate> {
    const result = await this.rpcCall<Record<string, string>>(
      "eth_estimateUserOperationGas",
      [serializeUserOperation(op), entryPoint],
    );
    const estimate: UserOperationGasEstimate = {
      callGasLimit: hexToBigInt(result.callGasLimit),
      verificationGasLimit: hexToBigInt(result.verificationGasLimit),
      preVerificationGas: hexToBigInt(result.preVerificationGas),
    };
    if (result.paymasterVerificationGasLimit) {
      estimate.paymasterVerificationGasLimit = hexToBigInt(
        result.paymasterVerificationGasLimit,
      );
    }
    if (result.paymasterPostOpGasLimit) {
      estimate.paymasterPostOpGasLimit = hexToBigInt(
        result.paymasterPostOpGasLimit,
      );
    }
    return estimate;
  }

  /**
   * Fetch the receipt for a previously-submitted UserOperation.
   *
   * Returns `null` if the bundler has not yet included the op or has
   * dropped it (matching the JSON-RPC spec).
   */
  async getUserOperationReceipt(
    userOpHash: `0x${string}`,
  ): Promise<UserOperationReceipt | null> {
    const raw = await this.rpcCall<Record<string, unknown> | null>(
      "eth_getUserOperationReceipt",
      [userOpHash],
    );
    if (raw === null || raw === undefined) return null;
    return {
      userOpHash: raw.userOpHash as `0x${string}`,
      entryPoint: raw.entryPoint as `0x${string}`,
      sender: raw.sender as `0x${string}`,
      nonce: hexToBigInt(raw.nonce as string),
      ...(raw.paymaster
        ? { paymaster: raw.paymaster as `0x${string}` }
        : {}),
      actualGasCost: hexToBigInt(raw.actualGasCost as string),
      actualGasUsed: hexToBigInt(raw.actualGasUsed as string),
      success: Boolean(raw.success),
      ...(typeof raw.reason === "string" ? { reason: raw.reason } : {}),
      logs: Array.isArray(raw.logs) ? (raw.logs as unknown[]) : [],
      receipt: raw.receipt,
    };
  }

  /**
   * Look up a UserOperation by its hash. Returns `null` if not known.
   */
  async getUserOperationByHash(
    userOpHash: `0x${string}`,
  ): Promise<UserOperationLookup | null> {
    const raw = await this.rpcCall<Record<string, unknown> | null>(
      "eth_getUserOperationByHash",
      [userOpHash],
    );
    if (raw === null || raw === undefined) return null;
    const rawOp = raw.userOperation as Record<string, unknown>;
    return {
      userOperation: deserializeUserOperation(rawOp),
      entryPoint: raw.entryPoint as `0x${string}`,
      blockNumber: hexToBigInt(raw.blockNumber as string),
      blockHash: raw.blockHash as `0x${string}`,
      transactionHash: raw.transactionHash as `0x${string}`,
    };
  }

  /** Enumerate the EntryPoint addresses this bundler supports. */
  async supportedEntryPoints(): Promise<`0x${string}`[]> {
    const result = await this.rpcCall<string[]>(
      "eth_supportedEntryPoints",
      [],
    );
    return result.map((a) => a as `0x${string}`);
  }

  /* ────────────────────────────────────────────────────────── *
   * Internal
   * ────────────────────────────────────────────────────────── */

  /** Build + send a JSON-RPC request, parse the envelope. */
  private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.nextRequestId++,
      method,
      params,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as { name?: string })?.name === "AbortError") {
        throw new BundlerError({
          code: -32603,
          message: `bundler request timed out after ${this.timeout}ms`,
        });
      }
      throw new BundlerError({
        code: -32603,
        message: `bundler fetch failed: ${(err as Error).message}`,
      });
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw new BundlerError({
        code: -32603,
        message: `bundler returned HTTP ${response.status}`,
      });
    }

    const json = (await response.json()) as JsonRpcResponse<T>;
    if (isJsonRpcFailure(json)) {
      throw new BundlerError(json.error);
    }
    return json.result;
  }
}
