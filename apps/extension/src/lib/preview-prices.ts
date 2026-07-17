/**
 * Shared preview price table + the native-asset price resolver.
 *
 * Single source of truth for the non-production preview prices the popup
 * ticker shows AND the USD figure the policy engine judges — the number
 * the user sees and the number enforcement reasons about must never come
 * from different tables.
 *
 * Production builds fail closed: AETHEL has no market, and no price is
 * better than an invented one. `resolveNativePriceUsd` returns null there,
 * which flows through the spending context as `priced: false` and obliges
 * the send paths to surface UNPRICED_POLICY_NOTICE instead of silently
 * skipping value-based rules.
 */

import { IS_PRODUCTION_BUILD } from "../popup/lib/release-mode";

export interface PreviewPrice {
  price: number;
  change24h: number;
}

export const PREVIEW_PRICES: Record<string, PreviewPrice> = {
  AETHEL: { price: 2.47, change24h: 3.2 },
  stAETHEL: { price: 2.58, change24h: 3.8 },
  BTC: { price: 97480, change24h: 1.8 },
  WETH: { price: 3245.8, change24h: -1.4 },
  SOL: { price: 178.42, change24h: 5.6 },
  USDC: { price: 1, change24h: 0 },
  EURC: { price: 1.08, change24h: 0.12 },
  PYUSD: { price: 1, change24h: 0 },
  USDY: { price: 1.04, change24h: 0.01 },
  BUIDL: { price: 1, change24h: 0 },
};

/**
 * USD price per whole unit of the active network's native asset, or null
 * when no trustworthy price exists (always null in production builds).
 */
export function resolveNativePriceUsd(symbol: string): number | null {
  if (IS_PRODUCTION_BUILD) return null;
  return PREVIEW_PRICES[symbol]?.price ?? null;
}
