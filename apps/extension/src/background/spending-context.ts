/**
 * Spending-context assembly for policy enforcement.
 *
 * The policy bundles' value, destination, and velocity rules read
 * `amountUsd`, `destinationCategory`, and the velocity counters from the
 * PolicyContext. Both send paths (popup prepare-tx and the dApp
 * eth_sendTransaction pipeline) build that context here so the rules
 * judge exactly one, consistent view of the transfer.
 *
 * Pricing is fail-closed: when the native asset has no trustworthy USD
 * price (AETHEL has no market; production builds refuse to invent one),
 * `amountUsd` stays undefined so value-based rules cannot fire on made-up
 * numbers — and `priced: false` obliges the caller to say so out loud via
 * UNPRICED_POLICY_NOTICE instead of silently skipping enforcement.
 */

export interface SpendingFieldsInput {
  /** Destination address, or null/undefined for contract creation. */
  to?: string | null;
  /** Transfer value in base units (wei). */
  valueWei: bigint;
  /** Native asset decimals (18 on the EVM face). */
  decimals: number;
  /** Native asset symbol, e.g. "AETHEL". */
  symbol: string;
  /** USD price per whole token, or null when no trustworthy price exists. */
  priceUsd: number | null;
  /** The wallet's own account addresses (any case). */
  ownAddresses: string[];
  /** 24h velocity stats for the active subject, when available. */
  velocity?: { count24h: number; valueUsd24h: number };
}

export interface SpendingFields {
  destination?: string;
  destinationCategory: "known-contact" | "unknown";
  amount: number;
  amountUsd?: number;
  assetSymbol: string;
  assetCategory: "native";
  requestedOperationCount24h?: number;
  cumulativeValueSpentUsd24h?: number;
  /** False when no trustworthy price existed — surface UNPRICED_POLICY_NOTICE. */
  priced: boolean;
}

/**
 * Shown (and audited) whenever a transfer is evaluated without a USD
 * price: value-based policy rules did not run, and pretending otherwise
 * would be enforcement theater.
 */
export const UNPRICED_POLICY_NOTICE =
  "This transfer could not be priced in USD (no market price for the asset), " +
  "so value-based policy checks did not run. Amount and destination checks still apply.";

/**
 * Convert base units to a whole-token Number with micro-unit precision.
 * The ONLY sanctioned base-units→Number conversion for balance/value math:
 * display strings from the balance fetcher are locale-formatted
 * ("100,000.0") and parseFloat-ing them truncates at the first separator.
 */
export function baseUnitsToAmount(valueWei: bigint, decimals: number): number {
  if (decimals <= 6) return Number(valueWei) / 10 ** decimals;
  // Divide in bigint space down to 6 fractional digits, then float — keeps
  // very large values exact enough for threshold comparison without
  // Number-overflow artifacts.
  return Number(valueWei / 10n ** BigInt(decimals - 6)) / 1e6;
}

export function buildSpendingFields(input: SpendingFieldsInput): SpendingFields {
  const amount = baseUnitsToAmount(input.valueWei, input.decimals);
  const priced = typeof input.priceUsd === "number" && input.priceUsd > 0;

  const destination = input.to ?? undefined;
  const own = new Set(input.ownAddresses.map((a) => a.toLowerCase()));
  const destinationCategory =
    destination && own.has(destination.toLowerCase()) ? "known-contact" : "unknown";

  return {
    destination,
    destinationCategory,
    amount,
    amountUsd: priced ? amount * (input.priceUsd as number) : undefined,
    assetSymbol: input.symbol,
    assetCategory: "native",
    requestedOperationCount24h: input.velocity?.count24h,
    cumulativeValueSpentUsd24h: input.velocity?.valueUsd24h,
    priced,
  };
}
