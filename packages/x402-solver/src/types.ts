/**
 * `@aethelred/wallet-x402-solver` — type surface.
 *
 * Three logical shapes:
 *
 *   1. Config consumed at `X402FacilitatorSolver` construction.
 *   2. Quote metadata the solver stamps into each returned `Quote`
 *      so auditors can correlate solver decisions post-hoc.
 *   3. Fill metadata the solver stamps into each returned `Fill` —
 *      typically the underlying x402 receipt reference.
 *
 * We deliberately re-export a narrow set of upstream types from
 * `@aethelred/wallet-x402` + `@aethelred/wallet-intent-router` so
 * consumers of the solver need only ONE import, not three.
 */

import type {
  AttestationProvider,
  AuditHook,
  PaymentNetwork,
  PaymentReceipt,
  TypedDataSigner,
} from "@aethelred/wallet-x402";

import type {
  Intent,
  PaymentIntentBody,
  Quote,
  Fill,
  Solver,
} from "@aethelred/wallet-intent-router";

// ─── Config ────────────────────────────────────────────────

export interface X402FacilitatorSolverConfig {
  /**
   * Stable solver id — surfaces in every Quote + Fill + audit
   * event. Choose something stable across deploys (a uuid or a
   * slug like `x402-facilitator-base-mainnet`).
   */
  readonly id: string;

  /** Human-readable label. Shown in dashboards + audit logs. */
  readonly name: string;

  /**
   * Signer for the EIP-3009 authorization. Typically any
   * `CustodyAdapter.asTypedDataSigner()` from the custody-adapters
   * package — LocalKey for tests, Nitro / Ledger / Shamir /
   * Fireblocks for production.
   *
   * The signer's `address` becomes the `from` field of the EIP-3009
   * authorization; the intent's `creator` MUST match.
   */
  readonly signer: TypedDataSigner;

  /**
   * Optional TEE attestation provider. Required for paying
   * attestation-gated x402 resources. When absent, the solver
   * gracefully declines attestation-required intents (returns null
   * from quote instead of throwing).
   */
  readonly attestation?: AttestationProvider;

  /**
   * Optional audit sink. Receives the same `x402-pay-start /
   * x402-pay-success / x402-pay-failure` events `x402Fetch`
   * produces, plus solver-level outcome events.
   */
  readonly audit?: AuditHook;

  /**
   * `fetch` override — test harnesses pass a stubbed
   * `fetch`-compatible function. Production uses `globalThis.fetch`.
   */
  readonly fetch?: typeof fetch;

  /**
   * Networks this solver supports. If present, intents whose
   * resolved `PaymentRequirement` specifies a network outside
   * this list are declined at quote time. When absent (default),
   * the solver accepts any network the facilitator supports.
   *
   * Operator-side narrowing — useful when running a solver instance
   * pinned to a single chain's RPC.
   */
  readonly supportedNetworks?: ReadonlyArray<PaymentNetwork>;

  /**
   * Quote validity in ms. The returned Quote.expiresAt is
   * `now + quoteValidityMs`. Default: 60_000 (1 minute).
   */
  readonly quoteValidityMs?: number;

  /**
   * Estimated fill time declared on each quote. Used by the
   * `fastestFill` comparator. Default: 1500ms (a network hop +
   * facilitator verify + broadcast + confirm).
   */
  readonly estimatedFillTimeMs?: number;

  /**
   * Clock override for deterministic testing.
   */
  readonly now?: () => number;

  /**
   * Optional balance pre-flight check (PR #105). When set, the
   * solver queries the agent's balance at `settle()` time —
   * BEFORE calling `x402Fetch` — and throws
   * `pre-flight-insufficient-balance` if it's less than the
   * intent's `maxAmount`.
   *
   * Saves the round-trip of HTTP request + EIP-712 sign +
   * facilitator on-chain submission on doomed payments and
   * surfaces a clear, structured error rather than an opaque
   * facilitator `transferWithAuthorization` revert.
   *
   * **Why check `maxAmount`, not the actual paid amount?** The
   * facilitator returns the actual `maxAmountRequired` only
   * AFTER the HTTP roundtrip. To fail-fast we have to commit
   * to a check BEFORE `x402Fetch`. `intent.body.maxAmount` is
   * the ceiling agents authorize — strictly a superset of what
   * could actually be paid. If the pre-flight passes, every
   * payment ≤ maxAmount will succeed too.
   *
   * Receives the agent's signer address (`config.signer.address`)
   * and the asset (ERC-20 contract address from
   * `intent.body.asset`). Returns the balance in the asset's
   * smallest unit.
   *
   * **Symmetric to:**
   *   - PR #97's swap-allowance pre-flight in
   *     `@aethelred/wallet-swap-venue-uniswap-v3` —
   *     `skipApproveWhenSufficient + agentAddress`
   *   - PR #101's transfer-balance pre-flight in
   *     `@aethelred/wallet-transfer-solver` — `balancePreflight`
   *
   * The x402 solver doesn't include an `eth_call` transport
   * (the existing config is HTTP-only against the facilitator),
   * so operators wire this callback over their own RPC adapter.
   * The convenience encoders
   * `encodeErc20BalanceOf` / `decodeErc20BalanceOfResult`
   * exported by `@aethelred/wallet-transfer-solver` (PR #101)
   * are ABI-compatible and reusable here:
   *
   * ```ts
   * import {
   *   encodeErc20BalanceOf,
   *   decodeErc20BalanceOfResult,
   * } from "@aethelred/wallet-transfer-solver";
   *
   * const balancePreflight = async (owner, asset) => {
   *   const result = await rpc.call("eth_call", [
   *     { to: asset, data: encodeErc20BalanceOf(owner) },
   *     "latest",
   *   ]);
   *   return decodeErc20BalanceOfResult(result);
   * };
   * ```
   *
   * **Fail-OPEN semantics.** If the callback throws (RPC flake,
   * transient network), the solver swallows and proceeds with
   * `x402Fetch` — pre-flight is an optimization, never a
   * correctness gate. The
   * `pre-flight-insufficient-balance` throw fires only when
   * the callback returns a balance LESS THAN `maxAmount`.
   *
   * Default: undefined (no pre-flight; preserves PR #66's v0.1
   * behavior).
   */
  readonly balancePreflight?: (
    owner: `0x${string}`,
    asset: `0x${string}`,
  ) => Promise<bigint>;
}

// ─── Quote + Fill metadata ─────────────────────────────────

/**
 * Extra fields the solver embeds in `Quote.metadata`. Audit-only —
 * the router doesn't inspect the contents. Consumers that index on
 * metadata type-assert against this interface.
 *
 * Index signature extends the declared shape to match the router's
 * `Quote.metadata: Readonly<Record<string, unknown>>` contract.
 */
export interface X402SolverQuoteMetadata {
  readonly solverClass: "x402-facilitator";
  readonly supportedNetworks?: ReadonlyArray<PaymentNetwork>;
  readonly attestationAvailable: boolean;
  readonly resource: string;
  readonly [key: string]: unknown;
}

/**
 * Extra fields the solver embeds in `Fill.metadata`. The underlying
 * `PaymentReceipt` is carried through so consumers wanting the
 * on-chain tx hash (for reconciliation) can reach it.
 *
 * Index signature extends the declared shape to match the router's
 * `Fill.metadata: Readonly<Record<string, unknown>>` contract.
 */
export interface X402SolverFillMetadata {
  readonly solverClass: "x402-facilitator";
  readonly paymentReceipt: PaymentReceipt;
  readonly httpStatus: number;
  readonly [key: string]: unknown;
}

// ─── Narrow re-exports ─────────────────────────────────────

export type {
  Intent,
  PaymentIntentBody,
  Quote,
  Fill,
  Solver,
  PaymentNetwork,
  PaymentReceipt,
  TypedDataSigner,
};
