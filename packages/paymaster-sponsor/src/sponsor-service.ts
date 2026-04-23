/**
 * `SponsorService` — the end-to-end orchestrator.
 *
 * Pipeline on every sponsorship request:
 *
 *    1. Validate request shape + re-compute userOp hash, assert match.
 *    2. Fetch a fresh price quote; reject if stale.
 *    3. Price the UserOp (gas → USDC).
 *    4. Evaluate the sponsor policy against the priced request.
 *    5. Derive a deterministic requestId.
 *    6. Record an "approved" ledger entry (nonce guard).
 *    7. Sign the paymaster approval.
 *    8. Return the sponsorship response.
 *
 * Failures at any stage throw `PaymasterSponsorError` with the
 * right code so callers (HTTP layer, bundler) map to a 4xx/5xx
 * directly.
 *
 * Separately, `SponsorService.reconcile(requestId, txHash, at)` is
 * called by the reconciliation worker when it observes the on-chain
 * settlement event. That's the moment the ledger flips from
 * `approved` to `settled`.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";

import type {
  PriceOracle,
  SettlementLedger,
  SponsorPolicy,
  SponsorshipApproval,
  SponsorshipRecord,
  SponsorshipRequest,
} from "./types";
import { PaymasterSponsorError, type PaymasterSponsorErrorCode } from "./errors";
import { GasPricer } from "./gas-pricer";
import { assertQuoteFresh } from "./price-oracle";
import { PaymasterSigner } from "./paymaster-signer";
import {
  computeUserOpHash,
  packUserOperation,
  type UserOperation,
} from "@aethelred/wallet-smart-account";

export interface SponsorServiceConfig {
  readonly oracle: PriceOracle;
  readonly stable: `0x${string}`;
  readonly pricer: GasPricer;
  readonly policy: SponsorPolicy;
  readonly ledger: SettlementLedger;
  readonly paymasterSigner: PaymasterSigner;
  /** Default stable this service sponsors — defaults to `config.stable`. */
  /** Max price quote age in ms. Default: 60_000. */
  readonly maxQuoteAgeMs?: number;
  /** Supported chains. Request chainId must be in this set. */
  readonly supportedChainIds: ReadonlyArray<number>;
  /** Clock override for tests. */
  readonly now?: () => number;
}

export class SponsorService {
  private readonly oracle: PriceOracle;
  private readonly stable: `0x${string}`;
  private readonly pricer: GasPricer;
  private readonly policy: SponsorPolicy;
  private readonly ledger: SettlementLedger;
  private readonly paymasterSigner: PaymasterSigner;
  private readonly maxQuoteAgeMs: number;
  private readonly supportedChainIds: ReadonlySet<number>;
  private readonly now: () => number;
  private disposed = false;

  constructor(config: SponsorServiceConfig) {
    this.oracle = config.oracle;
    this.stable = config.stable;
    this.pricer = config.pricer;
    this.policy = config.policy;
    this.ledger = config.ledger;
    this.paymasterSigner = config.paymasterSigner;
    this.maxQuoteAgeMs = config.maxQuoteAgeMs ?? 60_000;
    this.supportedChainIds = new Set(config.supportedChainIds);
    this.now = config.now ?? (() => Date.now());
  }

  get paymasterAddress(): `0x${string}` {
    return this.paymasterSigner.paymasterAddress;
  }

  /** End-to-end sponsorship. Throws on any failure. */
  async sponsor(request: SponsorshipRequest): Promise<SponsorshipApproval> {
    this.ensureAlive();
    this.validateRequest(request);

    // 1-2. Oracle + freshness.
    const quote = await this.oracle.fetchQuote(request.chainId, this.stable);
    assertQuoteFresh(quote, this.maxQuoteAgeMs, this.now());

    // 3. Price.
    const priced = this.pricer.price(request.userOp, quote);

    // 4. Policy (needs ledger state for rate-limit policies).
    const ledgerState = await this.ledger.listByAgent(request.agentId);
    const policyResult = await this.policy.evaluate({
      request,
      priceQuote: quote,
      computedUsdcCost: priced.usdcCost,
      ledgerState,
      now: this.now(),
    });
    if (!policyResult.allowed) {
      throw new PaymasterSponsorError(
        (policyResult.reasonCode ?? "policy-denied") as PaymasterSponsorErrorCode,
        policyResult.reason ?? "sponsor policy denied",
        { details: policyResult.details },
      );
    }

    // 5. Deterministic request id.
    const validAfter = request.validAfter ?? 0;
    const requestId = buildRequestId({
      userOpHash: request.expectedUserOpHash,
      validUntil: request.validUntil,
      validAfter,
      priceQuoteId: quote.id,
    });

    // 6. Record approved (ledger duplicates → request-id-reused).
    const record: SponsorshipRecord = {
      requestId,
      userOpHash: request.expectedUserOpHash,
      agentId: request.agentId,
      chainId: request.chainId,
      usdcCost: priced.usdcCost,
      paymaster: this.paymasterAddress,
      priceQuoteId: quote.id,
      status: "approved",
      approvedAt: this.now(),
    };
    await this.ledger.record(record);

    // 7. Sign.
    let signed;
    try {
      signed = await this.paymasterSigner.sign({
        userOpHash: request.expectedUserOpHash,
        validUntil: request.validUntil,
        validAfter,
        paymasterVerificationGas: priced.paymasterVerificationGas,
        paymasterPostOpGas: priced.paymasterPostOpGas,
        chainId: request.chainId,
      });
    } catch (cause) {
      throw new PaymasterSponsorError(
        "paymaster-signer-error",
        cause instanceof Error ? cause.message : "signer threw",
        { cause },
      );
    }

    // 8. Return.
    return {
      requestId,
      paymaster: this.paymasterAddress,
      paymasterData: signed.paymasterData,
      paymasterVerificationGasLimit: priced.paymasterVerificationGas,
      paymasterPostOpGasLimit: priced.paymasterPostOpGas,
      usdcCost: priced.usdcCost,
      priceQuote: quote,
      validAfter,
      validUntil: request.validUntil,
      signedAt: record.approvedAt,
    };
  }

  /**
   * Mark a previously-approved sponsorship as settled. Called by
   * the reconciliation worker when it sees the on-chain tx land.
   */
  async reconcile(requestId: `0x${string}`, txHash: `0x${string}`): Promise<void> {
    this.ensureAlive();
    await this.ledger.markSettled(requestId, txHash, this.now());
  }

  /**
   * Mark a sponsorship expired — called by the expiry sweeper when
   * `validUntil` elapses without reconciliation. Idempotent.
   */
  async expire(requestId: `0x${string}`): Promise<void> {
    this.ensureAlive();
    await this.ledger.markExpired(requestId, this.now());
  }

  dispose(): void {
    this.disposed = true;
  }

  // ─── Private ─────────────────────────────────────────────

  private ensureAlive(): void {
    if (this.disposed) {
      throw new PaymasterSponsorError(
        "service-disposed",
        "SponsorService has been disposed",
      );
    }
  }

  private validateRequest(request: SponsorshipRequest): void {
    if (!this.supportedChainIds.has(request.chainId)) {
      throw new PaymasterSponsorError(
        "chain-id-unsupported",
        `chain ${request.chainId} not supported`,
      );
    }
    if (request.validAfter !== undefined && request.validAfter >= request.validUntil) {
      throw new PaymasterSponsorError(
        "request-malformed",
        `validAfter ${request.validAfter} must be < validUntil ${request.validUntil}`,
      );
    }
    if (request.validUntil <= Math.floor(this.now() / 1000)) {
      throw new PaymasterSponsorError(
        "request-malformed",
        `validUntil ${request.validUntil} is in the past`,
      );
    }

    const recomputed = reconstructUserOpHash(
      request.userOp,
      request.entryPoint,
      request.chainId,
    );
    if (recomputed.toLowerCase() !== request.expectedUserOpHash.toLowerCase()) {
      throw new PaymasterSponsorError(
        "userop-hash-mismatch",
        `expectedUserOpHash ${request.expectedUserOpHash} does not match recomputed ${recomputed}`,
        { details: { expected: request.expectedUserOpHash, actual: recomputed } },
      );
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────

function reconstructUserOpHash(
  userOp: UserOperation,
  entryPoint: `0x${string}`,
  chainId: number,
): `0x${string}` {
  return computeUserOpHash(packUserOperation(userOp, entryPoint, chainId), entryPoint, chainId);
}

export function buildRequestId(params: {
  readonly userOpHash: `0x${string}`;
  readonly validUntil: number;
  readonly validAfter: number;
  readonly priceQuoteId: `0x${string}`;
}): `0x${string}` {
  const preimage = new TextEncoder().encode(
    [
      params.userOpHash.toLowerCase(),
      String(params.validUntil),
      String(params.validAfter),
      params.priceQuoteId.toLowerCase(),
    ].join("|"),
  );
  const digest = keccak_256(preimage);
  let hex = "0x";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}
