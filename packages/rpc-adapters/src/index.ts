/**
 * `@aethelred/wallet-rpc-adapters` — JSON-RPC-backed implementations
 * of the chain-provider interfaces consumed by `agent-budget` and
 * `notarization`.
 *
 * Zero external dependencies: minimal `fetch`-based transport + two
 * thin adapter classes. Production consumers can still swap viem /
 * ethers behind the same interfaces without touching upstream
 * packages.
 *
 * @packageDocumentation
 */

export {
  FetchJsonRpcTransport,
  JsonRpcError,
} from "./json-rpc";
export type {
  JsonRpcTransport,
  FetchJsonRpcTransportConfig,
  JsonRpcErrorCode,
} from "./json-rpc";

export { RpcAnchorChainProvider } from "./anchor-provider";
export type { RpcAnchorChainProviderConfig } from "./anchor-provider";

export { RpcBudgetChainProvider } from "./budget-provider";
export type { RpcBudgetChainProviderConfig } from "./budget-provider";

export {
  DETERMINISTIC_ADDRESSES,
  DEPLOYMENT_SALT,
  CREATE2_DEPLOYER,
} from "./deployments";
