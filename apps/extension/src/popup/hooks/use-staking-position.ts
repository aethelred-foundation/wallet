import { useCallback, useEffect, useRef, useState } from "react";
import { useBackground } from "./use-background";

/**
 * useStakingPosition
 * ──────────────────
 * The portfolio Staking tab's LIVE data source (Cruzible gap W-2). Reads
 * the user's Cruzible position via the background's `get-staking-position`
 * handler → StakingPositionFetcher → real `eth_call`s against the active
 * network's stAETHEL token and its on-chain-discovered vault.
 *
 * Mirrors useLiveBalances' lifecycle: fetch on mount + address change,
 * poll (default 30s), keep the previous position visible across polls so
 * the UI never flickers, and surface errors without wiping data.
 *
 * `position === null` with no error is an HONEST empty state: either the
 * active network has no stAETHEL token entry, or the token isn't a
 * Cruzible receipt token. The UI must say so — never seed a fake position.
 */

export interface StakingWithdrawalView {
  id: string;
  aethelWei: string;
  requestTime: number;
  completionTime: number;
  claimed: boolean;
  claimable: boolean;
}

export interface StakingPositionView {
  tokenAddress: string;
  vaultAddress: string;
  stakedWei: string;
  exchangeRateWei: string;
  apyBps: number;
  withdrawals: StakingWithdrawalView[];
}

export function useStakingPosition(
  address: string | undefined,
  pollMs = 30_000,
): {
  position: StakingPositionView | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { send } = useBackground();
  const [position, setPosition] = useState<StakingPositionView | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(address));
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const fetchPosition = useCallback(async () => {
    if (!address) {
      setPosition(null);
      setIsLoading(false);
      return;
    }
    try {
      const result = (await send("get-staking-position", { address })) as
        | StakingPositionView
        | null
        | undefined;
      if (!aliveRef.current) return;
      setPosition(result ?? null);
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      // Keep the previous position visible — a transient RPC failure must
      // not make a real position vanish.
      setError(err instanceof Error ? err.message : "Failed to read staking position");
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, [address, send]);

  useEffect(() => {
    aliveRef.current = true;
    setIsLoading(Boolean(address));
    void fetchPosition();
    const timer = pollMs > 0 ? setInterval(() => void fetchPosition(), pollMs) : undefined;
    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [fetchPosition, pollMs, address]);

  return { position, isLoading, error, refresh: fetchPosition };
}

/** Format a wei decimal-string as a human amount (4 dp, trimmed). */
export function formatWei(wei: string, maxDp = 4): string {
  try {
    const raw = BigInt(wei || "0");
    const whole = raw / 10n ** 18n;
    const frac = (raw % 10n ** 18n).toString().padStart(18, "0").slice(0, maxDp);
    const s = `${whole.toLocaleString()}.${frac}`.replace(/\.?0+$/, "");
    return s || "0";
  } catch {
    return "0";
  }
}
