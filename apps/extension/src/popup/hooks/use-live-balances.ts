import { useCallback, useEffect, useRef, useState } from "react";
import { useBackground } from "./use-background";

/**
 * useLiveBalances
 * ───────────────
 * Reads real on-chain balances for a given address via the background
 * service worker's `get-balances` handler, which proxies to
 * `BalanceFetcher.getMultipleBalances` → a real JSON-RPC `eth_call` of
 * each token's ERC-20 `balanceOf(owner)`, then enriches with prices
 * from `PriceService` (CoinGecko).
 *
 * Why a hook instead of a service:
 *   - State lives in React so components re-render when new data
 *     arrives (the old `PortfolioManager.getPortfolio()` was a
 *     synchronous call returning hardcoded mock data — it couldn't
 *     represent "loading" or "empty").
 *   - Per-view lifecycle: each consumer chooses its own poll interval.
 *   - Address changes drive a re-fetch automatically via the deps array.
 *
 * Behavior:
 *   - `address === undefined` → returns empty tokens + `isLoading: false`.
 *     This is the "no wallet initialized yet" state.
 *   - `address` present → fetches on mount, re-fetches on address
 *     change, optionally polls every `pollMs` (default 30s).
 *   - First fetch sets `isLoading: true`; later polls set
 *     `isRefreshing: true` but keep `tokens` stable so the UI doesn't
 *     flicker.
 *   - Errors are surfaced via the `error` field — the previous tokens
 *     stay visible so a transient RPC failure doesn't wipe the UI.
 *
 * Aggregate fields (totalValue, totalChange24h, totalChangePercent24h)
 * are derived from the token list, matching the old `PortfolioSummary`
 * shape so views can drop this in as a near-replacement.
 */

export interface LiveToken {
  /** Token contract address ("native" for the chain's gas asset) */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Human-readable balance, e.g. "12.345" */
  balance: string;
  /** Hex-encoded raw balance, e.g. "0x1a2b3c..." */
  rawBalance: string;
  /** USD spot price per token (0 if unknown) */
  priceUsd: number;
  /** 24h change as a percent (e.g. 3.2 = +3.2%) */
  change24h: number;
  /** balance × priceUsd, denormalized on the server for performance */
  value: number;
}

export interface UseLiveBalancesOptions {
  /** Poll interval in ms. Default: 30000. Set to 0 to disable polling. */
  pollMs?: number;
  /**
   * Optional custom token list to fetch. If omitted, the background
   * uses its default per-chain ERC-20 list.
   */
  tokens?: Array<{ address: string; symbol: string; name: string; decimals: number }>;
}

export interface UseLiveBalancesResult {
  tokens: LiveToken[];
  totalValue: number;
  totalChange24h: number;
  totalChangePercent24h: number;
  /** True on the very first fetch (no previous data to show) */
  isLoading: boolean;
  /** True during a poll/refetch (previous data still displayed) */
  isRefreshing: boolean;
  /** Most recent error, if any. Tokens are NOT cleared on error. */
  error: Error | null;
  /** Manually trigger a refetch */
  refresh: () => Promise<void>;
  /** Timestamp (ms) of the last successful fetch */
  lastUpdatedAt: number | null;
}

export function useLiveBalances(
  address: string | undefined,
  options?: UseLiveBalancesOptions,
): UseLiveBalancesResult {
  const { send } = useBackground();
  const [tokens, setTokens] = useState<LiveToken[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(!!address);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const mountedRef = useRef(true);
  const hasLoadedRef = useRef(false);

  const pollMs = options?.pollMs ?? 30_000;
  // Stringify custom tokens for stable dep-tracking
  const tokensKey = options?.tokens ? JSON.stringify(options.tokens) : "";

  const refresh = useCallback(async (): Promise<void> => {
    if (!address) {
      setTokens([]);
      setIsLoading(false);
      return;
    }
    // Distinguish initial load from background refresh
    if (hasLoadedRef.current) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const payload: { address: string; tokens?: unknown } = { address };
      if (options?.tokens) payload.tokens = options.tokens;

      const result = (await send("get-balances", payload)) as LiveToken[] | undefined;

      if (!mountedRef.current) return;

      if (Array.isArray(result)) {
        // Sort by value descending so the biggest holdings render first.
        // Stable sort: for ties, preserve the order the backend returned
        // (typically matches the token list order).
        const sorted = [...result].sort((a, b) => b.value - a.value);
        setTokens(sorted);
        setError(null);
        setLastUpdatedAt(Date.now());
        hasLoadedRef.current = true;
      } else {
        // Dev mode returns `{}` — leave tokens empty but don't error
        if (!hasLoadedRef.current) setTokens([]);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
      // IMPORTANT: don't clear `tokens` on error. If a poll fails we
      // keep the previous snapshot visible so the UI doesn't flicker.
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [address, send, options?.tokens, tokensKey]);

  // Fetch on mount and whenever the address changes
  useEffect(() => {
    mountedRef.current = true;
    hasLoadedRef.current = false;
    refresh();
    return () => {
      mountedRef.current = false;
    };
    // refresh is stable per address/tokensKey; including it pulls the
    // custom-tokens change into this effect cleanly.
  }, [refresh]);

  // Optional polling
  useEffect(() => {
    if (!address || pollMs <= 0) return;
    const id = window.setInterval(() => {
      refresh().catch(() => {});
    }, pollMs + Math.floor(Math.random() * pollMs * 0.2)); // jittered anti-herd phase
    return () => window.clearInterval(id);
  }, [address, pollMs, refresh]);

  // Derive aggregate fields from tokens. These are computed every render
  // rather than stored so they stay in sync with `tokens` without any
  // risk of stale state.
  const totalValue = tokens.reduce((sum, t) => sum + t.value, 0);
  const totalChange24h = tokens.reduce(
    (sum, t) => sum + (t.value * t.change24h) / 100,
    0,
  );
  const totalChangePercent24h =
    totalValue > 0 ? (totalChange24h / totalValue) * 100 : 0;

  return {
    tokens,
    totalValue,
    totalChange24h,
    totalChangePercent24h,
    isLoading,
    isRefreshing,
    error,
    refresh,
    lastUpdatedAt,
  };
}
