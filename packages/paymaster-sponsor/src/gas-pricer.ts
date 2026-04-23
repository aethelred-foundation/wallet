/**
 * Gas pricer.
 *
 * Given a UserOperation's declared gas parameters and a price quote,
 * compute how much USDC the sponsor will require in exchange for
 * paying the ETH gas.
 *
 * The formula:
 *
 *     gasInNative = (callGasLimit + verificationGasLimit
 *                   + preVerificationGas + paymasterVerificationGasLimit
 *                   + paymasterPostOpGasLimit) * maxFeePerGas
 *
 *     usdcCost = ceil(gasInNative * 10^stableDecimals
 *                     / priceQuote.nativePerStableScaled) * markupBps / 10000
 *
 * `markupBps` is the operator's margin (default 500 = 5%). Operators
 * tune this to cover oracle risk + operations cost; we don't bake
 * a specific number into the pricer.
 *
 * We do NOT price `maxPriorityFeePerGas` separately — in EIP-1559
 * the priority fee is capped by the max fee, so charging the full
 * max fee is the conservative (over-)estimate. The paymaster
 * contract refunds the difference after the UserOp executes.
 */

import type { UserOperation } from "@aethelred/wallet-smart-account";

import type { PriceQuote } from "./types";
import { PaymasterSponsorError } from "./errors";
import { PRICE_SCALE } from "./price-oracle";

export interface GasPricerConfig {
  /** Basis-points markup. Default: 500 (5%). */
  readonly markupBps?: number;
  /**
   * Paymaster verification gas — the budget the paymaster contract
   * reserves for signature validation. Default: 50_000.
   */
  readonly paymasterVerificationGas?: bigint;
  /**
   * Paymaster post-op gas — the budget for the paymaster's settle-
   * USDC step. Default: 50_000.
   */
  readonly paymasterPostOpGas?: bigint;
}

export interface PricedOperation {
  readonly totalGasUnits: bigint;
  readonly totalGasNative: bigint;
  readonly usdcBeforeMarkup: bigint;
  readonly usdcCost: bigint;
  readonly paymasterVerificationGas: bigint;
  readonly paymasterPostOpGas: bigint;
}

export class GasPricer {
  private readonly markupBps: number;
  readonly paymasterVerificationGas: bigint;
  readonly paymasterPostOpGas: bigint;

  constructor(config: GasPricerConfig = {}) {
    this.markupBps = config.markupBps ?? 500;
    if (this.markupBps < 0 || this.markupBps > 10_000) {
      throw new PaymasterSponsorError(
        "policy-denied",
        `markupBps ${this.markupBps} out of range [0, 10000]`,
      );
    }
    this.paymasterVerificationGas = config.paymasterVerificationGas ?? 50_000n;
    this.paymasterPostOpGas = config.paymasterPostOpGas ?? 50_000n;
  }

  /**
   * Compute the USDC cost for a UserOperation at a given price quote.
   *
   * Overflow-safe: we do every multiplication in bigint and check
   * the intermediate fits in 256 bits before the division.
   */
  price(op: UserOperation, quote: PriceQuote): PricedOperation {
    // Sum every gas-consuming budget the paymaster covers. Paymaster
    // gas fields are optional on the input op; we include OUR defaults
    // when the caller hasn't filled them in.
    const pmVerif = op.paymasterVerificationGasLimit ?? this.paymasterVerificationGas;
    const pmPostOp = op.paymasterPostOpGasLimit ?? this.paymasterPostOpGas;

    const totalGas =
      op.callGasLimit +
      op.verificationGasLimit +
      op.preVerificationGas +
      pmVerif +
      pmPostOp;

    if (totalGas < 0n) {
      throw new PaymasterSponsorError(
        "userop-malformed",
        `totalGas is negative: ${totalGas}`,
      );
    }
    if (totalGas > 1n << 64n) {
      throw new PaymasterSponsorError(
        "gas-overflow",
        `totalGas ${totalGas} exceeds 2^64 sanity bound`,
      );
    }

    const totalNative = totalGas * op.maxFeePerGas;
    if (totalNative > 1n << 200n) {
      throw new PaymasterSponsorError(
        "gas-overflow",
        `totalNative ${totalNative} exceeds 2^200 sanity bound`,
      );
    }

    // usdcBeforeMarkup = ceil(totalNative * 10^stableDecimals / nativePerStableScaled)
    // nativePerStableScaled is already 1e18-scaled; stable conversion
    // is (value * 10^stableDecimals) / PRICE_SCALE.
    //
    // Math sketch: if nativePerStable = 2500 (ETH per USDC), then
    // (wei / 2500_1e18) * 1e6 gives USDC in 10^-6 units. The 1e18
    // in the denominator is the PRICE_SCALE; the 1e6 (or whatever
    // stableDecimals demands) compensates for USDC's 6-decimal
    // representation.
    const stableFactor = 10n ** BigInt(quote.stableDecimals);
    const numerator = totalNative * stableFactor;
    const denominator = quote.nativePerStableScaled;
    if (denominator === 0n) {
      throw new PaymasterSponsorError(
        "price-unavailable",
        "price quote has zero denominator",
      );
    }
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    const usdcBeforeMarkup = remainder === 0n ? quotient : quotient + 1n; // ceil

    // Apply markup: usdcCost = ceil(usdcBeforeMarkup * (10000 + markupBps) / 10000)
    const bpsNumerator = usdcBeforeMarkup * BigInt(10_000 + this.markupBps);
    const bpsQuotient = bpsNumerator / 10_000n;
    const bpsRemainder = bpsNumerator % 10_000n;
    const usdcCost = bpsRemainder === 0n ? bpsQuotient : bpsQuotient + 1n;

    return {
      totalGasUnits: totalGas,
      totalGasNative: totalNative,
      usdcBeforeMarkup,
      usdcCost,
      paymasterVerificationGas: pmVerif,
      paymasterPostOpGas: pmPostOp,
    };
  }
}

/** Pure helper — exposed for unit tests. */
export function scalePrice(nativePerStable: number, stableDecimals: number): bigint {
  // Fixed-point conversion keeping 6 decimals of precision on the
  // input. Matches FixedPriceOracle's internal behaviour so tests
  // can round-trip without surprises.
  void stableDecimals;
  return BigInt(Math.round(nativePerStable * 1e6)) * (PRICE_SCALE / 10n ** 6n);
}
