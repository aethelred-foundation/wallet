import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBackground } from "./use-background";
import { lookupSpender } from "../../lib/known-spenders";

/**
 * useTokenAllowances
 * ──────────────────
 * Enterprise token-approval auditing primitive. The hook owns the
 * lifecycle of a per-account ERC-20 approvals list so the UI can
 * render it without re-fetching on every mount.
 *
 * Data source:
 *  - Sends a `get-token-allowances` bridge message to the background
 *    service worker. The background is expected to aggregate the list
 *    by scanning the account's historical `Approval` events and
 *    resolving the current on-chain allowance via `allowance(owner,
 *    spender)`.
 *  - When the background does not yet implement the handler (dev mode
 *    or a staged rollout) the hook returns an empty list cleanly so
 *    the view can still render its empty state.
 *
 * Risk model:
 *  - `unlimited` = raw allowance ≥ 2^255 (treated as "effectively
 *    infinite"). Finite allowances receive an exact-USD valuation.
 *  - Risk level is computed explicitly by `classifyRisk(isUnlimited,
 *    spenderVerified)`:
 *      unlimited + unverified → high
 *      unlimited + verified   → medium
 *      finite    + unverified → medium
 *      finite    + verified   → low
 *
 * The background returns RAW shape (tokenAddress, allowanceRaw, etc.).
 * The hook enriches each entry with the local known-spender lookup and
 * the pre-computed risk level so UI code stays declarative.
 */

export interface RawAllowancePayload {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  tokenLogo?: string;
  tokenDecimals?: number;
  spenderAddress: string;
  /** Optional override label — background may pre-resolve some names. */
  spenderLabel?: string;
  allowanceRaw: string;
  allowanceFormatted?: string;
  allowanceUsd?: number;
  lastUpdated?: number;
  /** Chain id the allowance was granted on. Defaults to 1 (mainnet). */
  chainId?: number;
}

export interface TokenAllowance {
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string;
  tokenLogo?: string;
  spenderAddress: string;
  spenderLabel?: string;
  spenderVerified: boolean;
  allowanceRaw: string;
  allowanceFormatted: string;
  allowanceUsd?: number;
  lastUpdated: number;
  riskLevel: "low" | "medium" | "high";
}

export interface UseTokenAllowancesResult {
  allowances: TokenAllowance[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Unlimited threshold — allowances at or above 2^255 are treated as
 * "effectively unlimited". This matches the MetaMask convention: many
 * dApps pass uint256.max (2^256 - 1) as a sentinel but some pass
 * slightly smaller values (e.g. 2^256 - 2) and the UX should still read
 * as "Unlimited".
 */
const UNLIMITED_THRESHOLD = BigInt(2) ** BigInt(255);

/**
 * Determine whether a raw wei-level allowance counts as "unlimited".
 * Accepts both hex ("0x…") and decimal strings. Falls back to `false`
 * on parse errors so a malformed value is treated conservatively
 * (finite) rather than silently upgraded to the "Unlimited" pill.
 */
function isRawUnlimited(raw: string): boolean {
  try {
    const parsed = raw.startsWith("0x") ? BigInt(raw) : BigInt(raw);
    return parsed >= UNLIMITED_THRESHOLD;
  } catch {
    return false;
  }
}

/**
 * Classify risk exactly per the spec:
 *   unlimited + unverified → high
 *   unlimited + verified   → medium
 *   finite    + unverified → medium
 *   finite    + verified   → low
 */
export function classifyRisk(
  isUnlimited: boolean,
  spenderVerified: boolean,
): "low" | "medium" | "high" {
  if (isUnlimited && !spenderVerified) return "high";
  if (isUnlimited && spenderVerified) return "medium";
  if (!isUnlimited && !spenderVerified) return "medium";
  return "low";
}

/**
 * Format a raw wei-level allowance for display. Unlimited values read
 * as "Unlimited"; everything else uses the token's decimals with up
 * to 4 fractional digits trimmed of trailing zeros.
 *
 * This is deliberately lossy on the decimal side — large allowances
 * displayed with 18 decimals of precision scan as noise. The raw value
 * is preserved separately for any consumer that needs exactness.
 */
function formatAllowance(raw: string, decimals: number, unlimited: boolean): string {
  if (unlimited) return "Unlimited";
  try {
    const asBig = raw.startsWith("0x") ? BigInt(raw) : BigInt(raw);
    if (decimals <= 0) return asBig.toString();
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = asBig / divisor;
    const remainder = asBig % divisor;
    // Truncate to 4 decimal places of display precision.
    const displayDecimals = Math.min(decimals, 4);
    const truncatedFraction = remainder
      .toString()
      .padStart(decimals, "0")
      .slice(0, displayDecimals)
      .replace(/0+$/, "");
    if (truncatedFraction.length === 0) {
      return formatThousands(whole.toString());
    }
    return `${formatThousands(whole.toString())}.${truncatedFraction}`;
  } catch {
    return raw;
  }
}

function formatThousands(digits: string): string {
  // Insert commas every 3 digits from the right, preserving sign.
  const negative = digits.startsWith("-");
  const body = negative ? digits.slice(1) : digits;
  const rev = body.split("").reverse().join("");
  const chunks = rev.match(/.{1,3}/g) ?? [];
  const joined = chunks.join(",").split("").reverse().join("");
  return negative ? `-${joined}` : joined;
}

/**
 * Enrich a raw payload entry with the computed-client side fields
 * (label resolution, verified flag, unlimited flag, formatted string,
 * risk level). Exported for direct use by tests — the pure function
 * shape makes every classification branch trivially testable.
 */
export function enrichAllowance(raw: RawAllowancePayload): TokenAllowance {
  const chainId = raw.chainId ?? 1;
  const match = lookupSpender(chainId, raw.spenderAddress);
  const unlimited = isRawUnlimited(raw.allowanceRaw);
  const verified = match?.verified ?? false;
  const decimals = raw.tokenDecimals ?? 18;
  const spenderLabel = raw.spenderLabel ?? match?.label;
  const formatted =
    raw.allowanceFormatted ?? formatAllowance(raw.allowanceRaw, decimals, unlimited);
  // USD value when unlimited is rendered as `Infinity` — CurrencyText
  // displays an em-dash for non-finite inputs so users see a hyphen
  // rather than a misleading "$∞".
  const allowanceUsd = raw.allowanceUsd !== undefined
    ? raw.allowanceUsd
    : (unlimited ? Number.POSITIVE_INFINITY : undefined);
  return {
    tokenAddress: raw.tokenAddress,
    tokenSymbol: raw.tokenSymbol,
    tokenName: raw.tokenName,
    tokenLogo: raw.tokenLogo,
    spenderAddress: raw.spenderAddress,
    spenderLabel,
    spenderVerified: verified,
    allowanceRaw: raw.allowanceRaw,
    allowanceFormatted: formatted,
    allowanceUsd,
    lastUpdated: raw.lastUpdated ?? Date.now(),
    riskLevel: classifyRisk(unlimited, verified),
  };
}

export function useTokenAllowances(
  accountAddress?: string,
): UseTokenAllowancesResult {
  const { send } = useBackground();
  const [allowances, setAllowances] = useState<TokenAllowance[]>([]);
  const [loading, setLoading] = useState<boolean>(!!accountAddress);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!accountAddress) {
      setAllowances([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const result = (await send("get-token-allowances", {
        address: accountAddress,
      })) as RawAllowancePayload[] | undefined;
      if (!mountedRef.current) return;
      if (Array.isArray(result)) {
        setAllowances(result.map(enrichAllowance));
        setError(null);
      } else {
        // Background does not yet implement the handler (dev mode
        // returns `{}`). Keep the list empty but don't surface an
        // error — the view renders its reassuring empty state instead.
        setAllowances([]);
        setError(null);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
      // Intentionally leave `allowances` unchanged on error so a
      // transient failure doesn't wipe a previously loaded list.
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [accountAddress, send]);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Stable identity for the imperative refresh handle.
  const refreshHandle = useCallback((): void => {
    refresh().catch(() => {});
  }, [refresh]);

  // The memo is defensive — consumers shouldn't have to re-derive the
  // sorted list. We order high-risk first so users scan danger first.
  const sorted = useMemo(() => {
    const order: Record<TokenAllowance["riskLevel"], number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    return [...allowances].sort((a, b) => {
      const rankA = order[a.riskLevel];
      const rankB = order[b.riskLevel];
      if (rankA !== rankB) return rankA - rankB;
      // Secondary sort: most recently updated first.
      return b.lastUpdated - a.lastUpdated;
    });
  }, [allowances]);

  return {
    allowances: sorted,
    loading,
    error,
    refresh: refreshHandle,
  };
}
