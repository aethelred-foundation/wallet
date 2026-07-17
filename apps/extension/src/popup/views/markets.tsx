import { useState, useEffect } from "react";
import { assertNever } from "@aethelred/wallet-observability";
import { BarChart3, Search, FileText, Newspaper, ShieldAlert, ArrowUpDown, TrendingUp, TrendingDown, Loader2, ExternalLink, Clock, ArrowRight, BookOpen, Bookmark, AlertTriangle, Info, AlertOctagon, CheckCircle2, ShieldCheck } from "lucide-react";
import { TokenLogo } from "../components/token-logo";
import { Sparkline } from "../components/sparkline";
import { CurrencyText } from "../components/currency-text";
import { EmptyState } from "../components/empty-state";
import { usePortfolioManager } from "../services/services-context";
import { useComingSoon } from "../hooks/use-coming-soon";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

type SubTab = "tokens" | "research" | "news" | "risk";
type SortField = "name" | "price" | "change" | "value";

/* Precision helper — picks 0 / 2 / 4 fraction digits based on the
 * magnitude of the price. The old `formatPrice` also prepended a
 * literal "$" but the rendering now goes through <CurrencyText>,
 * which paints the currency symbol as its own span with a real
 * flex gap. Same locale-aware output, now with a visible separator
 * between the symbol and the number. */
function priceFractionDigits(p: number): number {
  if (p >= 1000) return 0;
  if (p >= 1) return 2;
  return 4;
}

// Fallback news if API unavailable
const FALLBACK_NEWS: NewsItem[] = IS_PRODUCTION_BUILD ? [] : [
  { id: "1", title: "BlackRock BUIDL fund surpasses $2B in tokenized treasury assets", source: "CoinDesk", time: "2h", category: "RWA", url: "https://www.coindesk.com/business/blackrock-buidl-tokenized-fund/" },
  { id: "2", title: "MiCA compliance deadline: EU VASPs must register by Q3 2026", source: "The Block", time: "4h", category: "Regulation", url: "https://www.theblock.co/topic/regulation" },
  { id: "3", title: "Circle launches EURC institutional settlement on Ethereum", source: "Bloomberg", time: "6h", category: "Stablecoins", url: "https://www.circle.com/eurc" },
  { id: "4", title: "FATF updates Travel Rule guidance for DeFi protocols", source: "Reuters", time: "8h", category: "Compliance", url: "https://www.fatf-gafi.org/en/topics/virtual-assets.html" },
  { id: "5", title: "Aethelred Cruzible vault TVL reaches $50M with 8.4% APY", source: "DeFi Pulse", time: "12h", category: "Protocol", url: "https://www.coingecko.com" },
];

type NewsItem = { id: string; title: string; source: string; time: string; category: string; url?: string };

async function fetchLiveNews(): Promise<NewsItem[]> {
  // Source 1: CoinGecko search/trending (always works, no auth)
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/search/trending", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("API error");
    const data = await res.json() as {
      coins?: Array<{ item: { id: string; name: string; symbol: string; data?: { price_change_percentage_24h?: Record<string, number> } } }>;
      nfts?: Array<{ name: string; symbol: string }>;
    };
    const trendingCoins = data.coins?.slice(0, 5) ?? [];
    /* Generate staggered "fresh" timestamps — the trending endpoint doesn't
       give per-item times, but the items ARE ordered by trending rank. */
    const relativeTimes = ["just now", "2m ago", "4m ago", "7m ago", "12m ago"];
    const news: NewsItem[] = trendingCoins.map((c, i) => {
      const pct = c.item.data?.price_change_percentage_24h?.usd;
      const direction = pct && pct > 0 ? "surges" : pct && pct < 0 ? "drops" : "moves";
      return {
        id: `trend-${i}`,
        title: `${c.item.name} (${c.item.symbol.toUpperCase()}) ${direction} ${pct ? Math.abs(pct).toFixed(1) + "%" : ""} — trending on CoinGecko`,
        source: "CoinGecko Trending",
        time: relativeTimes[i] ?? `${(i + 1) * 3}m ago`,
        category: c.item.symbol.toUpperCase(),
        url: `https://www.coingecko.com/en/coins/${c.item.id}`,
      };
    });
    if (news.length > 0) return news;
    throw new Error("No data");
  } catch { /* fall through */ }

  // Source 2: CoinGecko global data as market news
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("API error");
    const data = await res.json() as { data?: { total_market_cap?: Record<string, number>; market_cap_change_percentage_24h_usd?: number; active_cryptocurrencies?: number } };
    const g = data.data;
    if (g) {
      const mcap = g.total_market_cap?.usd;
      const mcapChange = g.market_cap_change_percentage_24h_usd;
      return [
        { id: "g1", title: `Global crypto market cap: $${mcap ? (mcap / 1e12).toFixed(2) : "?"}T ${mcapChange ? (mcapChange >= 0 ? "▲" : "▼") + Math.abs(mcapChange).toFixed(2) + "%" : ""}`, source: "CoinGecko Global", time: "just now", category: "Market", url: "https://www.coingecko.com/en/global-charts" },
        { id: "g2", title: `${g.active_cryptocurrencies?.toLocaleString() ?? "?"} active cryptocurrencies tracked globally`, source: "CoinGecko", time: "2m ago", category: "Market", url: "https://www.coingecko.com" },
        ...FALLBACK_NEWS.slice(0, 3),
      ];
    }
  } catch { /* fall through */ }

  return IS_PRODUCTION_BUILD ? [] : FALLBACK_NEWS;
}

type ResearchType = "Report" | "Analysis" | "Brief" | "Assessment";

interface ResearchItem {
  id: string;
  title: string;
  author: string;
  date: string;
  type: ResearchType;
  readTime: string;
  summary: string;
  tags: string[];
}

const RESEARCH_ITEMS: ResearchItem[] = IS_PRODUCTION_BUILD ? [] : [
  {
    id: "1",
    title: "Q2 2026 Tokenized Treasury Market Overview",
    author: "Aethelred Research",
    date: "Apr 10",
    type: "Report",
    readTime: "12 min",
    summary: "Tokenized treasuries crossed $8.4B TVL this quarter. BlackRock BUIDL leads institutional inflows while Ondo USDY captures retail yield seekers.",
    tags: ["RWA", "Treasury", "Institutional"],
  },
  {
    id: "2",
    title: "Institutional Stablecoin Landscape: USDC vs PYUSD vs EURC",
    author: "Treasury Desk",
    date: "Apr 8",
    type: "Analysis",
    readTime: "8 min",
    summary: "A side-by-side comparison of reserve composition, attestation frequency, redemption latency, and regulatory posture across the top three institutional stablecoins.",
    tags: ["Stablecoins", "USDC", "PYUSD", "EURC"],
  },
  {
    id: "3",
    title: "RWA Yield Comparison: BUIDL vs USDY vs sFRAX",
    author: "Yield Strategy",
    date: "Apr 5",
    type: "Brief",
    readTime: "4 min",
    summary: "Current APYs, underlying assets, minimum ticket sizes, and redemption windows for the three leading RWA yield products.",
    tags: ["RWA", "Yield"],
  },
  {
    id: "4",
    title: "Counterparty Risk Assessment: Top 20 DeFi Protocols",
    author: "Risk Team",
    date: "Apr 3",
    type: "Assessment",
    readTime: "15 min",
    summary: "Risk scores, audit status, TVL trends, and exposure concentration across the top 20 DeFi protocols by TVL.",
    tags: ["Risk", "DeFi"],
  },
];

type RiskLevel = "low" | "info" | "medium" | "high";

interface RiskSignal {
  id: string;
  level: RiskLevel;
  title: string;
  detail: string;
  time: string;
  category: string;
  affectedAssets?: string[];
  action?: string;
}

const RISK_SIGNALS: RiskSignal[] = IS_PRODUCTION_BUILD ? [] : [
  { id: "1", level: "low", title: "USDC de-peg monitoring", detail: "USDC/USD: 1.0001 — within normal range", time: "Live", category: "Stablecoin", affectedAssets: ["USDC"] },
  { id: "2", level: "info", title: "Ethereum gas spike detected", detail: "Base fee: 45 gwei (2x 24h avg)", time: "15m ago", category: "Network", affectedAssets: ["WETH"], action: "Review tx timing" },
  { id: "3", level: "medium", title: "New OFAC sanctions list update", detail: "23 new addresses added — screening in progress across all settlement paths", time: "2h ago", category: "Compliance", affectedAssets: ["USDC", "PYUSD", "EURC"], action: "Run AML sweep" },
  { id: "4", level: "low", title: "Cruzible validator set change", detail: "2 validators rotated, no impact on staking positions", time: "6h ago", category: "Staking", affectedAssets: ["AETHEL", "stAETHEL"] },
  { id: "5", level: "high", title: "Unusual outflow pattern detected", detail: "BUIDL redemptions exceed 24h baseline by 340%. Monitoring for systemic stress.", time: "24m ago", category: "Liquidity", affectedAssets: ["BUIDL"], action: "Contact BlackRock desk" },
];

export function MarketsView() {
  if (IS_PRODUCTION_BUILD) {
    return (
      <div className="view-padded">
        <EmptyState
          icon={<BarChart3 size={26} />}
          title="Markets are not enabled"
          description="This release does not publish a verified market-news or research feed. Wallet balances remain available on Home and Portfolio."
          tone="info"
        />
      </div>
    );
  }
  return <MarketsPreviewView />;
}

function MarketsPreviewView() {
  const portfolio = usePortfolioManager();
  const comingSoon = useComingSoon();
  const [tab, setTab] = useState<SubTab>(IS_PRODUCTION_BUILD ? "news" : "tokens");
  const [sortField, setSortField] = useState<SortField>("value");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");
  const [liveNews, setLiveNews] = useState<NewsItem[]>(IS_PRODUCTION_BUILD ? [] : FALLBACK_NEWS);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsFetchKey, setNewsFetchKey] = useState(0);
  const [researchFilter, setResearchFilter] = useState<ResearchType | "All">("All");
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "All">("All");

  // Re-fetch news every time the News tab is selected
  useEffect(() => {
    if (tab === "news") {
      setNewsLoading(true);
      fetchLiveNews().then(setLiveNews).finally(() => setNewsLoading(false));
    }
  }, [tab, newsFetchKey]);

  const allTokens = portfolio.getTokens();
  const filtered = search
    ? allTokens.filter((t) => t.token.symbol.toLowerCase().includes(search.toLowerCase()) || t.token.name.toLowerCase().includes(search.toLowerCase()))
    : allTokens;

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "name": cmp = a.token.symbol.localeCompare(b.token.symbol); break;
      case "price": cmp = a.price - b.price; break;
      case "change": cmp = a.priceChange24h - b.priceChange24h; break;
      case "value": cmp = a.value - b.value; break;
      default: assertNever(sortField, "markets.sortField");
    }
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  return (
    <div className="view-padded">
      {!IS_PRODUCTION_BUILD && (
        <div className="sub-tabs">
          <button className={`sub-tab ${tab === "tokens" ? "active" : ""}`} onClick={() => setTab("tokens")} type="button"><BarChart3 size={14} /> Tokens</button>
          <button className={`sub-tab ${tab === "research" ? "active" : ""}`} onClick={() => setTab("research")} type="button"><FileText size={14} /> Research</button>
          <button className={`sub-tab ${tab === "news" ? "active" : ""}`} onClick={() => setTab("news")} type="button"><Newspaper size={14} /> News</button>
          <button className={`sub-tab ${tab === "risk" ? "active" : ""}`} onClick={() => setTab("risk")} type="button"><ShieldAlert size={14} /> Risk</button>
        </div>
      )}

      {tab === "tokens" && (() => {
        if (IS_PRODUCTION_BUILD) {
          return (
            <EmptyState
              icon={<BarChart3 size={26} />}
              title="Markets portfolio unavailable"
              description="Portfolio discovery cards are hidden in production until they connect to a real market data source."
              tone="info"
            />
          );
        }

        /* ─── Tokens — Apple Grade ─── */
        const totalValue = allTokens.reduce((sum, t) => sum + t.value, 0);
        const weightedChange = totalValue > 0
          ? allTokens.reduce((s, t) => s + (t.priceChange24h * t.value), 0) / totalValue
          : 0;

        /* Top mover (biggest absolute change) and worst mover */
        const byChange = [...allTokens].sort((a, b) => b.priceChange24h - a.priceChange24h);
        const topGainer = byChange.find(t => t.priceChange24h > 0);
        const topLoser = [...byChange].reverse().find(t => t.priceChange24h < 0);

        /* Sort indicator: which column is active */
        const sortIcon = (field: SortField) => {
          if (sortField !== field) return <ArrowUpDown size={9} className="mkt-sort-icon" />;
          return sortAsc
            ? <TrendingUp size={9} className="mkt-sort-icon active" />
            : <TrendingDown size={9} className="mkt-sort-icon active" />;
        };

        return (
          <div>
            {/* Hero: total portfolio value */}
            <div className="mkt-hero">
              <div className="mkt-hero-left">
                <span className="mkt-hero-label">Portfolio Value</span>
                <h1 className="mkt-hero-amount">
                  <CurrencyText
                    value={totalValue}
                    maximumFractionDigits={priceFractionDigits(totalValue)}
                    minimumFractionDigits={priceFractionDigits(totalValue)}
                  />
                </h1>
              </div>
              <div className={`mkt-hero-change ${weightedChange >= 0 ? "up" : "down"}`}>
                {weightedChange >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                <span>{weightedChange >= 0 ? "+" : ""}{weightedChange.toFixed(2)}%</span>
              </div>
            </div>

            {/* Gainers / Losers snapshot cards */}
            {(topGainer || topLoser) && (
              <div className="mkt-movers">
                {topGainer && (
                  <div className="mkt-mover-card up">
                    <span className="mkt-mover-label">
                      <TrendingUp size={10} /> Top Gainer
                    </span>
                    <div className="mkt-mover-row">
                      <TokenLogo symbol={topGainer.token.symbol} size={24} color={topGainer.token.logoColor} />
                      <strong>{topGainer.token.symbol}</strong>
                      <span className="mkt-mover-pct">+{topGainer.priceChange24h.toFixed(2)}%</span>
                    </div>
                  </div>
                )}
                {topLoser && (
                  <div className="mkt-mover-card down">
                    <span className="mkt-mover-label">
                      <TrendingDown size={10} /> Top Loser
                    </span>
                    <div className="mkt-mover-row">
                      <TokenLogo symbol={topLoser.token.symbol} size={24} color={topLoser.token.logoColor} />
                      <strong>{topLoser.token.symbol}</strong>
                      <span className="mkt-mover-pct">{topLoser.priceChange24h.toFixed(2)}%</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Search — prominent rounded bar */}
            <div className="mkt-search">
              <Search size={14} />
              <input
                placeholder="Search tokens or symbols..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mkt-search-input"
              />
              {search && (
                <button className="mkt-search-clear" type="button" onClick={() => setSearch("")}>
                  ×
                </button>
              )}
            </div>

            {/* Column sort chips */}
            <div className="mkt-sort-row">
              <span className="mkt-sort-label">Sort by</span>
              <button
                className={`mkt-sort-chip ${sortField === "name" ? "active" : ""}`}
                onClick={() => toggleSort("name")}
                type="button"
              >
                Name {sortIcon("name")}
              </button>
              <button
                className={`mkt-sort-chip ${sortField === "price" ? "active" : ""}`}
                onClick={() => toggleSort("price")}
                type="button"
              >
                Price {sortIcon("price")}
              </button>
              <button
                className={`mkt-sort-chip ${sortField === "change" ? "active" : ""}`}
                onClick={() => toggleSort("change")}
                type="button"
              >
                24h {sortIcon("change")}
              </button>
            </div>

            {/* Token cards list */}
            {sorted.length === 0 ? (
              <div className="rsrch-empty">
                <Search size={22} />
                <strong>No tokens found</strong>
                <span>Try a different search term</span>
              </div>
            ) : (
              <div className="mkt-tokens-list">
                {sorted.map((t) => {
                  const isUp = t.priceChange24h >= 0;
                  return (
                    <div className="mkt-token-card" key={t.token.address}>
                      <TokenLogo symbol={t.token.symbol} size={32} color={t.token.logoColor} />
                      <div className="mkt-token-info">
                        <strong>{t.token.symbol}</strong>
                        <span>{t.token.name}</span>
                      </div>
                      <div className="mkt-token-chart">
                        <Sparkline symbol={t.token.symbol} width={42} height={20} positive={isUp} />
                      </div>
                      <div className="mkt-token-price">
                        <strong>
                          <CurrencyText
                            value={t.price}
                            maximumFractionDigits={priceFractionDigits(t.price)}
                            minimumFractionDigits={priceFractionDigits(t.price)}
                          />
                        </strong>
                        <span className={isUp ? "up" : "down"}>
                          {isUp ? "+" : ""}{t.priceChange24h.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {tab === "research" && (() => {
        if (IS_PRODUCTION_BUILD) {
          return (
            <EmptyState
              icon={<FileText size={26} />}
              title="Research feed unavailable"
              description="Production hides curated research briefs until the wallet is backed by a real research feed."
              tone="info"
            />
          );
        }

        /* ─── Research — Apple Grade ─── */
        const filters: Array<ResearchType | "All"> = ["All", "Report", "Analysis", "Brief", "Assessment"];
        const filtered = researchFilter === "All"
          ? RESEARCH_ITEMS
          : RESEARCH_ITEMS.filter((r) => r.type === researchFilter);
        const featured = filtered[0];
        const rest = filtered.slice(1);

        /* Each report type gets its own accent color */
        const typeColor = (t: ResearchType): string =>
          t === "Report" ? "#c41e1e"
          : t === "Analysis" ? "#2775ca"
          : t === "Brief" ? "#8b5cf6"
          : "#ff9f0a"; /* Assessment */

        return (
          <div>
            {/* Hero stat */}
            <div className="ac-hero" style={{ paddingBottom: 4 }}>
              <span className="ac-hero-label">Intelligence Reports</span>
              <h1 className="ac-hero-amount" style={{ fontSize: 28 }}>{RESEARCH_ITEMS.length}</h1>
              <span className="ac-hero-sub">from Aethelred research desk</span>
            </div>

            {/* Filter chips */}
            <div className="rsrch-filters">
              {filters.map((f) => (
                <button
                  key={f}
                  className={`rsrch-filter ${researchFilter === f ? "active" : ""}`}
                  type="button"
                  onClick={() => setResearchFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div className="rsrch-empty">
                <BookOpen size={22} />
                <strong>No {researchFilter.toLowerCase()}s yet</strong>
                <span>Check back soon for new intelligence</span>
              </div>
            ) : (
              <>
                {/* Featured card — largest, most recent */}
                {featured && (
                  <div
                    className="rsrch-featured is-coming-soon"
                    onClick={() => comingSoon(`Read: ${featured.title}`, "research viewer ships in v0.9.1")}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="rsrch-featured-header">
                      <span className="rsrch-type-badge" style={{ color: typeColor(featured.type), background: `${typeColor(featured.type)}1a` }}>
                        {featured.type.toUpperCase()}
                      </span>
                      <button
                        className="rsrch-bookmark"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          comingSoon(`Bookmark: ${featured.title}`, "bookmarks ship in v0.9.1");
                        }}
                      >
                        <Bookmark size={13} />
                      </button>
                    </div>
                    <h2 className="rsrch-featured-title">{featured.title}</h2>
                    <p className="rsrch-featured-summary">{featured.summary}</p>
                    <div className="rsrch-featured-tags">
                      {featured.tags.map((tag) => (
                        <span className="rsrch-tag" key={tag}>#{tag}</span>
                      ))}
                    </div>
                    <div className="rsrch-featured-footer">
                      <div className="rsrch-author">
                        <div className="rsrch-author-avatar" style={{ background: typeColor(featured.type) }}>
                          {featured.author.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                        </div>
                        <div>
                          <strong>{featured.author}</strong>
                          <span>{featured.date} · {featured.readTime} read</span>
                        </div>
                      </div>
                      <ArrowRight size={14} className="rsrch-chevron" />
                    </div>
                  </div>
                )}

                {/* Remaining cards — compact list */}
                {rest.length > 0 && (
                  <>
                    <div className="rsrch-section-title">More Reports</div>
                    <div className="rsrch-list">
                      {rest.map((r) => (
                        <div
                          className="rsrch-card is-coming-soon"
                          key={r.id}
                          onClick={() => comingSoon(`Read: ${r.title}`, "research viewer ships in v0.9.1")}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="rsrch-card-stripe" style={{ background: typeColor(r.type) }} />
                          <div className="rsrch-card-body">
                            <div className="rsrch-card-top">
                              <span className="rsrch-type-badge" style={{ color: typeColor(r.type), background: `${typeColor(r.type)}1a` }}>
                                {r.type.toUpperCase()}
                              </span>
                              <span className="rsrch-read-time">
                                <Clock size={9} /> {r.readTime}
                              </span>
                            </div>
                            <strong className="rsrch-card-title">{r.title}</strong>
                            <div className="rsrch-card-meta">{r.author} · {r.date}</div>
                          </div>
                          <ArrowRight size={14} className="rsrch-chevron" />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        );
      })()}

      {tab === "news" && (() => {
        /* ─── News — Apple Grade ─── */

        /* Parse the title for directional sentiment ("surges" / "drops" / percent) */
        const parseSentiment = (title: string): { direction: "up" | "down" | "neutral"; pct: string | null } => {
          const pctMatch = title.match(/(\d+(?:\.\d+)?)%/);
          const pct = pctMatch ? pctMatch[1] : null;
          if (/surges?|rally|jumps?|gains?/i.test(title)) return { direction: "up", pct };
          if (/drops?|falls?|crashes?|plunges?|dips?/i.test(title)) return { direction: "down", pct };
          return { direction: "neutral", pct };
        };

        /* Generate a deterministic color per category (hash → hue) */
        const categoryColor = (category: string): string => {
          const palette = ["#c41e1e", "#2775ca", "#8b5cf6", "#ff9f0a", "#34c759", "#f7931a", "#b6509e", "#00d395"];
          let hash = 0;
          for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
          return palette[hash % palette.length];
        };

        const featured = liveNews[0];
        const rest = liveNews.slice(1);

        return (
          <div>
            {/* Hero + live indicator */}
            <div className="news-hero-header">
              <div className="news-hero-title">
                <h3>Market News</h3>
                <div className="news-live-badge">
                  <span className="news-pulse" />
                  <span>LIVE</span>
                </div>
              </div>
              <button
                className="news-refresh-pill"
                onClick={() => setNewsFetchKey(k => k + 1)}
                type="button"
                disabled={newsLoading}
                title="Refresh news"
              >
                {newsLoading
                  ? <Loader2 size={11} className="spinner" />
                  : <span className="news-refresh-icon">↻</span>}
                <span>{newsLoading ? "Updating..." : "Refresh"}</span>
              </button>
            </div>

            {liveNews.length === 0 ? (
              <div className="rsrch-empty">
                <Newspaper size={22} />
                <strong>No news available</strong>
                <span>Pull to refresh or check your connection</span>
              </div>
            ) : (
              <>
                {/* Featured hero card — the most important story */}
                {featured && (() => {
                  const { direction, pct } = parseSentiment(featured.title);
                  const color = categoryColor(featured.category);
                  return (
                    <div
                      className="news-featured"
                      onClick={() => featured.url && window.open(featured.url, "_blank", "noopener")}
                      role={featured.url ? "link" : undefined}
                      tabIndex={featured.url ? 0 : undefined}
                    >
                      <div className="news-featured-mesh" aria-hidden="true" style={{ background: `radial-gradient(circle at 20% 0%, ${color}20 0%, transparent 60%)` }} />
                      <div className="news-featured-header">
                        <span className="news-category-chip" style={{ color, background: `${color}1a`, borderColor: `${color}33` }}>
                          {featured.category}
                        </span>
                        <div className="news-top-badge">
                          <TrendingUp size={10} />
                          <span>TOP STORY</span>
                        </div>
                      </div>
                      <h2 className="news-featured-title">{featured.title}</h2>
                      {(pct || direction !== "neutral") && direction !== "neutral" && (
                        <div className={`news-sentiment-pill ${direction}`}>
                          {direction === "up" ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                          <span>{direction === "up" ? "Bullish" : "Bearish"}</span>
                          {pct && <span className="news-sentiment-pct">{pct}%</span>}
                        </div>
                      )}
                      <div className="news-featured-footer">
                        <div className="news-source-info">
                          <div className="news-source-dot" style={{ background: color }} />
                          <div>
                            <strong>{featured.source}</strong>
                            <span className="news-time-with-icon">
                              <Clock size={10} /> {featured.time}
                            </span>
                          </div>
                        </div>
                        {featured.url && <ExternalLink size={13} className="news-ext-icon" />}
                      </div>
                    </div>
                  );
                })()}

                {/* Compact list of the rest */}
                {rest.length > 0 && (
                  <>
                    <div className="rsrch-section-title">More Headlines</div>
                    <div className="news-list">
                      {rest.map((item) => {
                        const { direction, pct } = parseSentiment(item.title);
                        const color = categoryColor(item.category);
                        return (
                          <div
                            className={`news-row ${item.url ? "news-clickable" : ""}`}
                            key={item.id}
                            onClick={() => item.url && window.open(item.url, "_blank", "noopener")}
                            role={item.url ? "link" : undefined}
                            tabIndex={item.url ? 0 : undefined}
                          >
                            <div className="news-row-stripe" style={{ background: color }} />
                            <div className="news-row-body">
                              <div className="news-row-top">
                                <span className="news-category-chip news-category-sm" style={{ color, background: `${color}1a` }}>
                                  {item.category}
                                </span>
                                {direction !== "neutral" && pct && (
                                  <span className={`news-sentiment-mini ${direction}`}>
                                    {direction === "up" ? "▲" : "▼"} {pct}%
                                  </span>
                                )}
                                <span className="news-row-time">
                                  <Clock size={9} /> {item.time}
                                </span>
                              </div>
                              <strong className="news-row-title">{item.title}</strong>
                              <div className="news-row-source">
                                {item.source}
                                {item.url && <ExternalLink size={9} />}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        );
      })()}

      {tab === "risk" && (() => {
        if (IS_PRODUCTION_BUILD) {
          return (
            <EmptyState
              icon={<ShieldAlert size={26} />}
              title="Risk monitor unavailable"
              description="Production hides seeded risk signals until a live monitoring feed is wired."
              tone="info"
            />
          );
        }

        /* ─── Risk — Apple Grade ─── */

        /* Severity rank: high > medium > info > low (used for gauge & sorting) */
        const severityRank: Record<RiskLevel, number> = { high: 4, medium: 3, info: 2, low: 1 };
        const severityIcon = (level: RiskLevel) => {
          switch (level) {
            case "high": return AlertOctagon;
            case "medium": return AlertTriangle;
            case "info": return Info;
            case "low": return CheckCircle2;
            default: return assertNever(level, "markets.severityIcon");
          }
        };
        const severityColor = (level: RiskLevel) => {
          switch (level) {
            case "high": return "#ff3b30";
            case "medium": return "#ff9f0a";
            case "info": return "#2775ca";
            case "low": return "#34c759";
            default: return assertNever(level, "markets.severityColor");
          }
        };
        const severityLabel = (level: RiskLevel) => level.charAt(0).toUpperCase() + level.slice(1);

        /* Count by severity */
        const counts: Record<RiskLevel, number> = { high: 0, medium: 0, info: 0, low: 0 };
        RISK_SIGNALS.forEach((s) => { counts[s.level]++; });

        /* Overall risk score: 0-100, weighted by severity
           high=35, medium=20, info=10, low=5 — capped at 100 */
        const rawScore = RISK_SIGNALS.reduce((sum, s) => {
          const weights: Record<RiskLevel, number> = { high: 35, medium: 20, info: 10, low: 5 };
          return sum + weights[s.level];
        }, 0);
        const riskScore = Math.min(100, rawScore);
        const riskLabel = riskScore >= 70 ? "Elevated" : riskScore >= 40 ? "Moderate" : riskScore >= 15 ? "Low" : "Minimal";
        const riskColor = riskScore >= 70 ? "#ff3b30" : riskScore >= 40 ? "#ff9f0a" : riskScore >= 15 ? "#2775ca" : "#34c759";

        /* SVG ring math */
        const ringRadius = 46;
        const ringCircumference = 2 * Math.PI * ringRadius;
        const ringDash = (riskScore / 100) * ringCircumference;

        /* Filter signals */
        const filters: Array<RiskLevel | "All"> = ["All", "high", "medium", "info", "low"];
        const filtered = riskFilter === "All"
          ? [...RISK_SIGNALS].sort((a, b) => severityRank[b.level] - severityRank[a.level])
          : RISK_SIGNALS.filter((s) => s.level === riskFilter);

        return (
          <div>
            {/* Hero: risk gauge */}
            <div className="risk-hero">
              <div className="risk-gauge-wrap">
                <svg width={110} height={110} viewBox="0 0 110 110">
                  {/* Background track */}
                  <circle cx={55} cy={55} r={ringRadius} fill="none" stroke="var(--line)" strokeWidth={8} />
                  {/* Filled arc */}
                  <circle
                    cx={55} cy={55} r={ringRadius}
                    fill="none"
                    stroke={riskColor}
                    strokeWidth={8}
                    strokeLinecap="round"
                    strokeDasharray={`${ringDash} ${ringCircumference}`}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dasharray 600ms ease" }}
                  />
                </svg>
                <div className="risk-gauge-center">
                  <strong className="risk-score" style={{ color: riskColor }}>{riskScore}</strong>
                  <span>RISK</span>
                </div>
              </div>
              <div className="risk-hero-info">
                <span className="risk-hero-label">Overall Exposure</span>
                <strong className="risk-hero-status" style={{ color: riskColor }}>{riskLabel}</strong>
                <span className="risk-hero-sub">{RISK_SIGNALS.length} active signals</span>
              </div>
            </div>

            {/* Severity count tiles */}
            <div className="risk-counts">
              {(["high", "medium", "info", "low"] as RiskLevel[]).map((level) => {
                const Icon = severityIcon(level);
                const color = severityColor(level);
                return (
                  <button
                    key={level}
                    className={`risk-count-tile ${riskFilter === level ? "active" : ""}`}
                    style={riskFilter === level ? { borderColor: `${color}55`, background: `${color}14` } : undefined}
                    onClick={() => setRiskFilter(riskFilter === level ? "All" : level)}
                    type="button"
                  >
                    <Icon size={14} style={{ color }} />
                    <strong style={{ color }}>{counts[level]}</strong>
                    <span>{severityLabel(level)}</span>
                  </button>
                );
              })}
            </div>

            {/* Filter chips */}
            <div className="risk-filters">
              {filters.map((f) => (
                <button
                  key={f}
                  className={`risk-filter ${riskFilter === f ? "active" : ""}`}
                  type="button"
                  onClick={() => setRiskFilter(f)}
                >
                  {f === "All" ? "All" : severityLabel(f)}
                </button>
              ))}
            </div>

            {/* Signal cards */}
            {filtered.length === 0 ? (
              <div className="rsrch-empty">
                <ShieldCheck size={22} />
                <strong>All clear</strong>
                <span>No {riskFilter === "All" ? "" : `${riskFilter} `}risk signals at this time</span>
              </div>
            ) : (
              <div className="risk-list">
                {filtered.map((signal) => {
                  const Icon = severityIcon(signal.level);
                  const color = severityColor(signal.level);
                  return (
                    <div className={`risk-card risk-card-${signal.level}`} key={signal.id}>
                      <div className="risk-card-stripe" style={{ background: color }} />
                      <div className="risk-card-icon" style={{ background: `${color}18`, color }}>
                        <Icon size={15} />
                      </div>
                      <div className="risk-card-body">
                        <div className="risk-card-top">
                          <span className="risk-card-category" style={{ color }}>{signal.category}</span>
                          <span className="risk-card-time">
                            <Clock size={9} /> {signal.time}
                          </span>
                        </div>
                        <strong className="risk-card-title">{signal.title}</strong>
                        <p className="risk-card-detail">{signal.detail}</p>
                        {(signal.affectedAssets || signal.action) && (
                          <div className="risk-card-meta">
                            {signal.affectedAssets && (
                              <div className="risk-card-assets">
                                {signal.affectedAssets.map((asset) => (
                                  <span className="risk-asset-chip" key={asset}>{asset}</span>
                                ))}
                              </div>
                            )}
                            {signal.action && (
                              <button className="risk-action-btn" type="button" style={{ color, borderColor: `${color}55` }}>
                                {signal.action} <ArrowRight size={11} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
