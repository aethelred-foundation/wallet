/**
 * `@aethelred/wallet-transfer-solver` — type surface.
 *
 * Three logical groups:
 *
 *   1. `TransferChainProvider` — the minimal 2-method chain API the
 *      solver needs. We re-export `@aethelred/wallet-notarization`'s
 *      `AnchorChainProvider` shape under a semantically-named alias
 *      so consumers see "transfer chain" in their types, not
 *      "anchor chain." Implementations from rpc-adapters
 *      (RpcAnchorChainProvider) drop in unchanged.
 *
 *   2. Config consumed at `TransferSolver` construction.
 *
 *   3. Quote + Fill metadata. Fill metadata embeds the full chain
 *      receipt so consumers get txHash / blockNumber / logs for
 *      reconciliation without a second RPC call.
 */

import type {
  AnchorChainProvider,
  TxReceipt,
} from "@aethelred/wallet-notarization";

import type {
  Fill,
  Intent,
  Quote,
  Solver,
  TransferIntentBody,
} from "@aethelred/wallet-intent-router";

// ─── Chain provider ────────────────────────────────────────

/**
 * Minimal chain provider the transfer solver needs.
 *
 * Semantically this is "any EVM chain client that can submit a
 * pre-signed tx and poll receipts." Mirrors the
 * `@aethelred/wallet-notarization` `AnchorChainProvider` shape —
 * we re-export the same interface under this name so every chain
 * consumer in the codebase reads as its own domain ("TransferChain"
 * reads cleanly in this package; "AnchorChain" reads cleanly in
 * notarization; both are the same interface under the hood).
 *
 * Implementations from `@aethelred/wallet-rpc-adapters`
 * (`RpcAnchorChainProvider`) satisfy this type out-of-the-box.
 */
export type TransferChainProvider = AnchorChainProvider;

/** Same as above but for reading transaction receipts. */
export type TransferTxReceipt = TxReceipt;

// ─── Config ────────────────────────────────────────────────

export interface TransferSolverConfig {
  /**
   * Stable solver id — surfaces in every Quote + Fill + audit
   * event. Recommended form: `transfer:<chain>` e.g.
   * `transfer:base-mainnet`.
   */
  readonly id: string;

  /** Human-readable label. */
  readonly name: string;

  /**
   * The address the transfer is submitted FROM. Must equal the
   * intent's `creator` — the router already validates the intent's
   * EIP-712 signature matches this address.
   *
   * The transfer solver doesn't sign itself; it assembles calldata
   * and submits via the chain provider, which has its own signing
   * mechanism (typically a custody adapter wired into
   * `signAndEncodeTx` inside the provider implementation).
   */
  readonly from: `0x${string}`;

  /**
   * Chain provider. Implementations: `RpcAnchorChainProvider` from
   * `@aethelred/wallet-rpc-adapters`, viem-backed custom, or any
   * class satisfying the `{ chainId, sendTransaction,
   * getTransactionReceipt }` shape.
   */
  readonly provider: TransferChainProvider;

  /**
   * Optional allow-list of assets (ERC-20 contract addresses
   * + the native sentinel `0x0…0`). When present, transfers of
   * assets outside this list are declined at quote time.
   *
   * Operator-side safety rail: narrows the solver to only known-
   * safe tokens. Absent = accept any valid asset.
   */
  readonly allowedAssets?: ReadonlyArray<`0x${string}`>;

  /**
   * Polling interval for receipt fetch, ms. Default: 2_000.
   */
  readonly pollIntervalMs?: number;

  /**
   * Max wall-clock wait for confirmation, ms. Default: 120_000.
   */
  readonly pollTimeoutMs?: number;

  /**
   * Quote validity in ms. Default: 60_000.
   */
  readonly quoteValidityMs?: number;

  /**
   * Estimated fill time declared on each quote (router's
   * `fastestFill` comparator uses this). Default: 15_000 —
   * conservative upper bound for a single-confirmation L2 tx.
   */
  readonly estimatedFillTimeMs?: number;

  /** Clock override for deterministic testing. */
  readonly now?: () => number;

  /**
   * `sleep` override for testing (default: `setTimeout`-backed).
   * Receipt polling uses this between `getTransactionReceipt` calls.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

// ─── Quote + Fill metadata ─────────────────────────────────

/**
 * `Quote.metadata` for transfer-solver quotes. Audit-only — the
 * router doesn't inspect it. Index signature extends the shape to
 * match the router's `Readonly<Record<string, unknown>>` contract.
 */
export interface TransferSolverQuoteMetadata {
  readonly solverClass: "transfer";
  readonly chainId: number;
  readonly asset: `0x${string}`;
  readonly recipient: `0x${string}`;
  readonly isNative: boolean;
  readonly [key: string]: unknown;
}

/**
 * `Fill.metadata` for transfer-solver fills. Carries the full
 * `TxReceipt` so consumers have `blockNumber` / `logs` /
 * `transactionHash` for reconciliation without a second RPC call.
 */
export interface TransferSolverFillMetadata {
  readonly solverClass: "transfer";
  readonly chainId: number;
  readonly receipt: TransferTxReceipt;
  /**
   * Gas consumed by the transfer, lifted from `receipt.gasUsed` for
   * discoverability. Absent when the provider's receipt didn't
   * include a `gasUsed` field (in-memory test doubles, older
   * providers). Observability pipelines sum this across fills to
   * produce a per-solver histogram.
   */
  readonly gasUsed?: bigint;
  /**
   * Total gas cost in wei = `gasUsed * effectiveGasPrice`. Absent
   * when either field is missing on the receipt.
   */
  readonly gasCostWei?: bigint;
  readonly [key: string]: unknown;
}

// ─── Re-exports ────────────────────────────────────────────

export type { Fill, Intent, Quote, Solver, TransferIntentBody };
