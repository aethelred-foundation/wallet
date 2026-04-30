/**
 * `@aethelred/wallet-intent-router` — type surface.
 *
 * Four type families:
 *
 *   1. **Intents** — what the agent wants. Tagged-union over
 *      `kind: "transfer" | "swap" | "payment"`. Every intent carries
 *      an `IntentEnvelope` header (id, creator, chainId, nonce,
 *      deadline, signature) and a kind-specific body.
 *
 *   2. **Solvers + Quotes** — a solver registers with the router,
 *      advertises the intent kinds it supports, and responds to
 *      quote requests with a `Quote` (or declines by returning
 *      null). The router picks a winner via a pluggable
 *      `QuoteComparator`.
 *
 *   3. **Fills** — settlement receipts. The winning solver returns
 *      a `Fill` after settling on-chain (or via x402 for payment
 *      intents). The router cross-checks the fill against the
 *      quote's commitment before marking the intent fulfilled.
 *
 *   4. **Audit events** — every stage of the pipeline emits a
 *      structured record to an `AuditSink`. Events serialise to
 *      JSON cleanly so existing audit pipelines (compliance exports,
 *      SAR / STR templates) can consume them verbatim.
 *
 * The router itself is chain-agnostic. Concrete settlement happens
 * inside solvers: a Uniswap-backed solver calls swap router on-chain;
 * an x402 solver calls the facilitator; a CoW solver batches. The
 * router's only job is routing + auditing, not settlement.
 *
 * @packageDocumentation
 */

import type {
  TypedDataDomain,
  TypedDataField,
  TypedDataSigner,
} from "@aethelred/wallet-custody-adapters";
import type { VcGateEvaluation } from "@aethelred/wallet-reputation";

// ─── Intent envelope ────────────────────────────────────────────

export type IntentKind = "transfer" | "swap" | "payment";

/**
 * Common envelope every intent carries. This is the part the EIP-712
 * signature covers — solvers verify by recovering the signer from
 * `envelope` + the kind-specific body.
 *
 * `nonce` prevents replay of an old signed intent. The router tracks
 * seen `(creator, nonce, chainId)` triples per submit; second use
 * throws `intent-nonce-reused`.
 *
 * `deadline` is unix ms; after this point no solver may submit a
 * quote and no settlement may succeed.
 */
export interface IntentEnvelope {
  /** Deterministic `keccak256(canonical(envelope||body))`. */
  readonly id: `0x${string}`;
  /** Agent control address (EOA or smart-account). */
  readonly creator: `0x${string}`;
  /** Chain id the intent targets. */
  readonly chainId: number;
  /** Unique nonce; 32 bytes. */
  readonly nonce: `0x${string}`;
  /** Unix ms after which the intent is void. */
  readonly deadline: number;
  /**
   * Optional user-data hash the creator binds into the envelope so a
   * TEE quote can attest to this intent. Mirrors the x402 binding
   * flow — solvers consuming intent-attestation pairs should pass
   * this as the `userData` field on `produceAttestation()`.
   */
  readonly attestationBinding?: `0x${string}`;
  /** EIP-712 signature from the creator over the envelope+body. */
  readonly signature: `0x${string}`;
}

// ─── Intent kinds ───────────────────────────────────────────────

/** Send a fixed amount of an asset to a recipient. */
export interface TransferIntentBody {
  readonly kind: "transfer";
  readonly asset: `0x${string}`;
  /** Smallest-unit amount (e.g. `"1000000"` = 1 USDC). */
  readonly amount: string;
  readonly recipient: `0x${string}`;
}

/**
 * Swap intent — supports two directions (PR #118):
 *
 *   - **exact-input** (default): exchange `sellAmount` of `sellAsset` for
 *     at least `minBuyAmount` of `buyAsset`. The solver promises the
 *     buy-side floor; actual delivered amount may exceed it.
 *
 *   - **exact-output**: receive exactly `buyAmount` of `buyAsset`,
 *     spending up to `maxSellAmount` of `sellAsset`. Useful for NFT
 *     purchases, fixed-price payments, and any flow where the user
 *     cares about the OUTPUT amount, not the input.
 *
 * The `direction` field discriminates. Older callers that omit it get
 * exact-input semantics (the field is optional with default
 * `"exact-input"`); the field-presence rules are validated at the
 * solver layer.
 *
 * Field-presence contract:
 *   - direction unset OR `"exact-input"` → require `sellAmount` +
 *     `minBuyAmount`; ignore `buyAmount` / `maxSellAmount`.
 *   - direction === `"exact-output"` → require `buyAmount` +
 *     `maxSellAmount`; ignore `sellAmount` / `minBuyAmount`.
 *
 * Intents that violate the contract are declined by the solver.
 */
export interface SwapIntentBody {
  readonly kind: "swap";
  readonly sellAsset: `0x${string}`;
  readonly buyAsset: `0x${string}`;
  readonly recipient: `0x${string}`;
  /**
   * Direction discriminator. Default `"exact-input"` when unset;
   * set explicitly to `"exact-output"` for fixed-output intents.
   */
  readonly direction?: "exact-input" | "exact-output";
  /** Required when direction is exact-input. */
  readonly sellAmount?: string;
  /** Required when direction is exact-input. */
  readonly minBuyAmount?: string;
  /** Required when direction is exact-output (PR #118). */
  readonly buyAmount?: string;
  /** Required when direction is exact-output (PR #118). */
  readonly maxSellAmount?: string;
  /**
   * Optional slippage BPS (basis points). Solvers that don't support
   * slippage ignore this; those that do widen the accept-band.
   */
  readonly slippageBps?: number;
}

/**
 * Pay up to `maxAmount` of `asset` to `merchant` for `resource`.
 *
 * Shaped so an x402 `PaymentRequirement` maps 1:1 — the intent
 * router can drive x402 flows AND bespoke payment rails through the
 * same surface.
 */
export interface PaymentIntentBody {
  readonly kind: "payment";
  readonly asset: `0x${string}`;
  readonly maxAmount: string;
  readonly merchant: `0x${string}`;
  readonly resource: string;
  readonly description?: string;
  /** Copied from x402 PaymentRequirement.extra so solvers can see gate hints. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export type IntentBody = TransferIntentBody | SwapIntentBody | PaymentIntentBody;

/** Full intent = envelope + body. */
export interface Intent {
  readonly envelope: IntentEnvelope;
  readonly body: IntentBody;
}

// ─── Solver / Quote / Fill ──────────────────────────────────────

/**
 * A quote from a solver committing to fulfill a specific intent.
 *
 * Solvers sign quotes (`solverSignature`) so the router can detect
 * quote tampering. The signature is over the canonical form of
 * `(intentId || commitment || quotedAt || expiresAt)`.
 */
export interface Quote {
  readonly solverId: string;
  readonly intentId: `0x${string}`;
  /**
   * For `transfer`: the exact `amount` the solver will move.
   * For `swap`: the `buyAmount` the solver commits to deliver (≥
   * `minBuyAmount`).
   * For `payment`: the `amount` the solver will pay (≤ `maxAmount`).
   *
   * String to avoid float precision; solvers always quote in the
   * asset's smallest unit.
   */
  readonly commitment: string;
  /** Solver's estimated fill time in ms (upper bound). */
  readonly estimatedFillTimeMs: number;
  /** Unix ms the quote was produced. */
  readonly quotedAt: number;
  /** Unix ms after which the quote is void. */
  readonly expiresAt: number;
  /**
   * Signature by the solver over `(intentId || commitment || quotedAt
   * || expiresAt)`. Router verifies with solver public key on file.
   * Empty `0x` when the solver is local / in-process (tests, dev).
   */
  readonly solverSignature: `0x${string}`;
  /** Free-form metadata (route, sub-quotes, venue, etc.). Audit-only. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Settlement receipt. Solvers emit this after fulfilling on-chain or
 * off-chain. The router verifies `actualAmount >= quote.commitment`
 * for swap/payment intents and `=== quote.commitment` for transfer
 * intents.
 */
export interface Fill {
  readonly solverId: string;
  readonly intentId: `0x${string}`;
  readonly quoteCommitment: string;
  /** What actually settled. Must satisfy the quote commitment. */
  readonly actualAmount: string;
  /** On-chain tx hash (if settled on-chain) or off-chain receipt id. */
  readonly settlementRef: string;
  readonly settledAt: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Solver contract. Implementations are free to talk to any backend
 * — on-chain contract, centralised liquidity venue, x402 facilitator,
 * a MoltPe-style closed network. The router only sees this interface.
 */
export interface Solver {
  readonly id: string;
  readonly name: string;
  readonly supportedIntentKinds: ReadonlyArray<IntentKind>;
  /**
   * Solver's public key (compressed secp256k1, 33 bytes hex) used to
   * verify `solverSignature` on quotes. Return `null` for in-process
   * solvers where signature verification is waived.
   */
  readonly publicKeyHex: `0x${string}` | null;

  /**
   * Produce a quote for the intent, or return `null` to decline.
   * Declining is a first-class outcome — solvers decline when they
   * can't route, price is above threshold, intent size exceeds their
   * inventory, etc.
   */
  quote(intent: Intent): Promise<Quote | null>;

  /**
   * Settle the intent using the previously-returned quote. Throws
   * with a `settlement-failed` error if the on-chain / off-chain
   * settlement path fails.
   */
  settle(intent: Intent, quote: Quote): Promise<Fill>;
}

/** Registry over solvers. Pluggable so callers can mix in-memory + remote. */
export interface SolverRegistry {
  listFor(kind: IntentKind): ReadonlyArray<Solver>;
  get(id: string): Solver | null;
}

/**
 * Comparator. Returns negative if `a` is preferred over `b`, positive
 * if the inverse, zero if tied. Consistent with `Array.prototype.sort`.
 */
export type QuoteComparator = (a: Quote, b: Quote, intent: Intent) => number;

// ─── Audit events ──────────────────────────────────────────────

/**
 * Structured audit record emitted at every stage. Designed to JSON-
 * serialise for downstream storage. Every event carries the
 * `intentId` so compliance pipelines can reconstruct the full trail
 * for any given intent.
 */
export type IntentRouterAuditEvent =
  | {
      readonly type: "intent-submitted";
      readonly intentId: `0x${string}`;
      readonly creator: `0x${string}`;
      readonly kind: IntentKind;
      readonly chainId: number;
      readonly at: number;
    }
  | {
      readonly type: "quotes-solicited";
      readonly intentId: `0x${string}`;
      readonly solversTried: ReadonlyArray<string>;
      readonly at: number;
    }
  | {
      readonly type: "quote-received";
      readonly intentId: `0x${string}`;
      readonly solverId: string;
      readonly commitment: string;
      readonly at: number;
    }
  | {
      readonly type: "quote-declined";
      readonly intentId: `0x${string}`;
      readonly solverId: string;
      readonly reason: string;
      readonly at: number;
    }
  | {
      readonly type: "quote-chosen";
      readonly intentId: `0x${string}`;
      readonly solverId: string;
      readonly commitment: string;
      readonly at: number;
    }
  | {
      readonly type: "settlement-succeeded";
      readonly intentId: `0x${string}`;
      readonly solverId: string;
      readonly actualAmount: string;
      readonly settlementRef: string;
      readonly at: number;
    }
  | {
      readonly type: "settlement-failed";
      readonly intentId: `0x${string}`;
      readonly solverId: string;
      readonly error: string;
      readonly at: number;
    }
  | {
      readonly type: "payment-gated";
      readonly intentId: `0x${string}`;
      readonly failedRuleIds: ReadonlyArray<string>;
      readonly at: number;
    };

/** Audit sink contract. */
export interface AuditSink {
  emit(event: IntentRouterAuditEvent): Promise<void> | void;
}

// ─── Router orchestration result ───────────────────────────────

/**
 * The end-to-end router output. Always returned (not thrown) so UIs
 * can show partial failures and audit pipelines can persist every
 * attempt.
 */
export interface IntentExecutionResult {
  readonly intentId: `0x${string}`;
  readonly outcome:
    | { readonly kind: "fulfilled"; readonly winningQuote: Quote; readonly fill: Fill }
    | { readonly kind: "no-quotes"; readonly solversTried: ReadonlyArray<string> }
    | {
        readonly kind: "settlement-failed";
        readonly winningQuote: Quote;
        readonly error: string;
      }
    | {
        readonly kind: "payment-gated";
        readonly evaluation: VcGateEvaluation;
      };
  readonly quotes: ReadonlyArray<Quote>;
  readonly attemptedAt: number;
  readonly completedAt: number;
}

// ─── Re-exports ────────────────────────────────────────────────

export type { TypedDataDomain, TypedDataField, TypedDataSigner };
