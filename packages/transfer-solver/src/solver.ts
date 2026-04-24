/**
 * `TransferSolver` — intent-router solver for `TransferIntent`.
 *
 * Second production-shape solver after `X402FacilitatorSolver`.
 * Proves the `Solver` contract is reusable across intent kinds: the
 * x402 solver moves value through an HTTP facilitator; this one
 * moves value through a raw chain tx.
 *
 * Lifecycle:
 *
 *   quote(intent) ──▶ null  (declines — wrong kind / wrong signer /
 *     │                       bad asset / over-budget / etc.)
 *     │
 *     └───▶ Quote{ commitment === intent.body.amount }
 *              │
 *              ▼
 *   settle(intent, quote) ──▶ provider.sendTransaction
 *                              │
 *                              ▼
 *                          poll getTransactionReceipt
 *                              │
 *                              ├─▶ status "success" ──▶ Fill
 *                              └─▶ status "reverted" / timeout
 *                                   / any throw  ──▶  throw TransferSolverError
 *
 * Key design calls:
 *
 *   - **Commitment = exact amount.** Transfer intents are
 *     "move exactly N" semantics; the router's `verifyFillAgainstQuote`
 *     enforces `actualAmount === commitment` for kind="transfer"
 *     (unlike payment's `≤`). So the quote commitment is literally
 *     `intent.body.amount`. No optimism, no slippage.
 *
 *   - **Declines-as-null.** The solver returns null for intents it
 *     won't serve: wrong kind, signer mismatch, asset not allow-listed,
 *     malformed recipient, zero/negative amount, chain-id mismatch,
 *     intent past deadline. This lets the router try another solver
 *     without a thrown error landing on the audit log.
 *
 *   - **Native vs ERC-20.** If `asset === 0x000…000` the solver submits
 *     a plain value transfer (empty calldata, `value: amount`). Else
 *     it encodes `transfer(recipient, amount)` calldata and submits
 *     against the token contract. Same provider, two code paths.
 *
 *   - **Chain-id enforcement.** `intent.envelope.chainId` must match
 *     `provider.chainId`. Submitting a tx built for chain A via a
 *     chain-B provider would risk replay / cross-chain confusion; we
 *     decline at quote time so the router picks a correctly-targeted
 *     solver.
 *
 *   - **Receipt polling.** Same pattern as `anchor-client` — loop
 *     `getTransactionReceipt` with the configured `pollIntervalMs`,
 *     bail at `pollTimeoutMs`. Chain-reverted receipts throw
 *     `chain-tx-reverted`; null-forever receipts throw
 *     `chain-confirmation-timeout`.
 *
 *   - **Dispose.** Mirrors every other solver — flips a flag checked
 *     at every entry point. Lets the router hot-swap solvers on config
 *     change without racing in-flight calls.
 */

import { encodeErc20Transfer, isNativeAsset, isValidAddress } from "./calldata";
import { TransferSolverError } from "./errors";
import type {
  Fill,
  Intent,
  Quote,
  Solver,
  TransferIntentBody,
  TransferSolverConfig,
  TransferSolverFillMetadata,
  TransferSolverQuoteMetadata,
  TransferTxReceipt,
} from "./types";

// ─── Defaults ──────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;
const DEFAULT_QUOTE_VALIDITY_MS = 60_000;
/**
 * 15s covers a single-confirmation L2 tx comfortably. L1 would want
 * something higher (~60s); callers override via config.
 */
const DEFAULT_FILL_TIME_MS = 15_000;

// ─── Solver ────────────────────────────────────────────────

export class TransferSolver implements Solver {
  // ── Solver contract surface ──
  readonly id: string;
  readonly name: string;
  readonly supportedIntentKinds = ["transfer"] as const;
  /**
   * In-process solver — the router's quote-signature check is waived
   * (same treatment as `X402FacilitatorSolver`). Return null to opt out.
   */
  readonly publicKeyHex = null;

  // ── Internals ──
  private readonly from: `0x${string}`;
  private readonly provider: TransferSolverConfig["provider"];
  private readonly allowedAssetsLower: ReadonlyArray<string> | null;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly quoteValidityMs: number;
  private readonly estimatedFillTimeMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private disposed = false;

  constructor(config: TransferSolverConfig) {
    if (!isValidAddress(config.from)) {
      throw new TransferSolverError(
        "signer-mismatch",
        `config.from must be 0x-prefixed 20-byte hex, got "${config.from}"`,
      );
    }

    this.id = config.id;
    this.name = config.name;
    this.from = config.from;
    this.provider = config.provider;
    // Normalise once at construction; every check compares
    // lowercased hex to avoid EIP-55 casing mismatches.
    this.allowedAssetsLower =
      config.allowedAssets?.map((a) => a.toLowerCase()) ?? null;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollTimeoutMs = config.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    this.quoteValidityMs = config.quoteValidityMs ?? DEFAULT_QUOTE_VALIDITY_MS;
    this.estimatedFillTimeMs = config.estimatedFillTimeMs ?? DEFAULT_FILL_TIME_MS;
    this.now = config.now ?? (() => Date.now());
    this.sleep =
      config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Produce a quote for the intent, or return `null` to decline.
   *
   * Declines for:
   *   - non-transfer intents
   *   - creator ≠ configured `from`
   *   - intent's chainId ≠ provider.chainId
   *   - invalid asset hex
   *   - asset outside `allowedAssets` (if set)
   *   - invalid recipient hex
   *   - non-positive amount / overflow
   *   - intent already past deadline
   *
   * Happy path returns a quote with commitment === intent.body.amount.
   */
  async quote(intent: Intent): Promise<Quote | null> {
    this.ensureAlive();

    if (intent.body.kind !== "transfer") {
      return null;
    }
    const body: TransferIntentBody = intent.body;

    if (
      intent.envelope.creator.toLowerCase() !== this.from.toLowerCase()
    ) {
      return null;
    }
    if (intent.envelope.chainId !== this.provider.chainId) {
      return null;
    }
    const nowMs = this.now();
    if (intent.envelope.deadline <= nowMs) {
      return null;
    }
    if (!isValidAddress(body.asset)) {
      return null;
    }
    if (
      this.allowedAssetsLower !== null &&
      !this.allowedAssetsLower.includes(body.asset.toLowerCase())
    ) {
      return null;
    }
    if (!isValidAddress(body.recipient)) {
      return null;
    }

    // Parse amount defensively. The router validates it's a decimal
    // string at envelope level, but we re-parse here so our quote
    // metadata reflects the actual bigint we'll submit.
    let amount: bigint;
    try {
      amount = BigInt(body.amount);
    } catch {
      return null;
    }
    if (amount <= 0n) return null;
    if (amount >> 256n !== 0n) return null; // uint256 overflow guard

    const metadata: TransferSolverQuoteMetadata = {
      solverClass: "transfer",
      chainId: this.provider.chainId,
      asset: body.asset,
      recipient: body.recipient,
      isNative: isNativeAsset(body.asset),
    };

    return {
      solverId: this.id,
      intentId: intent.envelope.id,
      // Commitment === exact transferred amount. Router enforces
      // strict equality against Fill.actualAmount.
      commitment: amount.toString(),
      estimatedFillTimeMs: this.estimatedFillTimeMs,
      quotedAt: nowMs,
      expiresAt: nowMs + this.quoteValidityMs,
      solverSignature: "0x" as `0x${string}`, // in-process; router waives
      metadata,
    };
  }

  /**
   * Settle by submitting an on-chain transfer and polling the receipt.
   *
   * Throws `TransferSolverError` for every failure path. The
   * intent-router catches the throw and records `settlement-failed`.
   */
  async settle(intent: Intent, quote: Quote): Promise<Fill> {
    this.ensureAlive();

    if (intent.body.kind !== "transfer") {
      throw new TransferSolverError(
        "unsupported-intent-kind",
        `TransferSolver only serves transfer intents, got "${intent.body.kind}"`,
      );
    }
    const body: TransferIntentBody = intent.body;

    if (
      intent.envelope.creator.toLowerCase() !== this.from.toLowerCase()
    ) {
      throw new TransferSolverError(
        "signer-mismatch",
        `intent.creator ${intent.envelope.creator} does not match configured from ${this.from}`,
      );
    }
    if (intent.envelope.chainId !== this.provider.chainId) {
      throw new TransferSolverError(
        "chain-id-mismatch",
        `intent.chainId ${intent.envelope.chainId} does not match provider.chainId ${this.provider.chainId}`,
        {
          details: {
            intentChainId: intent.envelope.chainId,
            providerChainId: this.provider.chainId,
          },
        },
      );
    }
    if (!isValidAddress(body.asset)) {
      throw new TransferSolverError(
        "invalid-asset-address",
        `asset must be 0x-prefixed 20-byte hex, got "${body.asset}"`,
      );
    }
    if (!isValidAddress(body.recipient)) {
      throw new TransferSolverError(
        "invalid-recipient-address",
        `recipient must be 0x-prefixed 20-byte hex, got "${body.recipient}"`,
      );
    }

    let amount: bigint;
    try {
      amount = BigInt(body.amount);
    } catch (cause) {
      throw new TransferSolverError(
        "invalid-amount",
        `amount must parse as bigint, got "${body.amount}"`,
        { cause },
      );
    }
    if (amount <= 0n) {
      throw new TransferSolverError(
        "invalid-amount",
        `amount must be positive, got ${amount}`,
      );
    }

    // ─── Build tx request ─────────────────────────
    // Native vs ERC-20 branch here. The `encodeErc20Transfer` helper
    // handles its own overflow checks.
    const isNative = isNativeAsset(body.asset);
    const txRequest = isNative
      ? {
          to: body.recipient,
          data: "0x" as `0x${string}`,
          value: amount,
        }
      : {
          to: body.asset,
          data: encodeErc20Transfer(body.recipient, amount),
          // value intentionally omitted; ERC-20 transfer carries no
          // native value.
        };

    // ─── Submit ──────────────────────────────────
    let txHash: `0x${string}`;
    try {
      txHash = await this.provider.sendTransaction(txRequest);
    } catch (cause) {
      throw new TransferSolverError(
        "chain-submit-failed",
        `provider.sendTransaction threw: ${
          cause instanceof Error ? cause.message : "unknown"
        }`,
        { cause },
      );
    }

    // ─── Poll receipt ─────────────────────────────
    const receipt = await this.pollForReceipt(txHash);

    if (receipt.status === "reverted") {
      throw new TransferSolverError(
        "chain-tx-reverted",
        `transaction ${txHash} reverted on chain ${this.provider.chainId}`,
        {
          details: {
            transactionHash: txHash,
            blockNumber: receipt.blockNumber.toString(),
          },
        },
      );
    }

    const fillMetadata: TransferSolverFillMetadata = {
      solverClass: "transfer",
      chainId: this.provider.chainId,
      receipt,
    };

    return {
      solverId: this.id,
      intentId: intent.envelope.id,
      quoteCommitment: quote.commitment,
      // Strict equality rule — transfer intents require
      // actualAmount === commitment. We moved exactly `amount`, which
      // is exactly what the quote committed to.
      actualAmount: amount.toString(),
      settlementRef: txHash,
      settledAt: this.now(),
      metadata: fillMetadata,
    };
  }

  dispose(): void {
    this.disposed = true;
  }

  // ─── Private ───────────────────────────────────

  /**
   * Poll `getTransactionReceipt` until non-null or timeout.
   *
   * Uses wall-clock via `this.now()` rather than a loop-count to
   * tolerate jittery sleep() impls (test fakes, throttled runtimes).
   */
  private async pollForReceipt(
    txHash: `0x${string}`,
  ): Promise<TransferTxReceipt> {
    const started = this.now();
    const deadline = started + this.pollTimeoutMs;

    // First attempt without a sleep — fast path for instant-mine
    // dev chains and test doubles.
    let receipt = await this.safeGetReceipt(txHash);
    while (receipt === null) {
      if (this.now() >= deadline) {
        throw new TransferSolverError(
          "chain-confirmation-timeout",
          `transaction ${txHash} not confirmed within ${this.pollTimeoutMs}ms`,
          {
            details: {
              transactionHash: txHash,
              timeoutMs: this.pollTimeoutMs,
            },
          },
        );
      }
      await this.sleep(this.pollIntervalMs);
      receipt = await this.safeGetReceipt(txHash);
    }
    return receipt;
  }

  /**
   * Wrap the provider call so RPC flakes surface as a structured
   * error rather than leaking `FetchError` / provider-specific types.
   */
  private async safeGetReceipt(
    txHash: `0x${string}`,
  ): Promise<TransferTxReceipt | null> {
    try {
      return await this.provider.getTransactionReceipt(txHash);
    } catch (cause) {
      throw new TransferSolverError(
        "chain-submit-failed",
        `provider.getTransactionReceipt threw for ${txHash}: ${
          cause instanceof Error ? cause.message : "unknown"
        }`,
        { cause, details: { transactionHash: txHash } },
      );
    }
  }

  private ensureAlive(): void {
    if (this.disposed) {
      throw new TransferSolverError(
        "solver-disposed",
        `TransferSolver ${this.id} has been disposed`,
      );
    }
  }
}
