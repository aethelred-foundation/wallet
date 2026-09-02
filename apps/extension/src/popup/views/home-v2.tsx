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

import { useCallback, useState } from "react";
import {
  TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownLeft, Repeat, FileCheck,
  ChevronDown,
  CircleDot,
} from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { Wallet, Plus } from "lucide-react";
import { useNavigation } from "../router";
import { TokenLogo } from "../components/token-logo";
import { AnimatedNumber } from "../components/animated-number";
import { CurrencyText } from "../components/currency-text";
import { GradientMeshBg } from "../components/gradient-mesh-bg";
import { Skeleton } from "../components/skeleton";
import { TokenRowSkeleton } from "../components/skeleton-shapes";
import { EmptyState } from "../components/empty-state";
import { PressableButton } from "../components/micro/PressableButton";
import { useSharedElement } from "../components/hero-transition";
import { useScrollOpacity } from "../hooks/use-scroll-timeline";
import { useLivePrices, getPrice } from "../hooks/use-live-prices";
import { useLiveBalances } from "../hooks/use-live-balances";
import { useFormat } from "../i18n/format";
import { isViewReleased } from "../lib/feature-availability";

/* Local formatters still used by the ticker and token rows. The hero
 * balance card now uses `useFormat().formatCurrency` so it respects the
 * user's locale/currency selection in Settings. `fmtBalance` was removed
 * as dead code along with that migration. */
function fmtPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

const TICKER_SYMBOLS = ["BTC", "WETH", "SOL", "USDC", "BUIDL", "EURC", "USDY", "PYUSD"];

/* ─── Component ─────────────────────────────────────────────── */
export function HomeViewV2({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const { formatPercent } = useFormat();
  const balanceHero = useSharedElement("hero-balance");
  /* Scroll-linked fade: as the user scrolls past the hero, the live
   * ticker's opacity slowly drops from 1 to ~0.6. It remains visible but
   * defers focus to the content below — an Apple "ambient deference"
   * trick borrowed from iOS 17's live-activities pattern. */
  const tickerScrollOpacity = useScrollOpacity(balanceHero.ref as React.RefObject<HTMLElement>, {
    start: "center",
    end: "bottom",
  });
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
  const activeAddress = state.activeAccountId
    ? state.accounts.find((account) => account.id === state.activeAccountId)?.address ??
      state.accounts[0]?.address
    : state.accounts[0]?.address;
  const {
    tokens: liveTokens,
    totalValue,
    totalChangePercent24h,
    isLoading: balancesLoading,
    isRefreshing: balancesRefreshing,
  } = useLiveBalances(activeAddress);

  const isPos = totalChangePercent24h >= 0;
  const prices = useLivePrices(30000);

  /* ─── Stable event handlers (perf-critical path) ─────────── *
   * This view renders on every live-balance poll (~30s) and every
   * live-price tick (~30s). Each poll triggers a re-render of every
   * child, and the children passed down include `<EmptyState>` —
   * which IS memoized and keys on its `action.onClick` prop's identity.
   * Without stable refs, EmptyState would repaint on every tick even
   * when nothing user-visible has changed.
   *
   * Verified via React DevTools Profiler while running the balance
   * poll on a mocked wallet: before this pass, EmptyState re-rendered
   * ~2× per minute; after, only on genuine state transitions. */
  const navigateReceive = useCallback(() => navigate("receive"), [navigate]);
  const navigateOnboarding = useCallback(() => navigate("onboarding-create"), [navigate]);
  const navigatePortfolio = useCallback(() => navigate("portfolio"), [navigate]);
  const showAll = useCallback(() => setShowAllTokens(true), []);

  const hasBalances = liveTokens.length > 0;
  const hasPricedBalances = liveTokens.some((token) => token.value !== null);
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
        <h1
          className="v2-balance type-hero"
          ref={balanceHero.ref as React.RefObject<HTMLHeadingElement>}
          style={{ viewTransitionName: balanceHero.transitionName }}
        >
          {!hasWallet ? (
            <span className="v2-balance-placeholder">—</span>
          ) : balancesLoading ? (
            <Skeleton width="60%" height={56} radius={12} />
          ) : hasPricedBalances ? (
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
          ) : (
            <span className="v2-balance-placeholder">—</span>
          )}
        </h1>

        <div className="v2-balance-footer">
          {hasWallet && !balancesLoading && hasPricedBalances ? (
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
          ) : hasBalances ? (
            <span className="v2-change-label v2-empty-hint">
              Holdings are unpriced until an authoritative market feed is available
            </span>
          ) : (
            <span className="v2-change-label v2-empty-hint">
              No tokens yet — transfer funds to get started
            </span>
          )}
        </div>

        {/* Quick Actions embedded in balance card.
         * Each button uses PressableButton so we get scale-on-press +
         * haptic selection feedback on every tap with zero per-site
         * boilerplate. */}
        <div className="v2-actions-grouped motion-stagger">
          {[
            { icon: ArrowUpRight, label: "Send", view: "send" as const, cls: "v2-qa-send" },
            { icon: ArrowDownLeft, label: "Receive", view: "receive" as const, cls: "v2-qa-receive" },
            { icon: Repeat, label: "Swap", view: "swap" as const, cls: "v2-qa-convert" },
            { icon: FileCheck, label: "Settle", view: "approvals" as const, cls: "v2-qa-settle" },
          ].filter((action) => isViewReleased(action.view)).map((a) => (
            <PressableButton
              className="v2-action motion-fade-up"
              key={a.label}
              onClick={() => navigate(a.view)}
              haptic="impact-light"
            >
              <div className={`v2-action-icon ${a.cls}`}><a.icon size={16} strokeWidth={2.3} /></div>
              <span>{a.label}</span>
            </PressableButton>
          ))}
        </div>
      </section>

      {/* ─── Ambient Ticker with token logos ─── */}
      {TICKER_SYMBOLS.some((sym) => getPrice(prices, sym).price > 0) && (
        <div
          className="v2-ticker motion-fade-up"
          style={{ animationDelay: "200ms", opacity: 0.6 + tickerScrollOpacity * 0.4 }}
        >
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

      {/* ─── Authoritative on-chain holdings ─── */}
      <section className="v2-section motion-stagger">
          {/* Four states:
           *   1. Wallet loading (first fetch)      → 3 skeleton rows
           *   2. Wallet with real holdings          → render live tokens
           *   3. Wallet with zero balance           → empty state
           *   4. No wallet yet (onboarding pending) → empty state */}
          {hasWallet && balancesLoading ? (
            <>
              <TokenRowSkeleton />
              <TokenRowSkeleton />
              <TokenRowSkeleton />
            </>
          ) : hasBalances ? (
            (showAllTokens ? liveTokens : liveTokens.slice(0, 5)).map((t, idx) => (
              <div
                className="v2-token-card motion-fade-up motion-lift motion-press"
                key={`${t.address}-${t.symbol}`}
                onClick={navigatePortfolio}
                role="button"
                tabIndex={0}
                style={{ animationDelay: `${300 + idx * 60}ms` }}
              >
                <TokenLogo symbol={t.symbol} size={36} />
                <div className="v2-token-info">
                  <strong>{t.symbol}</strong>
                  <span>{t.name}</span>
                </div>
                <div className="v2-token-price">
                  {t.value === null || t.change24h === null ? (
                    <strong>Unpriced</strong>
                  ) : (
                    <>
                      <strong>
                        <CurrencyText value={t.value} maximumFractionDigits={0} minimumFractionDigits={0} />
                      </strong>
                      <span className={t.change24h >= 0 ? "up" : "down"}>
                        {t.change24h >= 0 ? "+" : ""}
                        {t.change24h.toFixed(2)}%
                      </span>
                    </>
                  )}
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
                onClick: navigateReceive,
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
                onClick: navigateOnboarding,
              }}
            />
          )}

          {hasBalances && !showAllTokens && liveTokens.length > 5 && (
            <button className="v2-see-all" onClick={showAll} type="button">
              <span>See All ({liveTokens.length})</span>
              <ChevronDown size={14} />
            </button>
          )}
      </section>

    </div>
  );
}
