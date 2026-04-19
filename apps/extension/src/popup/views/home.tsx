import { useState } from "react";
import type { CSSProperties } from "react";
import { TrendingUp, TrendingDown, ShieldCheck, Bell, Star, Zap, Globe, ArrowUpRight, ArrowDownLeft, Repeat, FileCheck, ChevronRight, AlertTriangle, CheckCircle2, Activity, Coins, Flame, Info } from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { usePortfolioManager } from "../services/services-context";
import { TokenLogo } from "../components/token-logo";
import { DappLogo } from "../components/dapp-logo";
import { Sparkline } from "../components/sparkline";
import { useLivePrices, getPrice } from "../hooks/use-live-prices";

function formatFull(v: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function formatPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

type FeedTab = "top" | "trending" | "watchlist";

const LIVE_ALERTS = [
  { id: "a1", icon: ShieldCheck, color: "var(--success)", title: "AML screening passed", detail: "5M USDC inflow cleared", time: "2m" },
  { id: "a2", icon: Bell, color: "var(--warning)", title: "Approval pending", detail: "2.5M USDC settlement awaiting review", time: "10m" },
  { id: "a3", icon: Activity, color: "var(--accent)", title: "BUIDL yield update", detail: "BlackRock fund yield \u2192 5.12% APY", time: "1h" },
  { id: "a4", icon: AlertTriangle, color: "var(--warning)", title: "OFAC list updated", detail: "23 new addresses \u2014 portfolio clear", time: "2h" },
];

/* Token definitions (balances are mock, prices come from CoinGecko) */
const TOP_TOKENS = [
  { symbol: "AETHEL", name: "Aethelred", balance: "2,500,000" },
  { symbol: "stAETHEL", name: "Staked AETHEL", balance: "1,000,000" },
  { symbol: "USDC", name: "USD Coin", balance: "5,000,000" },
  { symbol: "BUIDL", name: "BlackRock BUIDL", balance: "3,000,000" },
  { symbol: "WETH", name: "Wrapped Ether", balance: "500" },
];

const TRENDING_SYMBOLS = [
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

const WATCHLIST_SYMBOLS = [
  { symbol: "AETHEL", name: "Aethelred" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "BUIDL", name: "BlackRock BUIDL" },
  { symbol: "WETH", name: "Wrapped Ether" },
  { symbol: "USDY", name: "Ondo USDY" },
];

const ECOSYSTEM = [
  { dapp: "Cruzible", metric: "TVL", value: "$52.4M", change: "+4.2%" },
  { dapp: "NoblePay", metric: "24h Vol", value: "$8.1M", change: "+12.5%" },
  { dapp: "ZeroID", metric: "IDs", value: "14,280", change: "+89" },
  { dapp: "Shiora", metric: "Users", value: "6,840", change: "+312" },
];

const PENDING = [
  { id: "p1", title: "Settlement review required", detail: "2.5M USDC \u2192 Partner VASP", urgency: "high" as const },
  { id: "p2", title: "KYC renewal in 30 days", detail: "Enhanced verification expires May 11", urgency: "medium" as const },
];

/* ─────────────────────────────────────────────────────────────
   Inline styles — lightweight Apple-grade look for legacy v1
   Uses existing CSS variables only; no new CSS file required.
   ───────────────────────────────────────────────────────────── */

const s: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "12px 14px 20px",
    color: "var(--ink)",
    background: "var(--bg)",
    minHeight: "100%",
  },
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 12,
    background: "color-mix(in srgb, var(--accent) 10%, var(--surface))",
    border: "1px solid color-mix(in srgb, var(--accent) 22%, transparent)",
    color: "var(--ink)",
    fontSize: 11.5,
    lineHeight: 1.4,
  },
  bannerIcon: {
    flex: "0 0 auto",
    color: "var(--accent)",
  },
  bannerText: {
    flex: 1,
    color: "var(--ink-subtle, var(--ink))",
    opacity: 0.9,
  },
  balanceCard: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 16,
    background: "var(--surface)",
    border: "1px solid var(--border, color-mix(in srgb, var(--ink) 10%, transparent))",
  },
  balanceLabel: {
    fontSize: 11,
    letterSpacing: 0.2,
    textTransform: "uppercase" as const,
    opacity: 0.6,
    marginBottom: 4,
  },
  balanceValue: {
    fontSize: 26,
    fontWeight: 600,
    lineHeight: 1.15,
    fontVariantNumeric: "tabular-nums" as const,
    letterSpacing: -0.3,
  },
  changePill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums" as const,
  },
  quickActionsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 8,
  },
  quickAction: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "12px 6px",
    borderRadius: 14,
    background: "var(--surface)",
    border: "1px solid var(--border, color-mix(in srgb, var(--ink) 10%, transparent))",
    color: "var(--ink)",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 500,
  },
  quickActionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "color-mix(in srgb, var(--accent) 12%, transparent)",
    color: "var(--accent)",
  },
  pendingCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "11px 12px",
    borderRadius: 12,
    background: "var(--surface)",
    border: "1px solid var(--border, color-mix(in srgb, var(--ink) 10%, transparent))",
    cursor: "pointer",
  },
  pendingDotHigh: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "var(--danger, #e74c3c)",
    flex: "0 0 auto",
  },
  pendingDotMedium: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "var(--warning, #f5a623)",
    flex: "0 0 auto",
  },
  pendingText: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  pendingTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--ink)",
  },
  pendingDetail: {
    fontSize: 11,
    opacity: 0.65,
  },
  pendingArrow: {
    opacity: 0.4,
    flex: "0 0 auto",
  },
  tabs: {
    display: "flex",
    gap: 6,
    padding: 4,
    borderRadius: 12,
    background: "color-mix(in srgb, var(--ink) 5%, var(--surface))",
    border: "1px solid var(--border, color-mix(in srgb, var(--ink) 8%, transparent))",
  },
  tab: {
    flex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    padding: "7px 8px",
    borderRadius: 9,
    fontSize: 11,
    fontWeight: 600,
    background: "transparent",
    border: "none",
    color: "var(--ink)",
    opacity: 0.6,
    cursor: "pointer",
  },
  tabActive: {
    background: "var(--surface)",
    opacity: 1,
    boxShadow: "0 1px 3px color-mix(in srgb, var(--ink) 10%, transparent)",
  },
  groupTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    marginBottom: 2,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.2,
    textTransform: "uppercase" as const,
    opacity: 0.55,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    background: "var(--surface)",
    border: "1px solid var(--border, color-mix(in srgb, var(--ink) 8%, transparent))",
    cursor: "pointer",
  },
  rowNonClick: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    background: "var(--surface)",
    border: "1px solid var(--border, color-mix(in srgb, var(--ink) 8%, transparent))",
  },
  rowBody: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--ink)",
  },
  rowSub: {
    fontSize: 11,
    opacity: 0.6,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  rowVal: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 2,
    fontVariantNumeric: "tabular-nums" as const,
  },
  rowValAmount: {
    fontSize: 12.5,
    fontWeight: 600,
  },
  rowValChange: {
    fontSize: 11,
    fontWeight: 500,
  },
  posText: { color: "var(--success, #2ecc71)" },
  negText: { color: "var(--danger, #e74c3c)" },
  rank: {
    width: 22,
    fontSize: 11,
    fontWeight: 600,
    opacity: 0.55,
    textAlign: "center" as const,
  },
  alertRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    background: "var(--surface)",
    border: "1px solid var(--border, color-mix(in srgb, var(--ink) 8%, transparent))",
  },
  alertIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "color-mix(in srgb, var(--ink) 6%, transparent)",
    flex: "0 0 auto",
  },
  alertBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--ink)",
  },
  alertDetail: {
    fontSize: 11,
    opacity: 0.6,
  },
  alertTime: {
    fontSize: 10.5,
    opacity: 0.5,
    fontVariantNumeric: "tabular-nums" as const,
  },
  yieldRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    background: "var(--surface)",
    border: "1px solid var(--border, color-mix(in srgb, var(--ink) 8%, transparent))",
  },
  yieldApy: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
  },
  footer: {
    display: "flex",
    justifyContent: "space-around",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    padding: "10px 12px",
    borderRadius: 12,
    background: "var(--surface)",
    border: "1px solid var(--border, color-mix(in srgb, var(--ink) 8%, transparent))",
    fontSize: 11,
    opacity: 0.75,
  },
  footerItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
};

function posBg(positive: boolean): CSSProperties {
  return positive
    ? { background: "color-mix(in srgb, var(--success, #2ecc71) 14%, transparent)", color: "var(--success, #2ecc71)" }
    : { background: "color-mix(in srgb, var(--danger, #e74c3c) 14%, transparent)", color: "var(--danger, #e74c3c)" };
}

export function HomeView({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const portfolio = usePortfolioManager();
  const [feedTab, setFeedTab] = useState<FeedTab>("top");
  const summary = portfolio.getPortfolio();
  const isPos = summary.totalChangePercent24h >= 0;

  // Real-time prices from CoinGecko (polls every 30s)
  const prices = useLivePrices(30000);

  return (
    <div style={s.page}>
      {/* Classic-home notice banner */}
      <div style={s.banner} role="note">
        <Info size={14} style={s.bannerIcon} />
        <span style={s.bannerText}>
          You're viewing the classic home. Switch to Apple-grade v2 in Settings &rarr; Developer Tools &rarr; Flags.
        </span>
      </div>

      {/* Balance card */}
      <section style={s.balanceCard}>
        <div>
          <div style={s.balanceLabel}>Total Balance</div>
          <div style={s.balanceValue}>{formatFull(summary.totalValue)}</div>
        </div>
        <div style={{ ...s.changePill, ...posBg(isPos) }}>
          {isPos ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>{isPos ? "+" : ""}{summary.totalChangePercent24h.toFixed(2)}%</span>
        </div>
      </section>

      {/* Quick actions */}
      <section style={s.quickActionsRow}>
        <button style={s.quickAction} onClick={() => navigate("send")} type="button">
          <span style={s.quickActionIcon}><ArrowUpRight size={15} /></span>
          <span>Transfer</span>
        </button>
        <button style={s.quickAction} onClick={() => navigate("swap")} type="button">
          <span style={s.quickActionIcon}><Repeat size={15} /></span>
          <span>Convert</span>
        </button>
        <button style={s.quickAction} onClick={() => navigate("approvals")} type="button">
          <span style={s.quickActionIcon}><FileCheck size={15} /></span>
          <span>Settle</span>
        </button>
        <button style={s.quickAction} onClick={() => navigate("receive")} type="button">
          <span style={s.quickActionIcon}><ArrowDownLeft size={15} /></span>
          <span>Request</span>
        </button>
      </section>

      {/* Pending actions */}
      {PENDING.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {PENDING.map((a) => (
            <div
              key={a.id}
              style={s.pendingCard}
              onClick={() => navigate("approvals")}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate("approvals"); }}
            >
              <div style={a.urgency === "high" ? s.pendingDotHigh : s.pendingDotMedium} />
              <div style={s.pendingText}>
                <strong style={s.pendingTitle}>{a.title}</strong>
                <span style={s.pendingDetail}>{a.detail}</span>
              </div>
              <ChevronRight size={14} style={s.pendingArrow} />
            </div>
          ))}
        </section>
      )}

      {/* Feed tabs */}
      <div style={s.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={feedTab === "top"}
          style={{ ...s.tab, ...(feedTab === "top" ? s.tabActive : {}) }}
          onClick={() => setFeedTab("top")}
        >
          <Zap size={12} /> Top
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={feedTab === "trending"}
          style={{ ...s.tab, ...(feedTab === "trending" ? s.tabActive : {}) }}
          onClick={() => setFeedTab("trending")}
        >
          <Flame size={12} /> Trending
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={feedTab === "watchlist"}
          style={{ ...s.tab, ...(feedTab === "watchlist" ? s.tabActive : {}) }}
          onClick={() => setFeedTab("watchlist")}
        >
          <Star size={12} /> Watchlist
        </button>
      </div>

      {/* ── TOP TAB ── */}
      {feedTab === "top" && (
        <>
          <div style={s.groupTitle}><Coins size={12} /> Tokens ({TOP_TOKENS.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {TOP_TOKENS.map((t) => {
              const p = getPrice(prices, t.symbol);
              const positive = p.change24h >= 0;
              return (
                <div
                  key={t.symbol}
                  style={s.row}
                  onClick={() => navigate("portfolio")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") navigate("portfolio"); }}
                >
                  <TokenLogo symbol={t.symbol} size={32} />
                  <div style={s.rowBody}>
                    <strong style={s.rowTitle}>{t.symbol}</strong>
                    <span style={s.rowSub}>{t.balance} {t.symbol}</span>
                  </div>
                  <Sparkline symbol={t.symbol} width={40} height={16} positive={positive} />
                  <div style={s.rowVal}>
                    <strong style={s.rowValAmount}>${formatPrice(p.price)}</strong>
                    <span style={{ ...s.rowValChange, ...(positive ? s.posText : s.negText) }}>
                      {positive ? "+" : ""}{p.change24h.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ ...s.groupTitle, marginTop: 8 }}><Activity size={12} /> Live Activity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {LIVE_ALERTS.map((a) => (
              <div key={a.id} style={s.alertRow}>
                <div style={{ ...s.alertIconWrap, color: a.color }}><a.icon size={14} /></div>
                <div style={s.alertBody}>
                  <div style={s.alertTitle}>{a.title}</div>
                  <div style={s.alertDetail}>{a.detail}</div>
                </div>
                <span style={s.alertTime}>{a.time}</span>
              </div>
            ))}
          </div>

          <div style={s.groupTitle}><Globe size={12} /> Ecosystem</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ECOSYSTEM.map((e) => (
              <div key={e.dapp} style={s.rowNonClick}>
                <DappLogo name={e.dapp} size={30} />
                <div style={s.rowBody}>
                  <strong style={s.rowTitle}>{e.dapp}</strong>
                  <span style={s.rowSub}>{e.metric}</span>
                </div>
                <div style={s.rowVal}>
                  <strong style={s.rowValAmount}>{e.value}</strong>
                  <span style={{ ...s.rowValChange, ...s.posText }}>{e.change}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── TRENDING TAB ── */}
      {feedTab === "trending" && (
        <>
          <div style={s.groupTitle}><Flame size={12} /> Trending Now &mdash; Top 10</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {TRENDING_SYMBOLS.map((m, idx) => {
              const p = getPrice(prices, m.symbol);
              const positive = p.change24h >= 0;
              return (
                <div key={m.symbol} style={s.rowNonClick}>
                  <span style={s.rank}>#{idx + 1}</span>
                  <TokenLogo symbol={m.symbol} size={30} />
                  <div style={s.rowBody}>
                    <strong style={s.rowTitle}>{m.symbol}</strong>
                    <span style={s.rowSub}>{m.name}</span>
                  </div>
                  <Sparkline symbol={m.symbol} width={44} height={18} positive={positive} />
                  <div style={s.rowVal}>
                    <strong style={s.rowValAmount}>${formatPrice(p.price)}</strong>
                    <span style={{ ...s.rowValChange, ...(positive ? s.posText : s.negText) }}>
                      {positive ? "+" : ""}{p.change24h.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ ...s.groupTitle, marginTop: 8 }}><Star size={12} /> Top Yields</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { name: "Cruzible Vault", type: "Liquid Staking", apy: "8.4%" },
              { name: "BlackRock BUIDL", type: "T-Bill Yield", apy: "5.12%" },
              { name: "Ondo USDY", type: "Treasury Yield", apy: "5.35%" },
            ].map((y) => (
              <div key={y.name} style={s.yieldRow}>
                <div style={s.rowBody}>
                  <strong style={s.rowTitle}>{y.name}</strong>
                  <span style={s.rowSub}>{y.type}</span>
                </div>
                <div style={s.yieldApy}>
                  <strong style={{ ...s.rowValAmount, ...s.posText }}>{y.apy}</strong>
                  <span style={{ fontSize: 10, opacity: 0.55 }}>APY</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── WATCHLIST TAB ── */}
      {feedTab === "watchlist" && (
        <>
          <div style={s.groupTitle}><Star size={12} /> Watchlist</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {WATCHLIST_SYMBOLS.map((t) => {
              const p = getPrice(prices, t.symbol);
              const positive = p.change24h >= 0;
              return (
                <div key={t.symbol} style={s.rowNonClick}>
                  <TokenLogo symbol={t.symbol} size={30} />
                  <div style={s.rowBody}>
                    <strong style={s.rowTitle}>{t.symbol}</strong>
                    <span style={s.rowSub}>{t.name}</span>
                  </div>
                  <Sparkline symbol={t.symbol} width={44} height={18} positive={positive} />
                  <div style={s.rowVal}>
                    <strong style={s.rowValAmount}>${formatPrice(p.price)}</strong>
                    <span style={{ ...s.rowValChange, ...(positive ? s.posText : s.negText) }}>
                      {positive ? "+" : ""}{p.change24h.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Compliance footer */}
      <section style={s.footer}>
        <div style={s.footerItem}><CheckCircle2 size={12} /> KYC Verified</div>
        <div style={s.footerItem}><ShieldCheck size={12} /> AML Clear</div>
        <div style={s.footerItem}><Bell size={12} /> {state.pendingApprovals.length} Pending</div>
      </section>
    </div>
  );
}
