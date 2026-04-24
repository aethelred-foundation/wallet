/**
 * `@aethelred/wallet-x402-solver` — concrete intent-router solver
 * backed by the x402 facilitator protocol.
 *
 * First production-shape solver implementation. Consumers instantiate
 * `X402FacilitatorSolver` with a custody signer and register it in
 * their `InMemorySolverRegistry`:
 *
 * ```ts
 * import { InMemorySolverRegistry, IntentRouter } from "@aethelred/wallet-intent-router";
 * import { X402FacilitatorSolver } from "@aethelred/wallet-x402-solver";
 *
 * const solver = new X402FacilitatorSolver({
 *   id: "x402-facilitator-base-mainnet",
 *   name: "Aethelred x402 facilitator",
 *   signer: custodyAdapter.asTypedDataSigner(),
 * });
 * const registry = new InMemorySolverRegistry([solver]);
 * const router = new IntentRouter({ registry });
 * ```
 *
 * @packageDocumentation
 */

export { X402FacilitatorSolver } from "./solver";
export { X402SolverError } from "./errors";

export type { X402SolverErrorCode } from "./errors";
export type {
  X402FacilitatorSolverConfig,
  X402SolverQuoteMetadata,
  X402SolverFillMetadata,
  Intent,
  PaymentIntentBody,
  Quote,
  Fill,
  Solver,
  PaymentNetwork,
  PaymentReceipt,
  TypedDataSigner,
} from "./types";
