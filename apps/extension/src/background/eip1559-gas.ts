/**
 * Resolve the EIP-1559 gas tuple once, before an approval is displayed.
 *
 * JSON-RPC transaction fields are controlled by the calling page.  Keep the
 * accepted quantities deliberately bounded and return an immutable tuple so
 * the values reviewed by the user are exactly the values later signed.
 */

export interface Eip1559GasEstimate {
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface UntrustedEip1559GasOverrides {
  gas?: unknown;
  gasLimit?: unknown;
  maxFeePerGas?: unknown;
  maxPriorityFeePerGas?: unknown;
}

export interface EffectiveEip1559GasParameters {
  readonly gasLimit: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly estimatedFee: bigint;
}

// Gas is represented as a uint64 by current execution clients. Fee fields are
// capped at uint128: vastly above any plausible wei-per-gas value, while still
// preventing an attacker from feeding arbitrarily large BigInts into RLP and
// approval rendering.
export const MAX_EIP1559_GAS_LIMIT = (1n << 64n) - 1n;
export const MAX_EIP1559_FEE_PER_GAS = (1n << 128n) - 1n;

export class Eip1559GasValidationError extends Error {
  constructor(
    message: string,
    readonly source: "caller" | "estimate" = "caller",
  ) {
    super(message);
    this.name = "Eip1559GasValidationError";
  }
}

function parseRpcQuantity(
  field: string,
  value: unknown,
  maximum: bigint,
  allowZero: boolean,
): bigint | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) {
    throw new Eip1559GasValidationError(
      `${field} must be a canonical non-negative 0x-prefixed hex quantity`,
    );
  }

  const parsed = BigInt(value);
  if (!allowZero && parsed === 0n) {
    throw new Eip1559GasValidationError(`${field} must be greater than zero`);
  }
  if (parsed > maximum) {
    throw new Eip1559GasValidationError(`${field} exceeds the wallet safety bound`);
  }
  return parsed;
}

function validateEstimateField(
  field: string,
  value: bigint,
  maximum: bigint,
  allowZero: boolean,
): void {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Eip1559GasValidationError(`${field} estimate is invalid`, "estimate");
  }
  if (!allowZero && value === 0n) {
    throw new Eip1559GasValidationError(
      `${field} estimate must be greater than zero`,
      "estimate",
    );
  }
  if (value > maximum) {
    throw new Eip1559GasValidationError(
      `${field} estimate exceeds the wallet safety bound`,
      "estimate",
    );
  }
}

export function resolveEffectiveEip1559GasParameters(
  overrides: UntrustedEip1559GasOverrides,
  estimate: Eip1559GasEstimate,
): Readonly<EffectiveEip1559GasParameters> {
  validateEstimateField("gasLimit", estimate.gasLimit, MAX_EIP1559_GAS_LIMIT, false);
  validateEstimateField(
    "maxFeePerGas",
    estimate.maxFeePerGas,
    MAX_EIP1559_FEE_PER_GAS,
    true,
  );
  validateEstimateField(
    "maxPriorityFeePerGas",
    estimate.maxPriorityFeePerGas,
    MAX_EIP1559_FEE_PER_GAS,
    true,
  );

  const gas = parseRpcQuantity(
    "gas",
    overrides.gas,
    MAX_EIP1559_GAS_LIMIT,
    false,
  );
  const gasLimitAlias = parseRpcQuantity(
    "gasLimit",
    overrides.gasLimit,
    MAX_EIP1559_GAS_LIMIT,
    false,
  );
  if (gas !== undefined && gasLimitAlias !== undefined && gas !== gasLimitAlias) {
    throw new Eip1559GasValidationError("gas and gasLimit must match when both are supplied");
  }

  const gasLimit = gas ?? gasLimitAlias ?? estimate.gasLimit;
  const maxFeePerGas = parseRpcQuantity(
    "maxFeePerGas",
    overrides.maxFeePerGas,
    MAX_EIP1559_FEE_PER_GAS,
    true,
  ) ?? estimate.maxFeePerGas;
  const maxPriorityFeePerGas = parseRpcQuantity(
    "maxPriorityFeePerGas",
    overrides.maxPriorityFeePerGas,
    MAX_EIP1559_FEE_PER_GAS,
    true,
  ) ?? estimate.maxPriorityFeePerGas;

  if (maxPriorityFeePerGas > maxFeePerGas) {
    throw new Eip1559GasValidationError(
      "maxPriorityFeePerGas cannot exceed maxFeePerGas",
    );
  }

  return Object.freeze({
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    estimatedFee: gasLimit * maxFeePerGas,
  });
}
