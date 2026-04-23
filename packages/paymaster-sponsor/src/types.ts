/**
 * `@aethelred/wallet-paymaster-sponsor` — type surface.
 *
 * The sponsor service sits between:
 *
 *   - **Bundler / wallet** — submits a UserOperation it wants paid
 *     for in USDC.
 *   - **Sponsor** — the service here. Decides whether to sponsor
 *     (policy gates), prices the gas in USDC, signs a
 *     VerifyingPaymaster-compatible approval.
 *   - **Paymaster contract** — on-chain. Validates the approval
 *     signature at UserOp execution time, pulls USDC from the
 *     sender, pays ETH gas to the bundler.
 *
 * The sponsor service NEVER holds user funds. The USDC transfer is
 * authorised off-chain (EIP-3009 / Permit) and settles on-chain
 * when the paymaster contract validates the approval. Atomic: if
 * the UserOp execution fails, the USDC transfer doesn't happen.
 *
 * @packageDocumentation
 */

import type { UserOperation } from "@aethelred/wallet-smart-account";
import type { SerializedVcGate } from "@aethelred/wallet-reputation";

// ─── Price oracle ───────────────────────────────────────────────

/**
 * Spot price quote. Units are always the smaller-unit integer (wei
 * for ETH, 10^-6 USDC for USDC). `asOf` is the unix-ms timestamp
 * the oracle sourced the price; callers reject quotes older than
 * their staleness threshold.
 */
export interface PriceQuote {
  /** Quote id — `keccak256(oracleId || asOf || nativeToStable)`. */
  readonly id: `0x${string}`;
  /** Oracle name — audit-only, does NOT affect pricing logic. */
  readonly oracleId: string;
  /** Chain id the quote applies to. */
  readonly chainId: number;
  /**
   * How many units of stable per unit of native — scaled 1e18 for
   * fixed-point precision. Example: if ETH/USDC is 2500, we store
   * 2500_000000_000000000000 (2500 * 1e18).
   */
  readonly nativePerStableScaled: bigint;
  readonly asOf: number;
  /** Native asset identifier (e.g. "eth"). */
  readonly native: string;
  /** Stable asset contract address. */
  readonly stable: `0x${string}`;
  /** Stable's decimal count (USDC = 6). */
  readonly stableDecimals: number;
}

/**
 * Pluggable oracle. `FixedPriceOracle` ships for tests;
 * `CachingPriceOracle` wraps any inner oracle with a TTL so every
 * sponsorship request doesn't hit the underlying RPC.
 */
export interface PriceOracle {
  readonly id: string;
  fetchQuote(chainId: number, stable: `0x${string}`): Promise<PriceQuote>;
}

// ─── Sponsorship request / response ─────────────────────────────

/**
 * What a bundler / wallet submits to the sponsor.
 *
 * `userOp` is unsigned at this point (or has a placeholder
 * signature) — the paymaster approval has to be baked into
 * `paymasterAndData` before the owner signs the full userOp.
 *
 * `agentId` identifies the requesting agent for policy
 * evaluation. May be the smart-account sender address or the
 * underlying owner EOA — operator choice.
 */
export interface SponsorshipRequest {
  readonly userOp: UserOperation;
  readonly chainId: number;
  readonly entryPoint: `0x${string}`;
  readonly agentId: `0x${string}`;
  /**
   * Pre-computed userOp hash the caller believes is correct. The
   * service recomputes and compares — mismatch → userop-hash-mismatch.
   * Caller-side hashing catches many integration bugs early.
   */
  readonly expectedUserOpHash: `0x${string}`;
  /** Optional: attach pre-authorised EIP-3009 / Permit for the USDC side. */
  readonly prepayment?: {
    readonly scheme: "eip-3009" | "permit";
    readonly calldata: `0x${string}`;
    readonly maxAmount: string;
  };
  /** Timestamp the client is willing to have the approval valid UNTIL (unix seconds). */
  readonly validUntil: number;
  /** Optional validAfter (unix seconds); defaults to 0. */
  readonly validAfter?: number;
}

export interface SponsorshipApproval {
  /** `keccak256(userOpHash || validUntil || validAfter || priceQuote.id)` */
  readonly requestId: `0x${string}`;
  /** Paymaster contract address. */
  readonly paymaster: `0x${string}`;
  /**
   * Bytes the UserOp's `paymasterAndData` must carry:
   *
   *   paymasterAddress (20) || verificationGas (16) || postOpGas (16)
   *     || validUntil (6) || validAfter (6) || signature (65)
   *
   * Returned as a single hex blob ready to splat into the UserOp
   * builder via `setPaymaster({ paymasterData: ... })`.
   */
  readonly paymasterData: `0x${string}`;
  readonly paymasterVerificationGasLimit: bigint;
  readonly paymasterPostOpGasLimit: bigint;
  /** USDC the sponsor will collect on success. */
  readonly usdcCost: bigint;
  readonly priceQuote: PriceQuote;
  readonly validAfter: number;
  readonly validUntil: number;
  readonly signedAt: number;
}

// ─── Policy ────────────────────────────────────────────────────

/**
 * Policy input — everything a gate needs to accept/reject a
 * sponsorship. Kept separate from `SponsorshipRequest` so callers
 * can compose gates without threading request fields everywhere.
 */
export interface PolicyContext {
  readonly request: SponsorshipRequest;
  readonly priceQuote: PriceQuote;
  readonly computedUsdcCost: bigint;
  readonly ledgerState: ReadonlyArray<SponsorshipRecord>;
  readonly now: number;
}

export interface PolicyResult {
  readonly allowed: boolean;
  readonly reasonCode?:
    | "policy-denied"
    | "rate-limit-exceeded"
    | "agent-blocked"
    | "kill-switch-engaged"
    | "insufficient-prepayment";
  readonly reason?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface SponsorPolicy {
  readonly id: string;
  evaluate(ctx: PolicyContext): Promise<PolicyResult>;
}

// ─── Ledger ────────────────────────────────────────────────────

export type SponsorshipStatus = "approved" | "settled" | "expired" | "rejected";

/**
 * One entry per sponsorship attempt. Retained permanently; audit
 * pipelines replay.
 */
export interface SponsorshipRecord {
  readonly requestId: `0x${string}`;
  readonly userOpHash: `0x${string}`;
  readonly agentId: `0x${string}`;
  readonly chainId: number;
  readonly usdcCost: bigint;
  readonly paymaster: `0x${string}`;
  readonly priceQuoteId: `0x${string}`;
  readonly status: SponsorshipStatus;
  readonly approvedAt: number;
  readonly settledAt?: number;
  readonly settlementTxHash?: `0x${string}`;
  readonly rejectedReason?: string;
}

export interface SettlementLedger {
  record(record: SponsorshipRecord): Promise<void>;
  getByRequestId(id: `0x${string}`): Promise<SponsorshipRecord | null>;
  listByAgent(
    agentId: `0x${string}`,
    opts?: { readonly since?: number; readonly limit?: number },
  ): Promise<ReadonlyArray<SponsorshipRecord>>;
  markSettled(
    requestId: `0x${string}`,
    txHash: `0x${string}`,
    settledAt: number,
  ): Promise<void>;
  markExpired(requestId: `0x${string}`, at: number): Promise<void>;
}

// ─── VC gate plumbing ─────────────────────────────────────────

/** Re-export for consumers composing sponsor-side VC gates. */
export type { SerializedVcGate };
