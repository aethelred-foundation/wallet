/**
 * `RpcAnchorChainProvider` — implements the notarization package's
 * `AnchorChainProvider` interface against a real JSON-RPC endpoint.
 *
 * Wraps three RPC calls:
 *
 *   - `eth_sendRawTransaction` for submitting the anchor tx.
 *   - `eth_getTransactionReceipt` for confirmation polling.
 *   - Translation of the raw receipt into the `TxReceipt` shape the
 *     notarization package expects (logs normalised, topics already
 *     `0x…` hex, blockNumber / logIndex as bigint / number).
 *
 * Signing + nonce management are EXPLICITLY OUT OF SCOPE. Callers
 * pre-sign the transaction (via a CustodyAdapter / external signer)
 * and pass the raw tx bytes via `sendRawTransaction`. That keeps
 * this adapter independent of how the caller manages keys.
 */

import type {
  AnchorChainProvider,
  RawLog,
  TxReceipt,
} from "@aethelred/wallet-notarization";

import type { JsonRpcTransport } from "./json-rpc";

export interface RpcAnchorChainProviderConfig {
  readonly transport: JsonRpcTransport;
  readonly chainId: number;
  /**
   * Function that signs + raw-encodes a transaction for sending.
   * Called by `sendTransaction` — the provider stays unopinionated
   * about the custody backend. Real deployments wire a custody-
   * adapter signer into this function at construction.
   */
  readonly signAndEncodeTx: (request: {
    readonly to: `0x${string}`;
    readonly data: `0x${string}`;
    readonly value?: bigint;
  }) => Promise<`0x${string}`>;
}

export class RpcAnchorChainProvider implements AnchorChainProvider {
  readonly chainId: number;
  private readonly transport: JsonRpcTransport;
  private readonly signAndEncodeTx: RpcAnchorChainProviderConfig["signAndEncodeTx"];

  constructor(config: RpcAnchorChainProviderConfig) {
    this.chainId = config.chainId;
    this.transport = config.transport;
    this.signAndEncodeTx = config.signAndEncodeTx;
  }

  async sendTransaction(request: {
    readonly to: `0x${string}`;
    readonly data: `0x${string}`;
    readonly value?: bigint;
  }): Promise<`0x${string}`> {
    const rawTx = await this.signAndEncodeTx(request);
    const txHash = await this.transport.call<`0x${string}`>(
      "eth_sendRawTransaction",
      [rawTx],
    );
    return txHash;
  }

  async getTransactionReceipt(txHash: `0x${string}`): Promise<TxReceipt | null> {
    const raw = await this.transport.call<RpcTxReceipt | null>(
      "eth_getTransactionReceipt",
      [txHash],
    );
    if (!raw) return null;
    return normaliseReceipt(raw);
  }
}

// ─── Wire shapes ────────────────────────────────────────

interface RpcTxReceipt {
  readonly transactionHash: `0x${string}`;
  readonly blockNumber: `0x${string}`;
  readonly status: `0x${string}`; // "0x0" or "0x1"
  readonly logs: ReadonlyArray<RpcLog>;
}

interface RpcLog {
  readonly address: `0x${string}`;
  readonly topics: ReadonlyArray<`0x${string}`>;
  readonly data: `0x${string}`;
  readonly blockNumber: `0x${string}`;
  readonly transactionHash: `0x${string}`;
  readonly logIndex: `0x${string}`;
}

function normaliseReceipt(raw: RpcTxReceipt): TxReceipt {
  return {
    transactionHash: raw.transactionHash,
    blockNumber: BigInt(raw.blockNumber),
    status: raw.status === "0x1" ? "success" : "reverted",
    logs: raw.logs.map(normaliseLog),
  };
}

function normaliseLog(raw: RpcLog): RawLog {
  return {
    address: raw.address,
    topics: raw.topics,
    data: raw.data,
    blockNumber: BigInt(raw.blockNumber),
    transactionHash: raw.transactionHash,
    logIndex: parseInt(raw.logIndex, 16),
  };
}
