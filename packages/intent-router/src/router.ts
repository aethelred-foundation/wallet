/**
 * `IntentRouter` — the orchestrator.
 *
 * The end-to-end pipeline for a submitted intent:
 *
 *     1. verify signature recovers to envelope.creator
 *     2. assert freshness (deadline > now)
 *     3. check nonce not reused
 *     4. (payment intents) evaluate VC gate via reputation bridge
 *     5. solicit quotes from every registered solver for this kind
 *     6. reject quotes whose signer differs from solver.publicKeyHex
 *     7. pick winner via the comparator
 *     8. settle; winning solver commits
 *     9. verify the returned Fill satisfies the quote commitment
 *    10. emit audit events at every stage
 *
 * The router never mutates intents. Solvers never see the full
 * signature — only the digest is passed around off-chain. Settlement
 * is delegated entirely: the router is a routing engine, not a
 * settlement engine.
 *
 * Failures are returned inside `IntentExecutionResult.outcome` (not
 * thrown) for the common paths (no-quotes, settlement-failed,
 * payment-gated). Fatal input errors (malformed intent, expired,
 * signer-mismatch, nonce-reused) still throw `IntentRouterError` —
 * those are bugs in the caller, not ordinary operational flows.
 */

import type { VcGateEvaluation } from "@aethelred/wallet-reputation";

import type {
  AuditSink,
  IntentExecutionResult,
  Intent,
  IntentRouterAuditEvent,
  Quote,
  QuoteComparator,
  Solver,
  SolverRegistry,
} from "./types";
import {
  assertIntentFresh,
  verifyIntentSignature,
} from "./intent-envelope";
import { FillMismatchError, IntentRouterError } from "./errors";
import { pickBest, bestPrice } from "./solver-registry";

/**
 * Optional hook the router calls BEFORE quoting payment intents. We
 * keep it pluggable (rather than hard-linking the reputation
 * package's `evaluatePayment`) so callers who don't use VC gates
 * don't pay the bundle cost. Payment flows that DO gate pass a thin
 * adapter that calls `evaluatePayment` under the hood.
 */
export interface PaymentGate {
  evaluate(intent: Intent): Promise<PaymentGateResult>;
}

export interface PaymentGateResult {
  readonly allowed: boolean;
  readonly failedRuleIds?: ReadonlyArray<string>;
  /**
   * Original evaluation from the reputation bridge. Passed through
   * into `IntentExecutionResult.outcome` for audit pipelines.
   * `null` when the gate doesn't surface a structured evaluation
   * (e.g. a hand-rolled predicate-only gate).
   */
  readonly evaluation: VcGateEvaluation | null;
}

export interface IntentRouterConfig {
  readonly registry: SolverRegistry;
  readonly comparator?: QuoteComparator;
  readonly auditSink?: AuditSink;
  readonly paymentGate?: PaymentGate;
  /** Optional clock override for deterministic tests. */
  readonly now?: () => number;
  /**
   * Per-solver quote timeout in ms. A solver that takes longer is
   * skipped (its quote does not count). Default: 5_000.
   */
  readonly solverQuoteTimeoutMs?: number;
}

/**
 * Simple in-memory replay guard. Real deployments swap in a
 * database-backed or Redis-backed implementation — the interface
 * stays the same.
 */
export interface NonceStore {
  /**
   * Returns `true` when the nonce was NOT previously seen (and
   * records it). Returns `false` if it was already consumed.
   * Implementations are responsible for atomicity under concurrent
   * callers.
   */
  claim(creator: `0x${string}`, nonce: `0x${string}`, chainId: number): Promise<boolean>;
}

export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Set<string>();
  async claim(creator: `0x${string}`, nonce: `0x${string}`, chainId: number): Promise<boolean> {
    const key = `${creator.toLowerCase()}:${nonce.toLowerCase()}:${chainId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

// ─── Router ────────────────────────────────────────────────────

export class IntentRouter {
  private readonly registry: SolverRegistry;
  private readonly comparator: QuoteComparator;
  private readonly auditSink?: AuditSink;
  private readonly paymentGate?: PaymentGate;
  private readonly now: () => number;
  private readonly solverQuoteTimeoutMs: number;
  private readonly nonceStore: NonceStore;
  private disposed = false;

  constructor(config: IntentRouterConfig, nonceStore: NonceStore = new InMemoryNonceStore()) {
    this.registry = config.registry;
    this.comparator = config.comparator ?? bestPrice;
    this.auditSink = config.auditSink;
    this.paymentGate = config.paymentGate;
    this.now = config.now ?? (() => Date.now());
    this.solverQuoteTimeoutMs = config.solverQuoteTimeoutMs ?? 5_000;
    this.nonceStore = nonceStore;
  }

  /**
   * Submit an intent for routing + settlement.
   *
   * Returns an `IntentExecutionResult`. Only fatal input errors
   * (bad signature, expired, etc.) are thrown — operational
   * outcomes are reflected in `result.outcome.kind`.
   */
  async execute(intent: Intent): Promise<IntentExecutionResult> {
    this.ensureAlive();

    const attemptedAt = this.now();

    // 1. Signature verification
    verifyIntentSignature(intent);
    // 2. Freshness
    assertIntentFresh(intent, attemptedAt);
    // 3. Nonce replay guard
    const claimed = await this.nonceStore.claim(
      intent.envelope.creator,
      intent.envelope.nonce,
      intent.envelope.chainId,
    );
    if (!claimed) {
      throw new IntentRouterError(
        "intent-nonce-reused",
        `nonce ${intent.envelope.nonce} was already consumed for creator ${intent.envelope.creator} on chain ${intent.envelope.chainId}`,
        {
          details: {
            creator: intent.envelope.creator,
            nonce: intent.envelope.nonce,
            chainId: intent.envelope.chainId,
          },
        },
      );
    }

    await this.emit({
      type: "intent-submitted",
      intentId: intent.envelope.id,
      creator: intent.envelope.creator,
      kind: intent.body.kind,
      chainId: intent.envelope.chainId,
      at: attemptedAt,
    });

    // 4. Payment gate (all intent kinds).
    //
    // Historically this was payment-only, but the reputation-gate
    // trio (ReputationPaymentGate / ReputationTransferGate /
    // ReputationSwapGate) composes through `composeGatesByIntentKind`
    // behind a single `paymentGate` slot — so the router invokes
    // the slot for every kind. Gates that don't handle a given kind
    // return `{ allowed: true, evaluation: null }` via the compose
    // helper's fall-through path, which is a no-op.
    //
    // The slot's name ("paymentGate") is kept for backward
    // compatibility with existing configs; despite the name it
    // is now kind-agnostic.
    if (this.paymentGate) {
      const gate = await this.paymentGate.evaluate(intent);
      if (!gate.allowed) {
        await this.emit({
          type: "payment-gated",
          intentId: intent.envelope.id,
          failedRuleIds: gate.failedRuleIds ?? [],
          at: this.now(),
        });
        return {
          intentId: intent.envelope.id,
          outcome: {
            kind: "payment-gated",
            // Fall back to an empty evaluation if the gate didn't
            // surface one — consumers read `failedRuleIds` either
            // way.
            evaluation:
              gate.evaluation ??
              ({
                allowed: false,
                results: [],
                failedRuleIds: gate.failedRuleIds ?? [],
                evaluatedAt: this.now(),
                combinator: "all",
                reputation: {
                  agentId: ("0x" + "00".repeat(32)) as `0x${string}`,
                  score: 0,
                  tier: "unknown",
                  transparency: [],
                  computedAt: this.now(),
                },
              } as VcGateEvaluation),
          },
          quotes: [],
          attemptedAt,
          completedAt: this.now(),
        };
      }
    }

    // 5. Solicit quotes
    const solvers = this.registry.listFor(intent.body.kind);
    if (solvers.length === 0) {
      throw new IntentRouterError(
        "no-solvers-available",
        `no solvers registered for intent kind "${intent.body.kind}"`,
      );
    }
    await this.emit({
      type: "quotes-solicited",
      intentId: intent.envelope.id,
      solversTried: solvers.map((s) => s.id),
      at: this.now(),
    });

    const quotes: Quote[] = [];
    await Promise.all(
      solvers.map(async (solver) => {
        const quote = await this.solicitOne(solver, intent);
        if (quote) quotes.push(quote);
      }),
    );

    if (quotes.length === 0) {
      return {
        intentId: intent.envelope.id,
        outcome: { kind: "no-quotes", solversTried: solvers.map((s) => s.id) },
        quotes: [],
        attemptedAt,
        completedAt: this.now(),
      };
    }

    // 6. Pick winner
    const winner = pickBest(quotes, intent, this.comparator);
    if (!winner) {
      return {
        intentId: intent.envelope.id,
        outcome: { kind: "no-quotes", solversTried: solvers.map((s) => s.id) },
        quotes,
        attemptedAt,
        completedAt: this.now(),
      };
    }

    await this.emit({
      type: "quote-chosen",
      intentId: intent.envelope.id,
      solverId: winner.solverId,
      commitment: winner.commitment,
      at: this.now(),
    });

    // 7. Settle via the winning solver.
    const solver = this.registry.get(winner.solverId);
    if (!solver) {
      throw new IntentRouterError(
        "solver-not-registered",
        `winning solver ${winner.solverId} no longer registered`,
      );
    }

    let fill;
    try {
      fill = await solver.settle(intent, winner);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      await this.emit({
        type: "settlement-failed",
        intentId: intent.envelope.id,
        solverId: winner.solverId,
        error: msg,
        at: this.now(),
      });
      return {
        intentId: intent.envelope.id,
        outcome: { kind: "settlement-failed", winningQuote: winner, error: msg },
        quotes,
        attemptedAt,
        completedAt: this.now(),
      };
    }

    // 8. Verify the fill matches the quote commitment.
    verifyFillAgainstQuote(intent, winner, fill);

    await this.emit({
      type: "settlement-succeeded",
      intentId: intent.envelope.id,
      solverId: winner.solverId,
      actualAmount: fill.actualAmount,
      settlementRef: fill.settlementRef,
      at: this.now(),
    });

    return {
      intentId: intent.envelope.id,
      outcome: { kind: "fulfilled", winningQuote: winner, fill },
      quotes,
      attemptedAt,
      completedAt: this.now(),
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  // ─── Private ──────────────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new IntentRouterError("router-disposed", "IntentRouter has been disposed");
    }
  }

  private async solicitOne(solver: Solver, intent: Intent): Promise<Quote | null> {
    try {
      const raced = await Promise.race([
        solver.quote(intent),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), this.solverQuoteTimeoutMs)),
      ]);
      if (!raced) {
        await this.emit({
          type: "quote-declined",
          intentId: intent.envelope.id,
          solverId: solver.id,
          reason: "timeout or null",
          at: this.now(),
        });
        return null;
      }

      if (raced.solverId !== solver.id) {
        throw new IntentRouterError(
          "solver-quote-malformed",
          `solver ${solver.id} returned a quote with solverId ${raced.solverId}`,
        );
      }
      if (raced.intentId.toLowerCase() !== intent.envelope.id.toLowerCase()) {
        throw new IntentRouterError(
          "solver-quote-malformed",
          `solver ${solver.id} returned a quote for the wrong intentId`,
        );
      }
      if (raced.expiresAt <= this.now()) {
        throw new IntentRouterError(
          "solver-quote-expired",
          `solver ${solver.id} returned a pre-expired quote`,
        );
      }

      await this.emit({
        type: "quote-received",
        intentId: intent.envelope.id,
        solverId: solver.id,
        commitment: raced.commitment,
        at: this.now(),
      });
      return raced;
    } catch (cause) {
      await this.emit({
        type: "quote-declined",
        intentId: intent.envelope.id,
        solverId: solver.id,
        reason: cause instanceof Error ? cause.message : String(cause),
        at: this.now(),
      });
      return null;
    }
  }

  private async emit(event: IntentRouterAuditEvent): Promise<void> {
    if (!this.auditSink) return;
    try {
      await this.auditSink.emit(event);
    } catch (cause) {
      // Don't let audit failures mask router errors. We surface as a
      // typed error so operators can alert on audit-pipeline outages.
      throw new IntentRouterError("audit-sink-failed", "audit sink threw", { cause });
    }
  }
}

// ─── Fill verification ─────────────────────────────────────────

/**
 * Cross-check the fill's actual-delivered amount against the quote
 * commitment. Semantics:
 *
 *   - transfer: strict equality (the solver must move exactly the
 *     amount committed).
 *   - swap: `actualAmount >= commitment` (solver may over-deliver
 *     beyond the minimum).
 *   - payment: `actualAmount <= commitment` (solver pays no more
 *     than committed).
 *
 * Exported so advanced callers (e.g. settlement auditors) can
 * reuse the rule.
 */
export function verifyFillAgainstQuote(
  intent: Intent,
  quote: Quote,
  fill: { readonly actualAmount: string; readonly intentId: `0x${string}` },
): void {
  if (fill.intentId.toLowerCase() !== intent.envelope.id.toLowerCase()) {
    throw new IntentRouterError(
      "settlement-fill-mismatch",
      `fill.intentId ${fill.intentId} does not match intent.envelope.id ${intent.envelope.id}`,
    );
  }

  const commitment = BigInt(quote.commitment);
  const actual = BigInt(fill.actualAmount);
  switch (intent.body.kind) {
    case "transfer":
      if (actual !== commitment) {
        throw new FillMismatchError(intent.envelope.id, quote.commitment, fill.actualAmount);
      }
      break;
    case "swap":
      if (actual < commitment) {
        throw new FillMismatchError(intent.envelope.id, quote.commitment, fill.actualAmount);
      }
      break;
    case "payment":
      if (actual > commitment) {
        throw new FillMismatchError(intent.envelope.id, quote.commitment, fill.actualAmount);
      }
      break;
  }
}
