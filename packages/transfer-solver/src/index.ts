/**
 * `@aethelred/wallet-transfer-solver` — concrete intent-router solver
 * for `TransferIntent` backed by a pluggable chain provider.
 *
 * Second production-shape solver after `@aethelred/wallet-x402-solver`.
 * Demonstrates that the `Solver` contract composes across intent
 * kinds: x402-solver serves PaymentIntent via an HTTP facilitator;
 * transfer-solver serves TransferIntent via a raw chain tx.
 *
 * Typical wiring:
 *
 * ```ts
 * import { InMemorySolverRegistry, IntentRouter } from "@aethelred/wallet-intent-router";
 * import { TransferSolver } from "@aethelred/wallet-transfer-solver";
 * import { RpcAnchorChainProvider } from "@aethelred/wallet-rpc-adapters";
 *
 * const provider = new RpcAnchorChainProvider({ chainId: 8453, rpc, signAndEncodeTx });
 * const solver = new TransferSolver({
 *   id: "transfer:base-mainnet",
 *   name: "Aethelred transfer solver (Base)",
 *   from: "0xAgentControlAddress",
 *   provider,
 *   allowedAssets: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"], // USDC
 * });
 * const registry = new InMemorySolverRegistry([solver]);
 * const router = new IntentRouter({ registry });
 * ```
 *
 * Native-asset transfers (ETH, native gas token on any EVM chain) are
 * served by using the sentinel asset `0x0000000000000000000000000000000000000000`
 * in the intent body; the solver auto-detects and submits a plain
 * value transfer instead of ERC-20 calldata.
 *
 * @packageDocumentation
 */

export { TransferSolver } from "./solver";
export { TransferSolverError } from "./errors";
export {
  encodeErc20Transfer,
  isValidAddress,
  isNativeAsset,
  ERC20_TRANSFER_SELECTOR,
  NATIVE_ASSET_SENTINEL,
} from "./calldata";

export type { TransferSolverErrorCode } from "./errors";
export type {
  TransferChainProvider,
  TransferTxReceipt,
  TransferSolverConfig,
  TransferSolverQuoteMetadata,
  TransferSolverFillMetadata,
  Fill,
  Intent,
  Quote,
  Solver,
  TransferIntentBody,
} from "./types";
