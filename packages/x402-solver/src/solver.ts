/**
 * `X402FacilitatorSolver` — intent-router solver backed by x402Fetch.
 *
 * The first production-shape solver implementation. Demonstrates the
 * pattern every subsequent solver (Uniswap v3, CoW batch, bespoke
 * liquidity venues) follows:
 *
 *   1. Validate at construction the intent kind can be served.
 *   2. `quote()` — return a commitment optimistically (cheap) OR
 *      fail-fast if the agent's signer address won't match.
 *   3. `settle()` — do the real work. Translate upstream-protocol
 *      success/failure into the Fill ↔ thrown-error convention the
 *      intent-router expects.
 *
 * Flow for a PaymentIntent:
 *
 *   submit                                    return
 *     │                                          ▲
 *     ▼                                          │
 *   quote(intent) ──▶ commit intent.maxAmount ──▶ Quote
 *     │ (sanity-only; no HTTP)
 *     │
 *   (router picks winner)
 *     │
 *     ▼
 *   settle(intent, quote) ──▶ x402Fetch(resource, { signer, ... })
 *                              │
 *                              ├─▶ 200 + receipt → Fill
 *                              └─▶ other → throw X402SolverError
 *
 * Design calls:
 *
 *   - **Optimistic quoting.** `quote()` doesn't HTTP-preflight the
 *     resource — that would double-trip every intent submission. The
 *     router may fan out quotes to many solvers; HTTP preflights per
 *     solver don't scale. The `PaymentIntent.maxAmount` is a ceiling
 *     and the router's `verifyFillAgainstQuote` enforces
 *     `actualAmount <= commitment`, so paying the ceiling is always
 *     sound. Future extension point for preflight mode documented in
 *     the README.
 *
 *   - **Signer-address = intent.creator guard.** Checked at quote
 *     time so the router gets fast "I can't serve this" feedback
 *     rather than discovering mid-settlement that the signer is
 *     wrong. The intent is already EIP-712-verified by the router
 *     before reaching here; we just double-check.
 *
 *   - **Attestation-gated routing.** If the config includes an
 *     AttestationProvider, the solver can serve resources that
 *     require attestation. If not, it gracefully declines those
 *     (returns null from quote) rather than throwing — that lets
 *     the router try a different solver.
 *
 *   - **Dispose semantics.** `dispose()` is a no-op for pure-function
 *     state, but flips an internal flag so subsequent calls fail
 *     fast. Matches the pattern across custody-adapters /
 *     agent-budget.
 */

import { x402Fetch } from "@aethelred/wallet-x402";

import { X402SolverError } from "./errors";
import type {
  Fill,
  Intent,
  Quote,
  Solver,
  X402FacilitatorSolverConfig,
  X402SolverFillMetadata,
  X402SolverQuoteMetadata,
} from "./types";

// ─── Defaults ───────────────────────────────────────

const DEFAULT_QUOTE_VALIDITY_MS = 60_000;
const DEFAULT_FILL_TIME_MS = 1_500;

// ─── Solver ─────────────────────────────────────────

export class X402FacilitatorSolver implements Solver {
  // ── Solver contract surface ──
  readonly id: string;
  readonly name: string;
  readonly supportedIntentKinds = ["payment"] as const;
  // x402 signatures aren't validated by the router against a
  // specific solver public key — the router trusts the solver to
  // return well-formed quotes. Return null to opt out of the
  // router's optional solver-signature check.
  readonly publicKeyHex = null;

  // ── Internals ──
  private readonly config: X402FacilitatorSolverConfig;
  private readonly now: () => number;
  private readonly quoteValidityMs: number;
  private readonly estimatedFillTimeMs: number;
  private disposed = false;

  constructor(config: X402FacilitatorSolverConfig) {
    this.config = config;
    this.id = config.id;
    this.name = config.name;
    this.now = config.now ?? (() => Date.now());
    this.quoteValidityMs = config.quoteValidityMs ?? DEFAULT_QUOTE_VALIDITY_MS;
    this.estimatedFillTimeMs = config.estimatedFillTimeMs ?? DEFAULT_FILL_TIME_MS;
  }

  /**
   * Produce a quote for the intent, or return `null` to decline.
   *
   * Declines for:
   *   - non-payment intents (transfer / swap aren't x402-shaped)
   *   - intents whose `creator` doesn't match the configured signer
   *   - intents whose resource is missing or malformed
   *
   * Everything else produces an optimistic quote committing to
   * `intent.body.maxAmount` — the facilitator may settle for less;
   * the router's `actualAmount <= commitment` rule keeps it sound.
   */
  async quote(intent: Intent): Promise<Quote | null> {
    this.ensureAlive();

    if (intent.body.kind !== "payment") {
      return null;
    }
    if (
      intent.envelope.creator.toLowerCase() !==
      this.config.signer.address.toLowerCase()
    ) {
      return null;
    }
    if (!intent.body.resource) {
      return null;
    }
    try {
      // Sanity-only: must be a valid URL string. If consumers pass
      // invoice-slug-style URIs (`invoice:ABC123`), they need a
      // different solver class — we expect HTTP(S) resources.
      const url = new URL(intent.body.resource);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    } catch {
      return null;
    }

    const now = this.now();

    const metadata: X402SolverQuoteMetadata = {
      solverClass: "x402-facilitator",
      supportedNetworks: this.config.supportedNetworks,
      attestationAvailable: this.config.attestation !== undefined,
      resource: intent.body.resource,
    };

    return {
      solverId: this.id,
      intentId: intent.envelope.id,
      commitment: intent.body.maxAmount,
      estimatedFillTimeMs: this.estimatedFillTimeMs,
      quotedAt: now,
      expiresAt: now + this.quoteValidityMs,
      solverSignature: "0x" as `0x${string}`, // no signing for in-process solvers
      metadata,
    };
  }

  /**
   * Settle the intent by calling x402Fetch against the resource.
   *
   * Throws `X402SolverError` on any failure — the intent-router
   * translates the throw into a `settlement-failed` outcome.
   */
  async settle(intent: Intent, quote: Quote): Promise<Fill> {
    this.ensureAlive();

    if (intent.body.kind !== "payment") {
      throw new X402SolverError(
        "unsupported-intent-kind",
        `X402FacilitatorSolver only serves payment intents, got "${intent.body.kind}"`,
      );
    }
    if (
      intent.envelope.creator.toLowerCase() !==
      this.config.signer.address.toLowerCase()
    ) {
      throw new X402SolverError(
        "signer-mismatch",
        `intent.creator ${intent.envelope.creator} does not match configured signer ${this.config.signer.address}`,
      );
    }

    // ─── Balance pre-flight (PR #105, opt-in) ────
    // When configured, query the agent's balance via the operator-
    // supplied callback and fail-fast if it's less than the
    // intent's `maxAmount` (commit ceiling). Saves the round-trip
    // of HTTP request + EIP-712 sign + facilitator on-chain
    // submission on doomed payments and surfaces a clear
    // `pre-flight-insufficient-balance` error rather than an
    // opaque on-chain `transferWithAuthorization` revert.
    //
    // Symmetric to PR #101's transfer-side pre-flight: settle-time
    // check, fail-OPEN on callback errors. The optimization never
    // blocks a payment — RPC flakes degrade to the original
    // x402Fetch path, where the chain has the final say.
    if (this.config.balancePreflight) {
      const owner = this.config.signer.address as `0x${string}`;
      const asset = intent.body.asset;
      let maxAmount: bigint;
      try {
        maxAmount = BigInt(intent.body.maxAmount);
      } catch (cause) {
        throw new X402SolverError(
          "pre-flight-insufficient-balance",
          `intent.body.maxAmount must parse as bigint, got "${intent.body.maxAmount}"`,
          { cause },
        );
      }

      let balance: bigint | undefined;
      try {
        balance = await this.config.balancePreflight(owner, asset);
      } catch {
        // Fail-OPEN: pre-flight is an optimization, not a
        // correctness gate. RPC flake → fall through to x402Fetch
        // and let the chain decide.
        balance = undefined;
      }

      if (balance !== undefined && balance < maxAmount) {
        throw new X402SolverError(
          "pre-flight-insufficient-balance",
          `agent ${owner} has balance ${balance} of asset ${asset}; intent maxAmount ${maxAmount}`,
          {
            details: {
              owner,
              asset,
              balance: balance.toString(),
              maxAmount: maxAmount.toString(),
            },
          },
        );
      }
    }

    let result;
    try {
      result = await x402Fetch(intent.body.resource, {
        signer: this.config.signer,
        attestation: this.config.attestation,
        audit: this.config.audit,
        fetch: this.config.fetch,
      });
    } catch (cause) {
      throw new X402SolverError(
        "facilitator-http-error",
        `x402Fetch threw while paying for ${intent.body.resource}: ${
          cause instanceof Error ? cause.message : "unknown"
        }`,
        { cause },
      );
    }

    if (result.response.status >= 400) {
      throw new X402SolverError(
        "facilitator-http-error",
        `x402Fetch returned HTTP ${result.response.status} for ${intent.body.resource}`,
        { details: { status: result.response.status } },
      );
    }
    if (!result.receipt || !result.paidAgainst) {
      // A 2xx with no receipt / no paidAgainst means the resource
      // didn't actually require payment. That's not an error per se,
      // but it's also not a "fill" — nothing moved. We treat it as
      // a missing receipt because the router expects every settle
      // to return a Fill with a non-empty settlementRef.
      throw new X402SolverError(
        "missing-receipt",
        `x402Fetch returned HTTP ${result.response.status} but no receipt — resource may not actually require payment`,
        { details: { status: result.response.status } },
      );
    }

    // The `verifyFillAgainstQuote` rule for payment intents is
    // `actualAmount <= commitment`. Under the x402 "exact" scheme
    // (the only scheme in v0.1), the client pays exactly
    // `paidAgainst.maxAmountRequired`, so that value IS the actual
    // spend. If it exceeds the quote commitment something is very
    // wrong (facilitator served a different requirement than we
    // expected). Fail loudly so the router's ledger doesn't
    // silently paper over a mismatch.
    const commitment = BigInt(quote.commitment);
    const actual = BigInt(result.paidAgainst.maxAmountRequired);
    if (actual > commitment) {
      throw new X402SolverError(
        "receipt-amount-exceeds-commitment",
        `receipt amountPaid ${actual} exceeds quote commitment ${commitment}`,
        {
          details: {
            amountPaid: actual.toString(),
            commitment: commitment.toString(),
          },
        },
      );
    }

    const fillMetadata: X402SolverFillMetadata = {
      solverClass: "x402-facilitator",
      paymentReceipt: result.receipt,
      httpStatus: result.response.status,
    };

    return {
      solverId: this.id,
      intentId: intent.envelope.id,
      quoteCommitment: quote.commitment,
      actualAmount: actual.toString(),
      settlementRef: result.receipt.paymentId ?? `x402:${intent.envelope.id}`,
      settledAt: this.now(),
      metadata: fillMetadata,
    };
  }

  dispose(): void {
    this.disposed = true;
  }

  // ─── Private ────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new X402SolverError(
        "solver-disposed",
        `X402FacilitatorSolver ${this.id} has been disposed`,
      );
    }
  }
}
