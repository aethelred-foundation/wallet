import { useCallback, useState, useMemo } from "react";
import { Coins, Landmark, Wallet, EyeOff, Eye } from "lucide-react";
import { TokenLogo } from "../components/token-logo";
import { DappLogo } from "../components/dapp-logo";
import { SkeletonTokenRow } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { CurrencyText } from "../components/currency-text";
import { useWalletState } from "../hooks/use-wallet-state";
import { useLiveBalances, type LiveToken } from "../hooks/use-live-balances";
import { useStakingPosition, formatWei } from "../hooks/use-staking-position";
import { SegmentedControl } from "../components/segmented-control";

/* Category inference for live on-chain tokens.
 *
 * The old PortfolioManager tokens carried an explicit `category` field
 * but live tokens from BalanceFetcher only know the contract address,
 * symbol, name, and decimals. This map backfills a category by symbol
 * so the AllocationRing can still group holdings meaningfully.
 *
 * Unknown symbols fall through to "other" which renders in gray. */
const SYMBOL_TO_CATEGORY: Record<string, string> = {
  AETHEL: "native",
  ETH: "settlement",
  WETH: "settlement",
  stAETHEL: "staking",
  stETH: "staking",
  rETH: "staking",
  wstETH: "staking",
  USDC: "stablecoin",
  USDT: "stablecoin",
  DAI: "stablecoin",
  PYUSD: "stablecoin",
  EURC: "stablecoin",
  FRAX: "stablecoin",
  BUIDL: "rwa",
  USDY: "rwa",
  OUSG: "rwa",
  BENJI: "rwa",
};

function inferCategory(symbol: string): string {
  return SYMBOL_TO_CATEGORY[symbol] ?? "other";
}

/** Compact time-until label for unbonding entries ("42m", "5h", "3d"). */
function formatEta(untilSec: number): string {
  const s = Math.max(0, untilSec - Math.floor(Date.now() / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/* formatUsd was a local helper that concatenated "$" + compact notation
 * (e.g. "$5.4M"). It was replaced by <CurrencyText compact /> which
 * renders the symbol as a structured span so the "$" and number never
 * visually collide. See apps/extension/src/popup/components/currency-text.tsx. */

type SubTab = "assets" | "staking";

const CATEGORY_COLORS: Record<string, string> = {
  native: "#c41e1e",
  staking: "#34c759",
  stablecoin: "#2775ca",
  rwa: "#8b5cf6",
  settlement: "#627eea",
  other: "#6e6e73",
};

const CATEGORY_LABELS: Record<string, string> = {
  native: "Native",
  staking: "Staking",
  stablecoin: "Stablecoin",
  rwa: "RWA",
  settlement: "Settlement",
  other: "Other",
};

/** A structural "token with category" shape the AllocationRing consumes.
 *  Accepts either legacy `PortfolioTokens` (with nested `.token.category`)
 *  or live tokens (flat symbol + pre-inferred category via inferCategory). */
interface AllocationInput {
  category: string;
  value: number;
}

function AllocationRing({
  tokens,
  totalValue,
}: {
  tokens: AllocationInput[];
  totalValue: number;
}) {
  const categories = ["native", "staking", "stablecoin", "rwa", "settlement", "other"]
    .map((cat) => {
      const catTokens = tokens.filter((t) => t.category === cat);
      const value = catTokens.reduce((s, t) => s + t.value, 0);
      const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
      return { cat, value, pct, color: CATEGORY_COLORS[cat] ?? "#666" };
    })
    .filter((c) => c.pct > 0);

  // SVG donut math
  const size = 140;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="alloc-ring-section">
      <div className="alloc-ring-chart">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {categories.map((c) => {
            const dashLen = (c.pct / 100) * circumference;
            const gap = circumference - dashLen;
            const currentOffset = offset;
            offset += dashLen;
            return (
              <circle
                key={c.cat}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={c.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dashLen} ${gap}`}
                strokeDashoffset={-currentOffset}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 600ms ease, stroke-dashoffset 600ms ease" }}
              />
            );
          })}
        </svg>
        <div className="alloc-ring-center">
          <span className="alloc-ring-total">
            <CurrencyText value={totalValue} compact maximumFractionDigits={1} />
          </span>
          <span className="alloc-ring-label">Total</span>
        </div>
      </div>
      <div className="alloc-ring-legend">
        {categories.map((c) => (
          <div className="alloc-ring-item" key={c.cat}>
            <span className="alloc-ring-dot" style={{ background: c.color }} />
            <span className="alloc-ring-name">{CATEGORY_LABELS[c.cat] ?? c.cat}</span>
            <span className="alloc-ring-pct">{c.pct.toFixed(0)}%</span>
            <span className="alloc-ring-val">
              <CurrencyText value={c.value} compact maximumFractionDigits={1} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** LocalStorage key for the "Hide small balances" toggle state. */
const HIDE_SMALL_KEY = "aethelred-portfolio-hide-small";
/** Threshold below which a holding is considered "dust" (USD). */
const SMALL_BALANCE_THRESHOLD = 1;

function readHideSmallBalances(): boolean {
  try {
    return localStorage.getItem(HIDE_SMALL_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHideSmallBalances(value: boolean): void {
  try {
    localStorage.setItem(HIDE_SMALL_KEY, value ? "1" : "0");
  } catch {
    /* private-mode browsers — ignore */
  }
}

export function PortfolioView() {
  const { state } = useWalletState();
  const [tab, setTab] = useState<SubTab>("assets");
  const [hideSmall, setHideSmall] = useState<boolean>(() => readHideSmallBalances());

  /* Stable handler — the EmptyState component is memoized and keys on
   * its `action.onClick` identity. Without a stable ref, every live-
   * balance poll would force the empty state to re-render. */
  const handleShowAll = useCallback(() => {
    setHideSmall(false);
    writeHideSmallBalances(false);
  }, []);

  /* ─── Live on-chain holdings ───────────────────────────── *
   * `useLiveBalances` pulls real ERC-20 balances via the background
   * service worker for the active account; `useStakingPosition` does the
   * same for the Cruzible position (stAETHEL balance, vault exchange rate,
   * on-chain APY, unbonding queue). The DeFi tab remains a non-production
   * catalog until a real protocol-discovery source exists. */
  const activeAccount =
    state?.accounts.find((account) => account.id === state.activeAccountId) ?? state?.accounts[0];
  const activeAddress = activeAccount?.address;
  const {
    tokens: liveTokens,
    totalValue: liveTotal,
    isLoading: liveLoading,
    isRefreshing: liveRefreshing,
  } = useLiveBalances(activeAddress);

  /* Live Cruzible staking position (gap W-2) — chain truth on every build. */
  const {
    position: stakingPosition,
    isLoading: stakingLoading,
    error: stakingError,
  } = useStakingPosition(activeAddress);
  const stakingBadge = stakingPosition
    ? (BigInt(stakingPosition.stakedWei) > 0n ? 1 : 0) +
      stakingPosition.withdrawals.filter((w) => !w.claimed).length
    : 0;

  /* Filter out dust holdings when the toggle is on. Computed once per
   * render — the filter cost is negligible for typical wallet sizes. */
  const displayTokens = useMemo<LiveToken[]>(() => {
    if (!hideSmall) return liveTokens;
    // Never hide an unpriced token: its on-chain balance is still real even
    // though no authoritative USD quote is available.
    return liveTokens.filter(
      (t) => t.value === null || t.value >= SMALL_BALANCE_THRESHOLD,
    );
  }, [liveTokens, hideSmall]);

  /* Adapt the live tokens into the AllocationRing's `AllocationInput`
   * shape by inferring a category from the symbol. */
  const allocationInput = useMemo<AllocationInput[]>(
    () => liveTokens.map((t) => ({
      category: inferCategory(t.symbol),
      value: t.value ?? 0,
    })),
    [liveTokens],
  );

  const hiddenCount = liveTokens.length - displayTokens.length;

  return (
    <div className="view-padded">
      {/* Sub-tabs — now using the iOS-style SegmentedControl primitive
          with a sliding pill indicator. The pill measures each segment's
          width via ResizeObserver so it stays accurate even when fonts
          load or the container resizes. */}
      <div style={{ marginBottom: "var(--space-3)" }}>
        <SegmentedControl
          items={[
            { id: "assets", label: "Assets", icon: <Coins size={12} />, badge: liveTokens.length },
            { id: "staking", label: "Staking", icon: <Landmark size={12} />, badge: stakingBadge },
          ]}
          activeId={tab}
          onChange={(id) => setTab(id as SubTab)}
          size="md"
          ariaLabel="Portfolio section"
        />
      </div>

      {tab === "assets" && (
        <div className="holdings-list" style={{ padding: 0 }}>
          <div
            className="section-header"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-2)",
            }}
          >
            <div>
              <h3>All Assets</h3>
              <span className="section-count">
                {liveTokens.length} token{liveTokens.length === 1 ? "" : "s"} ·{" "}
                <CurrencyText value={liveTotal} compact maximumFractionDigits={1} />
                {liveRefreshing && " · refreshing…"}
              </span>
            </div>
            {liveTokens.length > 0 && (
              <button
                type="button"
                className="motion-press"
                onClick={() => {
                  const next = !hideSmall;
                  setHideSmall(next);
                  writeHideSmallBalances(next);
                }}
                title={hideSmall ? "Show all tokens" : "Hide holdings under $1"}
                aria-pressed={hideSmall}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-1)",
                  padding: "var(--space-1) var(--space-2)",
                  fontSize: "var(--type-caption-size)",
                  fontWeight: 600,
                  color: hideSmall ? "var(--accent)" : "var(--ink-soft)",
                  background: hideSmall ? "rgba(196, 30, 30, 0.08)" : "transparent",
                  border: `1px solid ${hideSmall ? "rgba(196, 30, 30, 0.25)" : "var(--line)"}`,
                  borderRadius: "var(--radius-pill)",
                  cursor: "pointer",
                  transition: "all var(--dur-fast) var(--ease-out)",
                }}
              >
                {hideSmall ? <EyeOff size={12} /> : <Eye size={12} />}
                <span>{hideSmall ? "Hiding dust" : "Hide small"}</span>
              </button>
            )}
          </div>

          {/* Four render states match home-v2 (consistent across views). */}
          {!activeAddress ? (
            <EmptyState
              icon={<Wallet size={26} />}
              title="No wallet yet"
              description="Create or import a wallet to see your holdings on-chain."
              tone="info"
            />
          ) : liveLoading ? (
            <>
              <SkeletonTokenRow />
              <SkeletonTokenRow />
              <SkeletonTokenRow />
              <SkeletonTokenRow />
            </>
          ) : displayTokens.length === 0 ? (
            <EmptyState
              icon={<Wallet size={26} />}
              title={hiddenCount > 0 ? "All dust filtered" : "No tokens yet"}
              description={
                hiddenCount > 0
                  ? `${hiddenCount} holding${hiddenCount === 1 ? "" : "s"} under $${SMALL_BALANCE_THRESHOLD} hidden.`
                  : "Transfer funds into this account to see your holdings here."
              }
              tone="info"
              action={
                hiddenCount > 0
                  ? {
                      label: "Show all",
                      onClick: handleShowAll,
                    }
                  : undefined
              }
            />
          ) : (
            <>
              {displayTokens.map((t) => (
                <div className="holding-row" key={`${t.address}-${t.symbol}`}>
                  <TokenLogo symbol={t.symbol} size={32} />
                  <div className="holding-info">
                    <div className="holding-name">{t.name}</div>
                    <div className="holding-balance">
                      {parseFloat(t.balance).toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })}{" "}
                      {t.symbol}
                    </div>
                  </div>
                  <div className="holding-value">
                    {t.value === null || t.change24h === null ? (
                      <div className="holding-usd">Unpriced</div>
                    ) : (
                      <>
                        <div className="holding-usd">
                          <CurrencyText value={t.value} maximumFractionDigits={2} />
                        </div>
                        <div className={`holding-change ${t.change24h >= 0 ? "positive" : "negative"}`}>
                          {t.change24h >= 0 ? "+" : ""}
                          {t.change24h.toFixed(2)}%
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {hiddenCount > 0 && (
                <div
                  style={{
                    padding: "var(--space-3)",
                    textAlign: "center",
                    color: "var(--ink-soft)",
                    fontSize: "var(--type-caption-size)",
                  }}
                >
                  {hiddenCount} small holding{hiddenCount === 1 ? "" : "s"} hidden
                </div>
              )}
              {/* Allocation — donut ring chart (only when there's real data) */}
              {liveTotal > 0 && (
                <AllocationRing tokens={allocationInput} totalValue={liveTotal} />
              )}
            </>
          )}
        </div>
      )}

      {tab === "staking" && (() => {
        /* ─── Staking — LIVE Cruzible reader (gap W-2) ────────────────
         * Real on-chain position via useStakingPosition →
         * `get-staking-position` → StakingPositionFetcher: stAETHEL
         * balance, the vault's exchange rate, the on-chain COMPUTED APY,
         * and the user's unbonding queue with claimability. There is no
         * seeded data on any build — production and dev render the same
         * chain truth, and every empty state says exactly why it's empty. */
        if (stakingLoading) {
          return (
            <div className="holdings-list" style={{ padding: 0 }}>
              <SkeletonTokenRow />
              <SkeletonTokenRow />
            </div>
          );
        }
        if (!stakingPosition) {
          return (
            <EmptyState
              icon={<Landmark size={26} />}
              title={stakingError ? "Staking source unreachable" : "No staking token on this network"}
              description={
                stakingError ??
                "Add the stAETHEL token (or switch to an Aethelred network with Cruzible deployed) to see your live staking position."
              }
              tone="info"
            />
          );
        }

        const visibleWithdrawals = stakingPosition.withdrawals.filter((w) => !w.claimed);
        const hasPosition =
          BigInt(stakingPosition.stakedWei) > 0n || visibleWithdrawals.length > 0;
        if (!hasPosition) {
          return (
            <EmptyState
              icon={<Landmark size={26} />}
              title="No staked AETHEL yet"
              description="Stake AETHEL through Cruzible to receive rebasing stAETHEL — your position and unbonding queue will appear here."
              tone="info"
            />
          );
        }

        const stakedAethel = formatWei(stakingPosition.stakedWei);
        const rate = Number(BigInt(stakingPosition.exchangeRateWei)) / 1e18;
        const apyPct = stakingPosition.apyBps / 100;

        return (
          <div>
            {/* Hero — the live position */}
            <div className="stk-hero">
              <span className="stk-hero-label">Staked via Cruzible</span>
              <h1 className="stk-hero-amount">
                {stakedAethel}
                <span className="stk-hero-asset">stAETHEL</span>
              </h1>
              <div className="stk-hero-meta">
                <div className="stk-hero-meta-item">
                  <span>Exchange rate</span>
                  <strong>{rate.toFixed(6)} AETHEL</strong>
                </div>
                <div className="stk-hero-meta-divider" />
                <div className="stk-hero-meta-item">
                  <span>APY (on-chain)</span>
                  <strong style={{ color: "var(--success)" }}>
                    {apyPct > 0 ? `${apyPct.toFixed(2)}%` : "\u2014"}
                  </strong>
                </div>
                <div className="stk-hero-meta-divider" />
                <div className="stk-hero-meta-item">
                  <span>Unbonding</span>
                  <strong>{visibleWithdrawals.length}</strong>
                </div>
              </div>
            </div>

            {/* stAETHEL rebases — there is nothing to "claim"; say so. */}
            <div className="stk-status-row">
              <div className="stk-status-dot stk-status-active" />
              <span>
                Rewards accrue automatically — your stAETHEL balance rebases as
                the vault earns staking yield.
              </span>
            </div>

            {/* Unbonding queue — real withdrawal entries */}
            {visibleWithdrawals.length > 0 && (
              <>
                <div className="section-header">
                  <h3>Withdrawal queue</h3>
                </div>
                {visibleWithdrawals.map((w) => (
                  <div className="stk-card" key={w.id}>
                    <div className="stk-card-top">
                      <div className="stk-dapp-logo">
                        <DappLogo name="Cruzible" size={36} />
                      </div>
                      <div className="stk-card-info">
                        <strong>
                          {formatWei(w.aethelWei)} AETHEL
                        </strong>
                        <span>Withdrawal #{w.id}</span>
                      </div>
                      {w.claimable ? (
                        <span className="compliance-badge cleared">CLAIMABLE</span>
                      ) : (
                        <span className="compliance-badge">
                          ~{formatEta(w.completionTime)}
                        </span>
                      )}
                    </div>
                    <div className="stk-status-row">
                      <div
                        className={`stk-status-dot ${w.claimable ? "stk-status-active" : ""}`}
                      />
                      <span>
                        {w.claimable
                          ? "Matured — claim it from the Cruzible app to receive native AETHEL."
                          : `Unbonding — claimable ${new Date(w.completionTime * 1000).toLocaleString()}.`}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })()}

    </div>
  );
}
