/**
 * `SwapSolver` — intent-router solver for `SwapIntent`, completing
 * the third and final commitment-rule family:
 *
 *     payment → actualAmount ≤ commitment  (x402-solver)
 *     transfer → actualAmount === commitment  (transfer-solver)
 *     swap → actualAmount ≥ commitment  (this solver)
 *
 * Lifecycle (≥ is a FLOOR commitment — hardest of the three):
 *
 *   quote(intent) ──▶ null  (wrong kind / signer / chainId / pair /
 *     │                      venue has no liquidity / floor below
 *     │                      intent.minBuyAmount)
 *     │
 *     └─▶ Quote{ commitment = venueFloor }
 *              │
 *              ▼
 *   settle(intent, quote) ──▶ venue.buildSwapTxs(...)
 *                              │
 *                              ▼
 *                          for each tx:
 *                            provider.sendTransaction
 *                              └─▶ poll receipt → status check
 *                              │
 *                              └─▶ any failure → throw
 *                              │
 *                              ▼
 *                          venue.decodeFillAmount(lastReceipt)
 *                              │
 *                              ├─▶ decoded < commitment → throw
 *                              │    fill-below-commitment
 *                              └─▶ decoded ≥ commitment → Fill
 *
 * Key design calls:
 *
 *   - **Floor commitment with internal slippage buffer.** The venue
 *     returns a mid-price estimate; the solver commits to
 *     `expectedBuyAmount * (10_000 - internalSlippageBps) / 10_000`.
 *     If THIS floor is below the intent's `minBuyAmount`, quote
 *     returns null — the intent is unserveable at the offered
 *     slippage tolerance. If above, we commit to our floor (which
 *     is ≥ minBuyAmount, satisfying the user's constraint).
 *
 *   - **Defense-in-depth via on-chain `amountOutMinimum`.** The
 *     venue embeds the commitment as the on-chain revert threshold.
 *     If the actual execution price is below commitment, the swap
 *     reverts on-chain BEFORE any value moves. Without this, a
 *     successful swap that delivered less than commitment would
 *     pass the on-chain tx but fail the router's verifyFill check,
 *     leaving the intent in a "settled-but-rejected" limbo.
 *
 *   - **Venue-agnostic.** All DEX specifics live behind `SwapVenue`.
 *     The solver never encodes Uniswap / CoW / 1inch bytes. Future
 *     packages (`@aethelred/wallet-swap-venue-uniswap-v3`) implement
 *     the interface; this solver treats them all identically.
 *
 *   - **Sequential tx submission.** Multi-tx venue sequences
 *     (approve → swap) are submitted one at a time, each awaited
 *     before the next. Any failure in the sequence aborts
 *     subsequent txs. The LAST tx's receipt is the one passed to
 *     decodeFillAmount — approve receipts are embedded in metadata
 *     but not inspected for amount.
 *
 *   - **Same guards as transfer-solver.** Chain-id check, signer
 *     check, disposed check, deadline check — declines at quote,
 *     throws at settle. The pattern is now stable across three
 *     solvers; future solvers inherit it by convention.
 */

import { SwapSolverError } from "./errors";
import { pairOf } from "./stub-venue";
import type {
  Fill,
  Intent,
  Quote,
  Solver,
  SwapIntentBody,
  SwapSolverConfig,
  SwapSolverFillMetadata,
  SwapSolverQuoteMetadata,
  SwapTxReceipt,
  SwapTxRequest,
  SwapVenue,
} from "./types";

// ─── Defaults ──────────────────────────────────────

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;
/**
 * Shorter than transfer-solver's 60s because swap prices move. A
 * quote older than 30s is stale enough that re-quoting is safer.
 */
const DEFAULT_QUOTE_VALIDITY_MS = 30_000;
const DEFAULT_FILL_TIME_MS = 20_000;
const DEFAULT_INTERNAL_SLIPPAGE_BPS = 50; // 0.5%
const BPS_DENOMINATOR = 10_000n;

// ─── Solver ────────────────────────────────────────

export class SwapSolver implements Solver {
  readonly id: string;
  readonly name: string;
  readonly supportedIntentKinds = ["swap"] as const;
  readonly publicKeyHex = null;

  // ── Internals ──
  private readonly from: `0x${string}`;
  private readonly provider: SwapSolverConfig["provider"];
  private readonly venue: SwapVenue;
  private readonly internalSlippageBps: bigint;
  private readonly allowedPairsLower: ReadonlyArray<string> | null;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;
  private readonly quoteValidityMs: number;
  private readonly estimatedFillTimeMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private disposed = false;

  constructor(config: SwapSolverConfig) {
    if (!isValidAddress(config.from)) {
      throw new SwapSolverError(
        "signer-mismatch",
        `config.from must be 0x-prefixed 20-byte hex, got "${config.from}"`,
      );
    }
    if (config.venue.chainId !== config.provider.chainId) {
      throw new SwapSolverError(
        "chain-id-mismatch",
        `venue.chainId ${config.venue.chainId} ≠ provider.chainId ${config.provider.chainId}`,
      );
    }

    this.id = config.id;
    this.name = config.name;
    this.from = config.from;
    this.provider = config.provider;
    this.venue = config.venue;
    this.internalSlippageBps = BigInt(
      config.internalSlippageBps ?? DEFAULT_INTERNAL_SLIPPAGE_BPS,
    );
    if (
      this.internalSlippageBps < 0n ||
      this.internalSlippageBps >= BPS_DENOMINATOR
    ) {
      throw new SwapSolverError(
        "invalid-amount",
        `internalSlippageBps must be in [0, ${BPS_DENOMINATOR}), got ${config.internalSlippageBps}`,
      );
    }
    this.allowedPairsLower =
      config.allowedPairs?.map((p) => p.toLowerCase()) ?? null;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollTimeoutMs = config.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    this.quoteValidityMs = config.quoteValidityMs ?? DEFAULT_QUOTE_VALIDITY_MS;
    this.estimatedFillTimeMs = config.estimatedFillTimeMs ?? DEFAULT_FILL_TIME_MS;
    this.now = config.now ?? (() => Date.now());
    this.sleep =
      config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async quote(intent: Intent): Promise<Quote | null> {
    this.ensureAlive();

    if (intent.body.kind !== "swap") return null;
    const body: SwapIntentBody = intent.body;

    if (intent.envelope.creator.toLowerCase() !== this.from.toLowerCase()) {
      return null;
    }
    if (intent.envelope.chainId !== this.provider.chainId) return null;

    const nowMs = this.now();
    if (intent.envelope.deadline <= nowMs) return null;

    if (!isValidAddress(body.sellAsset)) return null;
    if (!isValidAddress(body.buyAsset)) return null;
    if (!isValidAddress(body.recipient)) return null;

    if (body.sellAsset.toLowerCase() === body.buyAsset.toLowerCase()) {
      // same-asset swap is nonsense
      return null;
    }

    if (
      this.allowedPairsLower !== null &&
      !this.allowedPairsLower.includes(pairOf(body.sellAsset, body.buyAsset))
    ) {
      return null;
    }

    // Parse amounts defensively.
    let sellAmount: bigint;
    let minBuyAmount: bigint;
    try {
      sellAmount = BigInt(body.sellAmount);
      minBuyAmount = BigInt(body.minBuyAmount);
    } catch {
      return null;
    }
    if (sellAmount <= 0n) return null;
    if (minBuyAmount < 0n) return null;
    if (sellAmount >> 256n !== 0n) return null;
    if (minBuyAmount >> 256n !== 0n) return null;

    // Ask the venue.
    let venueResult;
    try {
      venueResult = await this.venue.quote({
        chainId: this.provider.chainId,
        sellAsset: body.sellAsset,
        sellAmount,
        buyAsset: body.buyAsset,
      });
    } catch {
      // Quote-time venue errors are declines, not failures. The
      // router should try other solvers rather than fail the intent.
      return null;
    }
    if (!venueResult) return null;
    if (venueResult.expectedBuyAmount <= 0n) return null;

    // Apply internal slippage buffer to get the commitment floor.
    const floor =
      (venueResult.expectedBuyAmount *
        (BPS_DENOMINATOR - this.internalSlippageBps)) /
      BPS_DENOMINATOR;

    // Must satisfy the user's minBuyAmount; else the intent is
    // unserveable at this venue's price under our slippage tolerance.
    if (floor < minBuyAmount) return null;
    if (floor <= 0n) return null;

    const metadata: SwapSolverQuoteMetadata = {
      solverClass: "swap",
      chainId: this.provider.chainId,
      venueId: this.venue.id,
      sellAsset: body.sellAsset,
      buyAsset: body.buyAsset,
      sellAmount: sellAmount.toString(),
      expectedBuyAmount: venueResult.expectedBuyAmount.toString(),
      internalSlippageBps: Number(this.internalSlippageBps),
    };

    return {
      solverId: this.id,
      intentId: intent.envelope.id,
      commitment: floor.toString(),
      estimatedFillTimeMs: this.estimatedFillTimeMs,
      quotedAt: nowMs,
      expiresAt: nowMs + this.quoteValidityMs,
      solverSignature: "0x" as `0x${string}`,
      metadata,
    };
  }

  async settle(intent: Intent, quote: Quote): Promise<Fill> {
    this.ensureAlive();

    if (intent.body.kind !== "swap") {
      throw new SwapSolverError(
        "unsupported-intent-kind",
        `SwapSolver only serves swap intents, got "${intent.body.kind}"`,
      );
    }
    const body: SwapIntentBody = intent.body;

    if (intent.envelope.creator.toLowerCase() !== this.from.toLowerCase()) {
      throw new SwapSolverError(
        "signer-mismatch",
        `intent.creator ${intent.envelope.creator} does not match configured from ${this.from}`,
      );
    }
    if (intent.envelope.chainId !== this.provider.chainId) {
      throw new SwapSolverError(
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
    if (!isValidAddress(body.sellAsset)) {
      throw new SwapSolverError(
        "invalid-sell-asset-address",
        `sellAsset must be 20-byte hex, got "${body.sellAsset}"`,
      );
    }
    if (!isValidAddress(body.buyAsset)) {
      throw new SwapSolverError(
        "invalid-buy-asset-address",
        `buyAsset must be 20-byte hex, got "${body.buyAsset}"`,
      );
    }
    if (!isValidAddress(body.recipient)) {
      throw new SwapSolverError(
        "invalid-recipient-address",
        `recipient must be 20-byte hex, got "${body.recipient}"`,
      );
    }
    if (body.sellAsset.toLowerCase() === body.buyAsset.toLowerCase()) {
      throw new SwapSolverError(
        "same-sell-and-buy-asset",
        `sellAsset === buyAsset (${body.sellAsset})`,
      );
    }

    let sellAmount: bigint;
    let commitment: bigint;
    try {
      sellAmount = BigInt(body.sellAmount);
      commitment = BigInt(quote.commitment);
    } catch (cause) {
      throw new SwapSolverError(
        "invalid-amount",
        `sellAmount / commitment must parse as bigint`,
        { cause },
      );
    }
    if (sellAmount <= 0n) {
      throw new SwapSolverError(
        "invalid-amount",
        `sellAmount must be positive, got ${sellAmount}`,
      );
    }
    if (commitment <= 0n) {
      throw new SwapSolverError(
        "invalid-amount",
        `quote.commitment must be positive, got ${commitment}`,
      );
    }

    // ─── Re-quote the venue to thread venueData into the build step.
    // We could skip this if we'd persisted venueData into Quote, but
    // Quote.metadata is an audit blob, not a handoff channel. Re-
    // quoting is one extra call; the venue's quote() is expected to
    // be cheap (often a single pool-state read).
    let venueQuote;
    try {
      venueQuote = await this.venue.quote({
        chainId: this.provider.chainId,
        sellAsset: body.sellAsset,
        sellAmount,
        buyAsset: body.buyAsset,
      });
    } catch (cause) {
      throw new SwapSolverError(
        "venue-quote-failed",
        `venue.quote threw during settle: ${
          cause instanceof Error ? cause.message : "unknown"
        }`,
        { cause },
      );
    }
    if (!venueQuote) {
      throw new SwapSolverError(
        "venue-no-liquidity",
        `venue reported no liquidity for ${body.sellAsset} → ${body.buyAsset} at sellAmount ${sellAmount}`,
      );
    }
    // Re-apply internal slippage and enforce the router's commitment
    // is still achievable at the latest mid-price.
    const nowFloor =
      (venueQuote.expectedBuyAmount *
        (BPS_DENOMINATOR - this.internalSlippageBps)) /
      BPS_DENOMINATOR;
    if (nowFloor < commitment) {
      throw new SwapSolverError(
        "venue-quote-below-min-buy-amount",
        `venue's current floor ${nowFloor} dropped below quote commitment ${commitment} — price moved`,
        {
          details: {
            commitment: commitment.toString(),
            currentFloor: nowFloor.toString(),
            currentExpected: venueQuote.expectedBuyAmount.toString(),
          },
        },
      );
    }

    // ─── Build the tx sequence.
    let txs: ReadonlyArray<SwapTxRequest>;
    try {
      txs = await this.venue.buildSwapTxs({
        chainId: this.provider.chainId,
        sellAsset: body.sellAsset,
        sellAmount,
        buyAsset: body.buyAsset,
        recipient: body.recipient,
        amountOutMinimum: commitment, // on-chain defense-in-depth
        venueData: venueQuote.venueData,
        deadlineMs: intent.envelope.deadline,
      });
    } catch (cause) {
      throw new SwapSolverError(
        "venue-build-failed",
        `venue.buildSwapTxs threw: ${
          cause instanceof Error ? cause.message : "unknown"
        }`,
        { cause },
      );
    }
    if (txs.length === 0) {
      throw new SwapSolverError(
        "venue-build-failed",
        `venue.buildSwapTxs returned an empty tx sequence`,
      );
    }

    // ─── Submit sequentially. Abort on first failure. The LAST
    // receipt is the swap receipt; earlier ones (approve etc.) are
    // captured in metadata only.
    const receipts: SwapTxReceipt[] = [];
    const labels: string[] = [];
    for (const tx of txs) {
      let txHash: `0x${string}`;
      try {
        txHash = await this.provider.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value,
        });
      } catch (cause) {
        throw new SwapSolverError(
          "chain-submit-failed",
          `provider.sendTransaction threw for "${tx.label}" tx: ${
            cause instanceof Error ? cause.message : "unknown"
          }`,
          { cause, details: { label: tx.label } },
        );
      }

      const receipt = await this.pollForReceipt(txHash);
      if (receipt.status === "reverted") {
        throw new SwapSolverError(
          "chain-tx-reverted",
          `"${tx.label}" tx ${txHash} reverted on chain ${this.provider.chainId}`,
          {
            details: {
              label: tx.label,
              transactionHash: txHash,
              blockNumber: receipt.blockNumber.toString(),
            },
          },
        );
      }
      receipts.push(receipt);
      labels.push(tx.label);
    }

    // ─── Decode actual fill amount from the final receipt.
    const swapReceipt = receipts[receipts.length - 1]!;
    let actual: bigint;
    try {
      actual = this.venue.decodeFillAmount({
        receipt: swapReceipt,
        recipient: body.recipient,
        buyAsset: body.buyAsset,
        venueData: venueQuote.venueData,
      });
    } catch (cause) {
      throw new SwapSolverError(
        "venue-decode-failed",
        `venue.decodeFillAmount threw: ${
          cause instanceof Error ? cause.message : "unknown"
        }`,
        { cause },
      );
    }
    if (actual < commitment) {
      throw new SwapSolverError(
        "fill-below-commitment",
        `decoded fill ${actual} below committed floor ${commitment} — on-chain amountOutMinimum should have prevented this; check venue.decodeFillAmount impl`,
        {
          details: {
            actual: actual.toString(),
            commitment: commitment.toString(),
            transactionHash: swapReceipt.transactionHash,
          },
        },
      );
    }

    const fillMetadata: SwapSolverFillMetadata = {
      solverClass: "swap",
      chainId: this.provider.chainId,
      venueId: this.venue.id,
      receipts,
      txLabels: labels,
    };

    return {
      solverId: this.id,
      intentId: intent.envelope.id,
      quoteCommitment: quote.commitment,
      actualAmount: actual.toString(),
      settlementRef: swapReceipt.transactionHash,
      settledAt: this.now(),
      metadata: fillMetadata,
    };
  }

  dispose(): void {
    this.disposed = true;
  }

  // ─── Private ───────────────────────────────────

  private async pollForReceipt(
    txHash: `0x${string}`,
  ): Promise<SwapTxReceipt> {
    const started = this.now();
    const deadline = started + this.pollTimeoutMs;

    let receipt = await this.safeGetReceipt(txHash);
    while (receipt === null) {
      if (this.now() >= deadline) {
        throw new SwapSolverError(
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

  private async safeGetReceipt(
    txHash: `0x${string}`,
  ): Promise<SwapTxReceipt | null> {
    try {
      return await this.provider.getTransactionReceipt(txHash);
    } catch (cause) {
      throw new SwapSolverError(
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
      throw new SwapSolverError(
        "solver-disposed",
        `SwapSolver ${this.id} has been disposed`,
      );
    }
  }
}

// ─── Helpers (not exported) ────────────────────────

function isValidAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
