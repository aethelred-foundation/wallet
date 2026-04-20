import { useCallback, useState, useMemo } from "react";
import { Coins, Landmark, Layers3, TrendingUp, Gift, ChevronRight, Wallet, EyeOff, Eye } from "lucide-react";
import { TokenLogo } from "../components/token-logo";
import { DappLogo } from "../components/dapp-logo";
import { Sparkline } from "../components/sparkline";
import { SkeletonTokenRow } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { CurrencyText } from "../components/currency-text";
import { usePortfolioManager } from "../services/services-context";
import { useComingSoon } from "../hooks/use-coming-soon";
import { useWalletState } from "../hooks/use-wallet-state";
import { useLiveBalances, type LiveToken } from "../hooks/use-live-balances";
import { SegmentedControl } from "../components/segmented-control";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

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

/* formatUsd was a local helper that concatenated "$" + compact notation
 * (e.g. "$5.4M"). It was replaced by <CurrencyText compact /> which
 * renders the symbol as a structured span so the "$" and number never
 * visually collide. See apps/extension/src/popup/components/currency-text.tsx. */

type SubTab = "assets" | "staking" | "defi";

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
  const portfolio = usePortfolioManager();
  const comingSoon = useComingSoon();
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
   * service worker for the active account. Staking + DeFi tabs still
   * read from `portfolio` (PortfolioManager) because there's no
   * on-chain source for staking positions / DeFi TVL in this scaffold
   * yet — those tabs will be migrated when the respective simulators
   * are replaced by real subgraph queries. */
  const activeAddress = state?.accounts[0]?.address;
  const {
    tokens: liveTokens,
    totalValue: liveTotal,
    isLoading: liveLoading,
    isRefreshing: liveRefreshing,
  } = useLiveBalances(activeAddress);

  /* Legacy mock data for the staking + DeFi tabs only. */
  const staking = portfolio.getStakingPositions();

  /* Filter out dust holdings when the toggle is on. Computed once per
   * render — the filter cost is negligible for typical wallet sizes. */
  const displayTokens = useMemo<LiveToken[]>(() => {
    if (!hideSmall) return liveTokens;
    return liveTokens.filter((t) => t.value >= SMALL_BALANCE_THRESHOLD);
  }, [liveTokens, hideSmall]);

  /* Adapt the live tokens into the AllocationRing's `AllocationInput`
   * shape by inferring a category from the symbol. */
  const allocationInput = useMemo<AllocationInput[]>(
    () => liveTokens.map((t) => ({
      category: inferCategory(t.symbol),
      value: t.value,
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
            { id: "staking", label: "Staking", icon: <Landmark size={12} />, badge: staking.length },
            { id: "defi", label: "DeFi", icon: <Layers3 size={12} /> },
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
                  <Sparkline symbol={t.symbol} width={40} height={18} positive={t.change24h >= 0} />
                  <div className="holding-value">
                    <div className="holding-usd">
                      <CurrencyText value={t.value} maximumFractionDigits={2} />
                    </div>
                    <div className={`holding-change ${t.change24h >= 0 ? "positive" : "negative"}`}>
                      {t.change24h >= 0 ? "+" : ""}
                      {t.change24h.toFixed(2)}%
                    </div>
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
        if (IS_PRODUCTION_BUILD) {
          return (
            <EmptyState
              icon={<Wallet size={26} />}
              title="Staking source unavailable"
              description="The wallet no longer shows seeded staking positions in production until a live staking reader is wired."
              tone="info"
            />
          );
        }

        /* ─── Staking — legacy mock data ────────────────
         * The staking tab still reads from `portfolio.getTokens()` because
         * there's no real on-chain staking source wired yet. This will be
         * replaced when we add a staking subgraph / validator reader. */
        const legacyTokens = portfolio.getTokens();
        const totalStakedUsd = legacyTokens.filter(t => t.token.category === "staking").reduce((s, t) => s + t.value, 0);
        const totalRewards = staking.reduce((s, p) => s + parseFloat(p.rewardsEarned.replace(/,/g, "")), 0);
        const claimable = staking.filter(p => p.status === "active" && parseFloat(p.rewardsEarned.replace(/,/g, "")) > 0);
        const avgApy = staking.length > 0 ? staking.reduce((s, p) => s + p.apy, 0) / staking.length : 0;

        return (
          <div>
            {/* Hero: Claimable Rewards */}
            <div className="stk-hero">
              <span className="stk-hero-label">Claimable Rewards</span>
              <h1 className="stk-hero-amount">
                {totalRewards.toLocaleString()}
                <span className="stk-hero-asset">AETHEL</span>
              </h1>
              <div className="stk-hero-meta">
                <div className="stk-hero-meta-item">
                  <span>Total Staked</span>
                  <strong>
                    <CurrencyText value={totalStakedUsd} compact maximumFractionDigits={1} />
                  </strong>
                </div>
                <div className="stk-hero-meta-divider" />
                <div className="stk-hero-meta-item">
                  <span>Avg APY</span>
                  <strong style={{ color: "var(--success)" }}>{avgApy.toFixed(1)}%</strong>
                </div>
                <div className="stk-hero-meta-divider" />
                <div className="stk-hero-meta-item">
                  <span>Positions</span>
                  <strong>{staking.length}</strong>
                </div>
              </div>
              {claimable.length > 0 && (
                <button
                  className="stk-claim-all is-coming-soon"
                  type="button"
                  onClick={() =>
                    comingSoon(
                      `Claim ${totalRewards.toLocaleString()} AETHEL`,
                      "reward claiming ships in v1.0",
                    )
                  }
                >
                  <Gift size={14} /> Claim All Rewards
                </button>
              )}
            </div>

            {/* Position cards */}
            <div className="section-header"><h3>Positions</h3></div>
            {staking.map((pos, i) => {
              const isActive = pos.status === "active";
              const isUnbonding = pos.status === "unbonding";
              const daysRemaining = pos.unbondingEndsAt ? Math.ceil((pos.unbondingEndsAt - Date.now()) / 86400000) : 0;
              const unbondingPct = pos.unbondingEndsAt
                ? Math.min(100, ((14 * 86400000 - (pos.unbondingEndsAt - Date.now())) / (14 * 86400000)) * 100)
                : 0;
              const rewardsNum = parseFloat(pos.rewardsEarned.replace(/,/g, ""));

              /* Map protocol name to its canonical dApp logo (consistent across the app) */
              const dappName = pos.protocol.replace(/\s+Vault$/, "");

              return (
                <div className="stk-card" key={i}>
                  {/* Top: protocol + APY badge */}
                  <div className="stk-card-top">
                    <div className="stk-dapp-logo">
                      <DappLogo name={dappName} size={36} />
                    </div>
                    <div className="stk-card-info">
                      <strong>{pos.protocol}</strong>
                      <span>Liquid Staking · {pos.asset}</span>
                    </div>
                    <div className="stk-apy-badge">
                      <strong>{pos.apy}%</strong>
                      <span>APY</span>
                    </div>
                  </div>

                  {/* Big staked amount */}
                  <div className="stk-staked">
                    <span className="stk-staked-label">Staked</span>
                    <div className="stk-staked-amount">
                      <strong>{pos.stakedAmount}</strong>
                      <span>{pos.asset}</span>
                    </div>
                  </div>

                  {/* Active state: rewards row with claim button */}
                  {isActive && rewardsNum > 0 && (
                    <div className="stk-rewards">
                      <div className="stk-rewards-info">
                        <TrendingUp size={14} className="stk-rewards-icon" />
                        <div>
                          <span className="stk-rewards-label">Rewards Earned</span>
                          <strong className="stk-rewards-value">+{pos.rewardsEarned} {pos.asset}</strong>
                        </div>
                      </div>
                      <button
                        className="stk-claim-btn is-coming-soon"
                        type="button"
                        onClick={() =>
                          comingSoon(
                            `Claim ${pos.rewardsEarned} ${pos.asset}`,
                            "reward claiming ships in v1.0",
                          )
                        }
                      >
                        Claim
                      </button>
                    </div>
                  )}

                  {/* Active with zero rewards: just show status */}
                  {isActive && rewardsNum === 0 && (
                    <div className="stk-status-row">
                      <div className="stk-status-dot stk-status-active" />
                      <span>Earning rewards</span>
                      <span className="compliance-badge cleared" style={{ marginLeft: "auto" }}>ACTIVE</span>
                    </div>
                  )}

                  {/* Unbonding state: circular countdown */}
                  {isUnbonding && (
                    <div className="stk-unbonding">
                      <div className="stk-unbonding-ring">
                        <svg width={56} height={56} viewBox="0 0 56 56">
                          <circle cx={28} cy={28} r={24} fill="none" stroke="var(--line)" strokeWidth={4} />
                          <circle
                            cx={28} cy={28} r={24}
                            fill="none"
                            stroke="var(--warning)"
                            strokeWidth={4}
                            strokeLinecap="round"
                            strokeDasharray={`${(unbondingPct / 100) * 2 * Math.PI * 24} ${2 * Math.PI * 24}`}
                            style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dasharray 600ms ease" }}
                          />
                        </svg>
                        <div className="stk-unbonding-days">
                          <strong>{daysRemaining}</strong>
                          <span>days</span>
                        </div>
                      </div>
                      <div className="stk-unbonding-info">
                        <strong>Unbonding in progress</strong>
                        <span>{daysRemaining} days until funds are withdrawable</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {tab === "defi" && (() => {
        if (IS_PRODUCTION_BUILD) {
          return (
            <EmptyState
              icon={<Layers3 size={26} />}
              title="Yield browser unavailable"
              description="The DeFi catalog is hidden in production until it is backed by real protocol discovery."
              tone="info"
            />
          );
        }

        /* ─── DeFi — Apple Grade ─────────────────────── */
        /* logoKind: "dapp" uses DappLogo, "token" uses TokenLogo — keeps visuals consistent across the app */
        type Protocol = {
          id: string; name: string; type: string; apy: number; tvl: string;
          risk: string; status: string; featured: boolean;
          logoKind: "dapp" | "token"; logoName: string;
        };
        const protocols: Protocol[] = [
          { id: "cruzible", name: "Cruzible Vault", type: "Liquid Staking", apy: 8.4, tvl: "$52.4M", risk: "Low", status: "Active", featured: true, logoKind: "dapp", logoName: "Cruzible" },
          { id: "buidl", name: "BlackRock BUIDL", type: "T-Bill Yield", apy: 5.12, tvl: "$2.1B", risk: "Low", status: "Available", featured: false, logoKind: "token", logoName: "BUIDL" },
          { id: "usdy", name: "Ondo USDY", type: "Treasury Yield", apy: 5.35, tvl: "$342M", risk: "Low", status: "Available", featured: false, logoKind: "token", logoName: "USDY" },
          { id: "aave", name: "Aave V3", type: "Lending", apy: 3.2, tvl: "$12.8B", risk: "Medium", status: "Available", featured: false, logoKind: "token", logoName: "AAVE" },
          { id: "compound", name: "Compound V3", type: "Lending", apy: 2.8, tvl: "$3.4B", risk: "Medium", status: "Available", featured: false, logoKind: "token", logoName: "COMP" },
        ];
        const maxApy = Math.max(...protocols.map(p => p.apy));
        const avgTvl = protocols.length;

        return (
          <div>
            {/* Hero: Discover Yield */}
            <div className="defi-hero">
              <span className="defi-hero-label">Discover Yield</span>
              <h1 className="defi-hero-amount">
                <span className="defi-hero-up">↑</span>
                {maxApy.toFixed(1)}
                <span className="defi-hero-pct">%</span>
              </h1>
              <span className="defi-hero-sub">Best APY available across {avgTvl} protocols</span>
            </div>

            {/* Empty state banner — compact */}
            <div className="defi-empty-banner">
              <div className="defi-empty-icon">
                <Layers3 size={16} />
              </div>
              <div className="defi-empty-text">
                <strong>No active positions</strong>
                <span>Start earning by choosing a protocol below</span>
              </div>
            </div>

            {/* Featured protocol */}
            {protocols.filter(p => p.featured).map((p) => (
              <div className="defi-featured-card" key={p.id}>
                <div className="defi-featured-header">
                  <span className="defi-featured-tag">★ FEATURED</span>
                </div>
                <div className="defi-featured-body">
                  <div className="defi-logo-wrap defi-logo-lg">
                    {p.logoKind === "dapp"
                      ? <DappLogo name={p.logoName} size={40} />
                      : <TokenLogo symbol={p.logoName} size={40} />}
                  </div>
                  <div className="defi-card-main">
                    <strong>{p.name}</strong>
                    <span>{p.type}</span>
                  </div>
                  <div className="defi-apy-big">
                    <strong>{p.apy}%</strong>
                    <span>APY</span>
                  </div>
                </div>
                <div className="defi-featured-stats">
                  <div className="defi-stat">
                    <span className="defi-stat-label">TVL</span>
                    <strong>{p.tvl}</strong>
                  </div>
                  <div className="defi-stat-divider" />
                  <div className="defi-stat">
                    <span className="defi-stat-label">Risk</span>
                    <strong style={{ color: "var(--success)" }}>{p.risk}</strong>
                  </div>
                  <div className="defi-stat-divider" />
                  <div className="defi-stat">
                    <span className="defi-stat-label">Status</span>
                    <strong style={{ color: "var(--success)" }}>● {p.status}</strong>
                  </div>
                </div>
                <button
                  className="defi-featured-btn is-coming-soon"
                  type="button"
                  onClick={() => comingSoon(`Open ${p.name}`, "DeFi browser ships in v1.0")}
                >
                  Start Earning <ChevronRight size={14} />
                </button>
              </div>
            ))}

            {/* Other protocols — compact cards */}
            <div className="section-header"><h3>More Protocols</h3></div>
            {protocols.filter(p => !p.featured).map((p) => (
              <div
                className="defi-card is-coming-soon"
                key={p.id}
                onClick={() => comingSoon(`Open ${p.name}`, "DeFi browser ships in v1.0")}
                role="button"
                tabIndex={0}
              >
                <div className="defi-logo-wrap">
                  {p.logoKind === "dapp"
                    ? <DappLogo name={p.logoName} size={34} />
                    : <TokenLogo symbol={p.logoName} size={34} />}
                </div>
                <div className="defi-card-main">
                  <strong>{p.name}</strong>
                  <span>{p.type} · TVL {p.tvl}</span>
                </div>
                <div className="defi-card-apy">
                  <strong>{p.apy}%</strong>
                  <span>APY</span>
                </div>
                <ChevronRight size={16} className="defi-card-chevron" />
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
