/**
 * Gas-fee-bump / speed-up / cancel primitives for replacing pending
 * transactions. This is the MetaMask-parity feature that lets a user
 * who has a stuck pending tx either (a) bump the fees so it clears
 * sooner, or (b) replace it with a zero-value self-send on the same
 * nonce to effectively cancel it.
 *
 * Math-only module — no signing, no broadcast, no storage. Downstream
 * callers take the shaped replacement tx, run it through the usual
 * `prepare-tx`/`execute-tx` bridge flow (so policy engine still applies),
 * and broadcast the signed result.
 *
 * Ethereum consensus rule (EIP-1559 §node mempool policy):
 *   A replacement tx on the same (sender, nonce) pair must bump BOTH
 *   `maxFeePerGas` AND `maxPriorityFeePerGas` by STRICTLY MORE THAN 10%
 *   — same semantics legacy txs enforced on `gasPrice` before London.
 *   Miners/validators reject the replacement otherwise, leaving the
 *   original stuck. Most implementations use 11% (10% + 1 safety point)
 *   which is what we default to here.
 *
 * All arithmetic is bigint-only. A previous draft cast to Number for
 * the percent math and lost precision at wei-scale; see the explicit
 * `bumpByPercent` helper which does (value * (100 + p)) / 100 entirely
 * in bigints.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Typed error raised when a replacement can't be computed — e.g. a
 * legacy tx is missing `gasPrice`, an EIP-1559 tx is missing its fee
 * fields, or the caller requested a sub-10% bump which the network
 * would reject.
 */
export class GasReplacementError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GasReplacementError";
    this.code = code;
  }
}

export interface OriginalTransaction {
  nonce: number;
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
  chainId: number;
  type: "eip1559" | "legacy";
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasPrice?: bigint;
  gasLimit: bigint;
}

export interface ReplacementGasSuggestion {
  /** Minimum % gas bump applied on top of the original values. */
  minBumpPercent: number;
  /** Suggested gas for "speed up" (bumps fees to achieve faster inclusion). */
  speedUp: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasPrice?: bigint };
  /** Suggested gas for "cancel" (zero-value self-send with same nonce + bumped fees). */
  cancel: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; gasPrice?: bigint };
}

/* ─── Internal helpers ──────────────────────────────────────── */

/**
 * Strict greater-than-10% bump: the mempool rule is `new > old * 1.10`,
 * not `>=`, so a straight 10% bump gets rejected. We default to 11%.
 *
 * Implemented as `ceil(value * (100 + percent) / 100)` to:
 *   (a) keep everything in bigints (no float precision loss at wei scale), and
 *   (b) round UP rather than down — a down-round of a wei-granular value
 *       can leave us a single wei below the 10% threshold and get rejected.
 *
 * `percent` is an integer percentage. Fractional percents aren't
 * supported by design — if a caller wants "11.5%" they should bump with
 * 12%.
 */
function bumpByPercent(value: bigint, percent: number): bigint {
  if (!Number.isInteger(percent) || percent <= 0) {
    throw new GasReplacementError(
      "INVALID_BUMP_PERCENT",
      `bump percent must be a positive integer, got ${percent}`,
    );
  }
  // Guard the bigint multiplication: JS bigints are arbitrary-precision
  // so we don't actually overflow, but negative `value` would flip the
  // ceil semantics. Callers should never pass negatives but we defend.
  if (value < 0n) {
    throw new GasReplacementError("INVALID_GAS_VALUE", `gas value must be non-negative, got ${value}`);
  }
  const num = value * BigInt(100 + percent);
  const den = 100n;
  // Ceil-divide: (num + den - 1) / den — equivalent to Math.ceil for
  // non-negative integers, no floats involved.
  return (num + den - 1n) / den;
}

/** Minimum priority fee floor in wei (1 gwei). Protects against an
 *  original tx that set priority to e.g. 1 wei — bumping that by 11%
 *  still produces a priority of ~1 wei which no miner will include. */
const MIN_PRIORITY_FEE_FLOOR_WEI = 1_000_000_000n;

/** Minimum gas price floor for legacy txs (1 gwei). */
const MIN_LEGACY_GAS_PRICE_FLOOR_WEI = 1_000_000_000n;

/** Return the max of two bigints. */
function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

/* ─── Public API ────────────────────────────────────────────── */

/**
 * Compute the suggested gas numbers for both a "speed up" and a
 * "cancel" replacement of `original`. Does NOT mutate `original`.
 *
 * Behaviour:
 *   - EIP-1559: bumps BOTH `maxFeePerGas` AND `maxPriorityFeePerGas`
 *     by `bumpPercent` (default 11). Applies a 1 gwei floor to the
 *     priority tip so low-priority originals aren't replaced with
 *     still-unincludeable fees. If `networkBaseFeePerGas` is supplied,
 *     ensures `maxFeePerGas >= baseFee + maxPriorityFeePerGas` so the
 *     replacement is actually payable on the current head.
 *   - Legacy: bumps `gasPrice` by `bumpPercent` with a 1 gwei floor.
 *
 * The speed-up and cancel suggestions are identical fee-wise — the
 * distinction lives in the tx body (to/value/data), not the gas.
 */
export function computeReplacementGas(
  original: OriginalTransaction,
  options?: {
    bumpPercent?: number;
    networkBaseFeePerGas?: bigint;
  },
): ReplacementGasSuggestion {
  const bumpPercent = options?.bumpPercent ?? 11;
  if (bumpPercent < 10) {
    // Strictly less than the network's 10% rule — we allow exactly 10
    // via `=== 10` (caller's problem if the mempool rejects; some
    // private nodes accept it) but never below.
    throw new GasReplacementError(
      "BUMP_TOO_LOW",
      `bump percent ${bumpPercent} is below the EIP-1559 minimum of 10%`,
    );
  }

  if (original.type === "eip1559") {
    if (original.maxFeePerGas === undefined || original.maxPriorityFeePerGas === undefined) {
      throw new GasReplacementError(
        "MISSING_FEE_FIELDS",
        "EIP-1559 original tx requires maxFeePerGas and maxPriorityFeePerGas",
      );
    }
    const bumpedPriority = maxBig(
      bumpByPercent(original.maxPriorityFeePerGas, bumpPercent),
      MIN_PRIORITY_FEE_FLOOR_WEI,
    );
    let bumpedMaxFee = maxBig(
      bumpByPercent(original.maxFeePerGas, bumpPercent),
      // maxFeePerGas must never be below the priority tip (otherwise
      // the tx is nonsensical — `min(baseFee, maxFee - priority)`
      // would be negative).
      bumpedPriority,
    );
    if (options?.networkBaseFeePerGas !== undefined) {
      // Guarantee the replacement is includeable at the current base
      // fee. If the caller-supplied base fee has risen above the
      // original maxFee, we floor the replacement to `base + priority`.
      const minFloor = options.networkBaseFeePerGas + bumpedPriority;
      bumpedMaxFee = maxBig(bumpedMaxFee, minFloor);
    }
    const gas = {
      maxFeePerGas: bumpedMaxFee,
      maxPriorityFeePerGas: bumpedPriority,
    };
    return {
      minBumpPercent: bumpPercent,
      speedUp: { ...gas },
      cancel: { ...gas },
    };
  }

  // Legacy path
  if (original.gasPrice === undefined) {
    throw new GasReplacementError(
      "MISSING_FEE_FIELDS",
      "legacy original tx requires gasPrice",
    );
  }
  const bumpedGasPrice = maxBig(
    bumpByPercent(original.gasPrice, bumpPercent),
    MIN_LEGACY_GAS_PRICE_FLOOR_WEI,
  );
  // For consistency in the return shape we stamp maxFeePerGas /
  // maxPriorityFeePerGas to the same value — downstream code that
  // doesn't care about the tx type can treat them as equivalent
  // "effective gas price" numbers without a conditional.
  return {
    minBumpPercent: bumpPercent,
    speedUp: {
      maxFeePerGas: bumpedGasPrice,
      maxPriorityFeePerGas: bumpedGasPrice,
      gasPrice: bumpedGasPrice,
    },
    cancel: {
      maxFeePerGas: bumpedGasPrice,
      maxPriorityFeePerGas: bumpedGasPrice,
      gasPrice: bumpedGasPrice,
    },
  };
}

/**
 * Build a "speed up" replacement tx — same recipient, same value,
 * same calldata, same nonce, bumped gas. The returned object has the
 * same shape as the input so callers can feed it back through
 * `prepare-tx` without massaging types.
 */
export function buildSpeedUpTransaction(
  original: OriginalTransaction,
  suggestion: ReplacementGasSuggestion,
): OriginalTransaction {
  if (original.type === "eip1559") {
    return {
      ...original,
      maxFeePerGas: suggestion.speedUp.maxFeePerGas,
      maxPriorityFeePerGas: suggestion.speedUp.maxPriorityFeePerGas,
    };
  }
  return {
    ...original,
    gasPrice: suggestion.speedUp.gasPrice ?? suggestion.speedUp.maxFeePerGas,
  };
}

/**
 * Build a "cancel" replacement tx — a zero-value self-send at the
 * same nonce with bumped gas. This is MetaMask's (and every other
 * wallet's) cancel implementation: we can't actually tell the chain
 * "ignore that tx", but we CAN get a different tx mined at the same
 * nonce so the original becomes unincludeable.
 *
 * Setting `to = sender` + `value = 0` + `data = 0x` guarantees the
 * replacement is cheap (base 21_000 gas) and semantically a no-op.
 */
export function buildCancelTransaction(
  original: OriginalTransaction,
  senderAddress: `0x${string}`,
  suggestion: ReplacementGasSuggestion,
): OriginalTransaction {
  const cancelBody: Pick<OriginalTransaction, "to" | "value" | "data"> = {
    to: senderAddress,
    value: 0n,
    data: "0x",
  };
  if (original.type === "eip1559") {
    return {
      ...original,
      ...cancelBody,
      maxFeePerGas: suggestion.cancel.maxFeePerGas,
      maxPriorityFeePerGas: suggestion.cancel.maxPriorityFeePerGas,
      // Cancel is a plain ETH self-send — 21_000 is the exact cost.
      // We floor the gas limit at 21_000 so a caller passing in an
      // original with a contract-call gas budget (e.g. 300_000) still
      // pays the minimum rather than wasting gas.
      gasLimit: original.gasLimit < 21_000n ? 21_000n : original.gasLimit,
    };
  }
  return {
    ...original,
    ...cancelBody,
    gasPrice: suggestion.cancel.gasPrice ?? suggestion.cancel.maxFeePerGas,
    gasLimit: original.gasLimit < 21_000n ? 21_000n : original.gasLimit,
  };
}
