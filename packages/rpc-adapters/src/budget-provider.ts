/**
 * `RpcBudgetChainProvider` — implements the agent-budget package's
 * `ChainProvider` interface against a real JSON-RPC endpoint.
 *
 * Two RPC methods wrapped:
 *
 *   - `eth_call` for view functions (canSpend, remainingInWindow).
 *   - `eth_getLogs` for historical event scans.
 *
 * No signing here — the budget client's `prepare*` calldata builders
 * return `{ to, data }` pairs; the caller wires them through their
 * own signer / bundler / wallet-core. This adapter is pure read +
 * log-scan.
 */

import type { ChainProvider, RawLog } from "@aethelred/wallet-agent-budget";

import type { JsonRpcTransport } from "./json-rpc";

export interface RpcBudgetChainProviderConfig {
  readonly transport: JsonRpcTransport;
  readonly chainId: number;
}

export class RpcBudgetChainProvider implements ChainProvider {
  readonly chainId: number;
  private readonly transport: JsonRpcTransport;

  constructor(config: RpcBudgetChainProviderConfig) {
    this.chainId = config.chainId;
    this.transport = config.transport;
  }

  async call(request: {
    readonly to: `0x${string}`;
    readonly data: `0x${string}`;
  }): Promise<`0x${string}`> {
    return this.transport.call<`0x${string}`>("eth_call", [
      { to: request.to, data: request.data },
      "latest",
    ]);
  }

  async getLogs(filter: {
    readonly address: `0x${string}`;
    readonly topics: ReadonlyArray<`0x${string}` | null>;
    readonly fromBlock?: bigint | "earliest" | "latest";
    readonly toBlock?: bigint | "earliest" | "latest";
  }): Promise<ReadonlyArray<RawLog>> {
    const raw = await this.transport.call<ReadonlyArray<WireLog>>("eth_getLogs", [
      {
        address: filter.address,
        topics: filter.topics,
        fromBlock: serialiseBlockTag(filter.fromBlock ?? "earliest"),
        toBlock: serialiseBlockTag(filter.toBlock ?? "latest"),
      },
    ]);
    return raw.map(normaliseLog);
  }
}

interface WireLog {
  readonly topics: ReadonlyArray<`0x${string}`>;
  readonly data: `0x${string}`;
  readonly blockNumber: `0x${string}`;
  readonly transactionHash: `0x${string}`;
  readonly logIndex: `0x${string}`;
}

function normaliseLog(raw: WireLog): RawLog {
  return {
    topics: raw.topics,
    data: raw.data,
    blockNumber: BigInt(raw.blockNumber),
    transactionHash: raw.transactionHash,
    logIndex: parseInt(raw.logIndex, 16),
  };
}

function serialiseBlockTag(tag: bigint | "earliest" | "latest"): string {
  if (tag === "earliest" || tag === "latest") return tag;
  return "0x" + tag.toString(16);
}
