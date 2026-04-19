/**
 * Aethelred Wallet — Home V2 (Premium)
 *
 * Apple Wallet-inspired redesign. Design pillars:
 *   1. Balance as hero — centered, massive, glowing
 *   2. Glass cards — depth via backdrop-blur + elevation
 *   3. Color restraint — monochrome base, color = meaning only
 *   4. Micro-interactions — scale-on-press, smooth transitions
 *   5. Progressive disclosure — show less, reveal more
 *   6. Ambient data — ticker as subtle environmental texture
 */

import { useState, useMemo } from "react";
import {
  TrendingUp, TrendingDown, ShieldCheck, Bell, Star, Globe,
  ArrowUpRight, ArrowDownLeft, Repeat, FileCheck,
  CheckCircle2, Coins, Flame, ChevronDown,
  CircleDot,
} from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { Wallet, Plus } from "lucide-react";
import { useNavigation } from "../router";
import { TokenLogo } from "../components/token-logo";
import { DappLogo } from "../components/dapp-logo";
import { Sparkline } from "../components/sparkline";
import { AnimatedNumber } from "../components/animated-number";
import { CurrencyText } from "../components/currency-text";
import { LiveSparkline } from "../components/live-sparkline";
import { GradientMeshBg } from "../components/gradient-mesh-bg";
import { Skeleton, SkeletonTokenRow } from "../components/skeleton";
import { EmptyState } from "../components/empty-state";
import { useLivePrices, getPrice } from "../hooks/use-live-prices";
import { useLiveBalances } from "../hooks/use-live-balances";
import { useFormat } from "../i18n/format";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

/* Local formatters still used by the ticker and token rows. The hero
 * balance card now uses `useFormat().formatCurrency` so it respects the
 * user's locale/currency selection in Settings. `fmtBalance` was removed
 * as dead code along with that migration. */
function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function fmtChange(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

type FeedTab = "tokens" | "trending" | "watchlist";

/* ─── Data ──────────────────────────────────────────────────── */
const DEMO_TRENDING = IS_PRODUCTION_BUILD ? [] : [
  { symbol: "AETHEL", name: "Aethelred" },
  { symbol: "stAETHEL", name: "Staked AETHEL" },
  { symbol: "BTC", name: "Bitcoin" },
  { symbol: "WETH", name: "Ethereum" },
  { symbol: "SOL", name: "Solana" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "EURC", name: "Euro Coin" },
  { symbol: "BUIDL", name: "BlackRock BUIDL" },
  { symbol: "USDY", name: "Ondo USDY" },
  { symbol: "PYUSD", name: "PayPal USD" },
];

const DEMO_WATCHLIST = IS_PRODUCTION_BUILD ? [] : [
  { symbol: "AETHEL", name: "Aethelred" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "BUIDL", name: "BlackRock BUIDL" },
  { symbol: "WETH", name: "Wrapped Ether" },
  { symbol: "USDY", name: "Ondo USDY" },
];

const TICKER_SYMBOLS = ["AETHEL", "stAETHEL", "BTC", "WETH", "SOL", "USDC", "BUIDL", "EURC", "USDY", "PYUSD"];

const ECOSYSTEM = [
  { dapp: "Cruzible", desc: "Liquid Staking", metric: "$52.4M TVL", accent: "#c41e1e" },
  { dapp: "NoblePay", desc: "Payments", metric: "$8.1M Vol", accent: "#1d7f52" },
  { dapp: "ZeroID", desc: "Identity", metric: "14,280 IDs", accent: "#2775ca" },
  { dapp: "Shiora", desc: "Health Data", metric: "6,840 Users", accent: "#8b5cf6" },
];

const ALERTS = IS_PRODUCTION_BUILD ? [] : [
  { id: "1", text: "AML screening passed — 5M USDC cleared", time: "2m", type: "success" as const },
  { id: "2", text: "Settlement awaiting 2-of-3 approval", time: "10m", type: "warning" as const },
];

/* Generate a plausible 24-point sparkline for the balance card from the
 * current total value + change percent. Walks backward from the current
 * value, distributing the change across 24 hourly buckets with a small
 * amount of seeded jitter so the line looks organic instead of linear.
 * Seed is derived from the total so the same value always produces the
 * same line (no visual jitter on re-renders). */
function deriveBalanceSparkline(totalValue: number, changePercent: number): number[] {
  const points = 24;
  const startValue = totalValue / (1 + changePercent / 100);
  const delta = totalValue - startValue;
  let seed = Math.floor(totalValue) % 10000;
  // mulberry32 seeded PRNG — deterministic per totalValue
  const rng = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const jitterMagnitude = Math.abs(delta) * 0.12 + totalValue * 0.002;
  return Array.from({ length: points }, (_, i) => {
    const progress = i / (points - 1);
    const base = startValue + delta * progress;
    const jitter = (rng() - 0.5) * 2 * jitterMagnitude;
    return base + jitter;
  });
}

/* ─── Component ─────────────────────────────────────────────── */
export function HomeViewV2({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const { formatPercent } = useFormat();
  const [feedTab, setFeedTab] = useState<FeedTab>("tokens");
  const [showAllTokens, setShowAllTokens] = useState(false);

  /* ─── Real on-chain balances ──────────────────────────────── *
   * Previously this view read from `PortfolioManager.getPortfolio()`
   * which returned hardcoded mock balances (2.5M AETHEL / 5M USDC /
   * 3M BUIDL) regardless of whether the user had a wallet. Now we
   * hit background → BalanceFetcher → real eth_call balanceOf for
   * the active account, enriched with CoinGecko prices.
   *
   * `address` is undefined until the user completes onboarding; in
   * that case `useLiveBalances` returns empty tokens + isLoading:false
   * and we render an empty-state CTA further down. */
  const activeAddress = state.accounts[0]?.address;
  const {
    tokens: liveTokens,
    totalValue,
    totalChangePercent24h,
    isLoading: balancesLoading,
    isRefreshing: balancesRefreshing,
  } = useLiveBalances(activeAddress);

  const isPos = totalChangePercent24h >= 0;
  const prices = useLivePrices(30000);

  /* Derive a synthetic 24-hour sparkline from the current totals.
   * useMemo keeps the array reference stable so LiveSparkline's
   * draw-in animation only runs on genuine data changes. */
  const balanceSpark = useMemo(
    () => deriveBalanceSparkline(totalValue, totalChangePercent24h),
    [totalValue, totalChangePercent24h],
  );

  const hasRealBalances = liveTokens.length > 0;
  const hasWallet = !!activeAddress;

  return (
    <div className="v2">
      {/* ─── Premium Balance Card ───────────────────────────── *
       * Hero: 56px animated balance with a drawn-in sparkline ribbon
       * and an ambient three-color gradient mesh background. The whole
       * card fades-up on mount via the motion-fade-up utility, and
       * its children stagger via motion-stagger. */}
      <section className="v2-balance-card motion-fade-up motion-stagger">
        {/* Ambient animated gradient mesh — three orbiting blobs.
            bareMode=true so it renders as a background layer that the
            card's own wrapper positions. */}
        <GradientMeshBg
          colors={["#c41e1e", "#8b5cf6", "#0ea5e9"]}
          intensity={0.28}
          blur={70}
          bareMode
        />

        <div className="v2-balance-header">
          <div className="v2-balance-eyebrow">
            <CircleDot size={7} className={hasWallet ? "v2-pulse" : ""} />
            <span>{hasWallet ? "Total Balance" : "Balance"}</span>
          </div>
          <span className="v2-balance-currency">USD</span>
        </div>

        {/* Hero number — three states:
         *   1. No wallet → empty-state dash ("—")
         *   2. Wallet + first fetch in flight → skeleton placeholder
         *   3. Wallet with data → AnimatedNumber count-up to real total
         *
         * The AnimatedNumber only animates when `value` changes, so
         * subsequent polls don't re-trigger the count-up — only the
         * initial load or a user action (sending) does. */}
        <h1 className="v2-balance type-hero">
          {!hasWallet ? (
            <span className="v2-balance-placeholder">—</span>
          ) : balancesLoading ? (
            <Skeleton width="60%" height={56} radius={12} />
          ) : (
            <AnimatedNumber
              value={totalValue}
              from={0}
              duration={1400}
              format={(v) => (
                <CurrencyText
                  value={v}
                  maximumFractionDigits={0}
                  minimumFractionDigits={0}
                />
              )}
            />
          )}
        </h1>

        {/* Ambient sparkline ribbon — only renders when we have real
         * data. Showing a flat sparkline over "—" would be misleading. */}
        {hasWallet && !balancesLoading && hasRealBalances && (
          <div className="v2-balance-spark" aria-hidden="true">
            <LiveSparkline
              data={balanceSpark}
              width={320}
              height={44}
              strokeWidth={2}
              colors={isPos ? ["#34c759", "#6bd880"] : ["#ff3b30", "#ff6b6b"]}
              drawDuration={1100}
            />
          </div>
        )}

        <div className="v2-balance-footer">
          {hasWallet && !balancesLoading && hasRealBalances ? (
            <>
              <div className={`v2-change-pill ${isPos ? "up" : "down"}`}>
                {isPos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                <span>{formatPercent(totalChangePercent24h / 100)}</span>
              </div>
              <span className="v2-change-label">
                last 24h
                {balancesRefreshing && <span className="v2-refreshing"> · refreshing…</span>}
              </span>
            </>
          ) : !hasWallet ? (
            <span className="v2-change-label v2-empty-hint">
              Create or import a wallet to see your balance
            </span>
          ) : balancesLoading ? (
            <Skeleton width={120} height={14} />
          ) : (
            <span className="v2-change-label v2-empty-hint">
              No tokens yet — transfer funds to get started
            </span>
          )}
        </div>

        {/* Quick Actions embedded in balance card */}
        <div className="v2-actions-grouped motion-stagger">
          {[
            { icon: ArrowUpRight, label: "Send", view: "send" as const, cls: "v2-qa-send" },
            { icon: ArrowDownLeft, label: "Receive", view: "receive" as const, cls: "v2-qa-receive" },
            { icon: Repeat, label: "Swap", view: "swap" as const, cls: "v2-qa-convert" },
            { icon: FileCheck, label: "Settle", view: "approvals" as const, cls: "v2-qa-settle" },
          ].map((a) => (
            <button
              className="v2-action motion-press motion-fade-up"
              key={a.label}
              onClick={() => navigate(a.view)}
              type="button"
            >
              <div className={`v2-action-icon ${a.cls}`}><a.icon size={16} strokeWidth={2.3} /></div>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ─── Alerts — premium cards ─── */}
        {ALERTS.length > 0 && (
          <section className="v2-alerts motion-fade-up" style={{ animationDelay: "120ms" }}>
            {ALERTS.map((a) => (
            <div className={`v2-alert v2-alert-${a.type}`} key={a.id}>
              <div className="v2-alert-icon">
                {a.type === "success" ? <CheckCircle2 size={13} /> : <Bell size={13} />}
              </div>
              <span className="v2-alert-text">{a.text}</span>
              <span className="v2-alert-time">{a.time}</span>
            </div>
          ))}
        </section>
      )}

      {/* ─── Ambient Ticker with token logos ─── */}
      {TICKER_SYMBOLS.some((sym) => getPrice(prices, sym).price > 0) && (
        <div className="v2-ticker motion-fade-up" style={{ animationDelay: "200ms" }}>
          <div className="v2-ticker-label">
            <CircleDot size={7} className="v2-pulse" />
            <span>LIVE</span>
          </div>
          <div className="v2-ticker-track">
            {[...TICKER_SYMBOLS, ...TICKER_SYMBOLS]
              .map((sym, i) => ({ sym, i, price: getPrice(prices, sym) }))
              .filter(({ price }) => price.price > 0)
              .map(({ sym, i, price: p }) => (
                <span className="v2-ticker-item" key={`${sym}-${i}`}>
                  <TokenLogo symbol={sym} size={14} />
                  <span className="v2-ticker-sym">{sym}</span>
                  <span className="v2-ticker-price">{fmtPrice(p.price)}</span>
                  <span className={p.change24h >= 0 ? "v2-ticker-up" : "v2-ticker-down"}>
                    {p.change24h >= 0 ? "↑" : "↓"}{Math.abs(p.change24h).toFixed(1)}%
                  </span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* ─── Feed Tabs ─── */}
      <div className="v2-tabs motion-fade-up" style={{ animationDelay: "260ms" }}>
        {([
          {
            key: "tokens" as const,
            icon: Coins,
            label: `Tokens (${hasRealBalances ? liveTokens.length : 0})`,
          },
          { key: "trending" as const, icon: Flame, label: "Trending" },
          { key: "watchlist" as const, icon: Star, label: "Watchlist" },
        ]).map((t) => (
          <button
            className={`v2-tab motion-press ${feedTab === t.key ? "active" : ""}`}
            key={t.key}
            onClick={() => setFeedTab(t.key)}
            type="button"
          >
            <t.icon size={12} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ─── Tokens Tab ─── */}
      {feedTab === "tokens" && (
        <section className="v2-section motion-stagger">
          {/* Four states:
           *   1. Wallet loading (first fetch)      → 3 skeleton rows
           *   2. Wallet with real holdings          → render live tokens
           *   3. Wallet with zero balance           → empty state
           *   4. No wallet yet (onboarding pending) → empty state */}
          {hasWallet && balancesLoading ? (
            <>
              <SkeletonTokenRow />
              <SkeletonTokenRow />
              <SkeletonTokenRow />
            </>
          ) : hasRealBalances ? (
            (showAllTokens ? liveTokens : liveTokens.slice(0, 5)).map((t, idx) => (
              <div
                className="v2-token-card motion-fade-up motion-lift motion-press"
                key={`${t.address}-${t.symbol}`}
                onClick={() => navigate("portfolio")}
                role="button"
                tabIndex={0}
                style={{ animationDelay: `${300 + idx * 60}ms` }}
              >
                <TokenLogo symbol={t.symbol} size={36} />
                <div className="v2-token-info">
                  <strong>{t.symbol}</strong>
                  <span>{t.name}</span>
                </div>
                <div className="v2-token-chart">
                  <Sparkline symbol={t.symbol} width={48} height={20} positive={t.change24h >= 0} />
                </div>
                <div className="v2-token-price">
                  <strong>
                    <CurrencyText value={t.value} maximumFractionDigits={0} minimumFractionDigits={0} />
                  </strong>
                  <span className={t.change24h >= 0 ? "up" : "down"}>
                    {t.change24h >= 0 ? "+" : ""}
                    {t.change24h.toFixed(2)}%
                  </span>
                </div>
              </div>
            ))
          ) : hasWallet ? (
            <EmptyState
              icon={<Wallet size={26} />}
              title="No tokens yet"
              description="Transfer funds into this account to see your holdings here."
              tone="info"
              action={{
                label: "Receive",
                icon: <Plus size={13} />,
                onClick: () => navigate("receive"),
              }}
            />
          ) : (
            <EmptyState
              icon={<Wallet size={26} />}
              title="No wallet yet"
              description="Create or import a wallet to see live balances here."
              tone="info"
              action={{
                label: "Get started",
                icon: <Plus size={13} />,
                onClick: () => navigate("onboarding-create"),
              }}
            />
          )}

          {hasRealBalances && !showAllTokens && liveTokens.length > 5 && (
            <button className="v2-see-all" onClick={() => setShowAllTokens(true)} type="button">
              <span>See All ({liveTokens.length})</span>
              <ChevronDown size={14} />
            </button>
          )}

          {/* Ecosystem */}
          <div className="v2-section-title">
            <Globe size={12} />
            <span>Ecosystem</span>
          </div>
          <div className="v2-eco-grid">
            {ECOSYSTEM.map((e) => (
              <div className="v2-eco-card" key={e.dapp} onClick={() => navigate("hub")} role="button" tabIndex={0}>
                <DappLogo name={e.dapp} size={28} />
                <strong>{e.dapp}</strong>
                <span className="v2-eco-desc">{e.desc}</span>
                <span className="v2-eco-metric">{e.metric}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Trending Tab ─── */}
      {feedTab === "trending" && (
        <section className="v2-section">
          {DEMO_TRENDING.length === 0 ? (
            <EmptyState
              icon={<Flame size={26} />}
              title="Trending view unavailable"
              description="Market spotlight cards are hidden in production until they are backed by a real ranking source."
              tone="info"
            />
          ) : (
            DEMO_TRENDING.map((t, idx) => {
              const p = getPrice(prices, t.symbol);
              return (
                <div className="v2-trending-row" key={t.symbol} style={{ animationDelay: `${idx * 30}ms` }}>
                  <span className="v2-rank">{idx + 1}</span>
                  <TokenLogo symbol={t.symbol} size={32} />
                  <div className="v2-trending-info">
                    <strong>{t.symbol}</strong>
                    <span>{t.name}</span>
                  </div>
                  <Sparkline symbol={t.symbol} width={44} height={18} positive={p.change24h >= 0} />
                  <div className="v2-trending-price">
                    <strong>{fmtPrice(p.price)}</strong>
                    <span className={p.change24h >= 0 ? "up" : "down"}>{fmtChange(p.change24h)}</span>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}

      {/* ─── Watchlist Tab ─── */}
      {feedTab === "watchlist" && (
        <section className="v2-section">
          {DEMO_WATCHLIST.length === 0 ? (
            <EmptyState
              icon={<Star size={26} />}
              title="Watchlist unavailable"
              description="Watchlist cards are hidden until they connect to a real watchlist source."
              tone="info"
            />
          ) : (
            DEMO_WATCHLIST.map((t, idx) => {
              const p = getPrice(prices, t.symbol);
              return (
                <div className="v2-token-card" key={t.symbol} style={{ animationDelay: `${idx * 40}ms` }}>
                  <TokenLogo symbol={t.symbol} size={36} />
                  <div className="v2-token-info">
                    <strong>{t.symbol}</strong>
                    <span>{t.name}</span>
                  </div>
                  <div className="v2-token-chart">
                    <Sparkline symbol={t.symbol} width={48} height={20} positive={p.change24h >= 0} />
                  </div>
                  <div className="v2-token-price">
                    <strong>{fmtPrice(p.price)}</strong>
                    <span className={p.change24h >= 0 ? "up" : "down"}>{fmtChange(p.change24h)}</span>
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}

      {/* ─── Compliance Strip ─── */}
      <footer className="v2-footer">
        <span><CheckCircle2 size={10} /> KYC</span>
        <span className="v2-footer-dot" />
        <span><ShieldCheck size={10} /> AML</span>
        <span className="v2-footer-dot" />
        <span><Bell size={10} /> {state.pendingApprovals.length}</span>
      </footer>
    </div>
  );
}
