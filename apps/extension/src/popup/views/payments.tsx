import { useRef, useState } from "react";
import {
  ArrowUpRight, ArrowDownLeft, Users, Calendar, FileCheck, Clock, Send,
  CheckCircle2, AlertTriangle, Shield, Globe, Landmark,
  BarChart3, RefreshCw, Layers,
  ChevronRight, Eye, EyeOff,
  Wallet, Building2, Award, FileText as FileSpreadsheet, UploadCloud, ShieldCheck,
  TrendingDown, Sparkles, Zap,
} from "lucide-react";
import { useNavigation, type ViewName } from "../router";
import { TokenLogo } from "../components/token-logo";
import { CurrencyText } from "../components/currency-text";
import { AnimatedNumber } from "../components/animated-number";
import { useWalletState } from "../hooks/use-wallet-state";
import { useLiveBalances } from "../hooks/use-live-balances";
import { useLivePrices } from "../hooks/use-live-prices";
import { useAddressBook } from "../services/services-context";
import { EmptyState } from "../components/empty-state";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

type SubTab = "overview" | "transfer" | "batch" | "scheduled" | "settlement" | "recipients";

/* ─── Treasury overview data ───────────────────────────────── */
const TREASURY_ASSETS = [
  { symbol: "USDC", allocation: 42 },
  { symbol: "BUIDL", allocation: 22 },
  { symbol: "AETHEL", allocation: 18 },
  { symbol: "WETH", allocation: 10 },
  { symbol: "PYUSD", allocation: 8 },
];

const PAYMENT_LIMITS = {
  dailyUsed: 3200000,
  dailyLimit: 10000000,
  singleTxLimit: 5000000,
  monthlyUsed: 18400000,
  monthlyLimit: 50000000,
  /* Last month's spend for the delta chip in the hero. This is the
   * Apple Wallet pattern: show the current period's number with a
   * badge comparing to the previous period ("-23% vs last month"). */
  monthlyPriorUsed: 23900000,
};

/* ─── Settlement queue ─────────────────────────────────────── */
const SETTLEMENT_QUEUE = [
  { id: "s1", counterparty: "Circle Mint (US)", amount: "2,500,000", asset: "USDC", status: "compliance-review" as const, submittedAt: "10m ago", signers: { signed: 1, required: 2 }, riskScore: "low", travelRule: true, reference: "STL-2026-0412-001" },
  { id: "s2", counterparty: "Cruzible Vault", amount: "500,000", asset: "AETHEL", status: "pending-approval" as const, submittedAt: "1h ago", signers: { signed: 0, required: 2 }, riskScore: "low", travelRule: false, reference: "STL-2026-0412-002" },
  { id: "s3", counterparty: "BlackRock Fund Services", amount: "1,000,000", asset: "BUIDL", status: "processing" as const, submittedAt: "3h ago", signers: { signed: 2, required: 2 }, riskScore: "low", travelRule: true, reference: "STL-2026-0411-004" },
  { id: "s4", counterparty: "Partner VASP (Singapore)", amount: "750,000", asset: "PYUSD", status: "compliance-review" as const, submittedAt: "5h ago", signers: { signed: 1, required: 3 }, riskScore: "medium", travelRule: true, reference: "STL-2026-0411-003" },
];

/* ─── Scheduled transfers ──────────────────────────────────── */
const SCHEDULED = [
  { id: "sc1", recipient: "Treasury Ops Vault", amount: "100,000", asset: "USDC", frequency: "Weekly", nextDate: "Apr 14", status: "active", lastExec: "Apr 7 — Success", compliance: "Pre-approved" },
  { id: "sc2", recipient: "Staking Reserve", amount: "50,000", asset: "AETHEL", frequency: "Monthly", nextDate: "May 1", status: "active", lastExec: "Apr 1 — Success", compliance: "Pre-approved" },
  { id: "sc3", recipient: "Payroll Distribution", amount: "340,000", asset: "USDC", frequency: "Bi-weekly", nextDate: "Apr 18", status: "active", lastExec: "Apr 4 — Success", compliance: "Pre-approved" },
  { id: "sc4", recipient: "BUIDL Yield Reinvest", amount: "200,000", asset: "BUIDL", frequency: "Monthly", nextDate: "May 1", status: "paused", lastExec: "Mar 1 — Skipped (policy)", compliance: "Needs review" },
];

/* ─── Recipients (enhanced) ────────────────────────────────── */
const RECIPIENTS = [
  { id: "r1", name: "Treasury Operations Vault", address: "0xae7e...ef10", type: "Internal", riskTier: "Trusted", kycStatus: "N/A", lastUsed: "1d ago", totalVolume: "$12.4M" },
  { id: "r2", name: "Circle Mint", address: "0x55fe...a2b4", type: "VASP", riskTier: "Low", kycStatus: "Verified", lastUsed: "2d ago", totalVolume: "$48.2M" },
  { id: "r3", name: "BlackRock Fund Services", address: "0x7712...aec2", type: "Institutional", riskTier: "Low", kycStatus: "Verified", lastUsed: "5d ago", totalVolume: "$22.0M" },
  { id: "r4", name: "Partner VASP (Singapore)", address: "0x3c91...f8d1", type: "VASP", riskTier: "Medium", kycStatus: "Verified", lastUsed: "7d ago", totalVolume: "$8.7M" },
  { id: "r5", name: "Ondo Finance", address: "0x1a3b...c7e9", type: "Protocol", riskTier: "Low", kycStatus: "Verified", lastUsed: "12d ago", totalVolume: "$5.1M" },
];

/* ─── Batch templates ──────────────────────────────────────── */
const BATCH_TEMPLATES = [
  { id: "b1", name: "Monthly Payroll", recipients: 24, totalAmount: "340,000", asset: "USDC", lastRun: "Apr 4", status: "ready", icon: Wallet },
  { id: "b2", name: "Vendor Payments Q2", recipients: 8, totalAmount: "520,000", asset: "USDC", lastRun: "Mar 28", status: "ready", icon: Building2 },
  { id: "b3", name: "Validator Rewards Distribution", recipients: 12, totalAmount: "125,000", asset: "AETHEL", lastRun: "Apr 7", status: "ready", icon: Award },
];

const RECENT_BATCH_RUNS = [
  { id: "br1", template: "Monthly Payroll", runDate: "Apr 4", recipients: 24, total: "340,000 USDC", status: "completed", failures: 0 },
  { id: "br2", template: "Vendor Payments Q1", runDate: "Mar 28", recipients: 8, total: "480,000 USDC", status: "completed", failures: 1 },
];

/* fmtM was a local "$N.NM / $NK" formatter. It was replaced by
 * <CurrencyText compact /> in the rebuilt overview so the currency
 * symbol and number never visually collide. Other tabs that still
 * use string currency formatting should migrate on their own pass. */

const STATUS_STYLES: Record<string, string> = {
  "compliance-review": "review",
  "pending-approval": "review",
  "processing": "cleared",
  "completed": "cleared",
  "failed": "danger",
};

function formatRelativeContactDate(addedAt: number): string {
  const diffMs = Date.now() - addedAt;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return diffMonths === 1 ? "1 month ago" : `${diffMonths} months ago`;
}

function formatLastUpdatedAt(lastUpdatedAt: number | null): string | null {
  if (!lastUpdatedAt) return null;
  return new Date(lastUpdatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

interface ProductionPaymentsViewProps {
  navigate: (view: ViewName, params?: Record<string, string>) => void;
  tab: SubTab;
  setTab: (tab: SubTab) => void;
}

function ProductionPaymentsView({
  navigate,
  tab,
  setTab,
}: ProductionPaymentsViewProps) {
  const { state, loading, contextError } = useWalletState();
  const addressBook = useAddressBook();
  const activeAccount = state?.activeAccountId
    ? state.accounts.find((account) => account.id === state.activeAccountId) ?? state.accounts[0]
    : state?.accounts[0];
  const {
    tokens,
    totalValue,
    isLoading,
    error,
    lastUpdatedAt,
  } = useLiveBalances(activeAccount?.address);
  const recipients = [...addressBook.listContacts()].sort((a, b) => b.addedAt - a.addedAt);
  const lastUpdatedLabel = formatLastUpdatedAt(lastUpdatedAt);
  const hasBalances = tokens.length > 0;

  return (
    <div className="view-padded">
      <div className="sub-tabs" style={{ overflowX: "auto" }}>
        <button className={`sub-tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")} type="button"><BarChart3 size={13} /> Overview</button>
        <button className={`sub-tab ${tab === "transfer" ? "active" : ""}`} onClick={() => setTab("transfer")} type="button"><Send size={13} /> Transfer</button>
        <button className={`sub-tab ${tab === "batch" ? "active" : ""}`} onClick={() => setTab("batch")} type="button"><Layers size={13} /> Batch</button>
        <button className={`sub-tab ${tab === "scheduled" ? "active" : ""}`} onClick={() => setTab("scheduled")} type="button"><Calendar size={13} /> Scheduled</button>
        <button className={`sub-tab ${tab === "settlement" ? "active" : ""}`} onClick={() => setTab("settlement")} type="button"><FileCheck size={13} /> Settlement</button>
        <button className={`sub-tab ${tab === "recipients" ? "active" : ""}`} onClick={() => setTab("recipients")} type="button"><Users size={13} /> Recipients</button>
      </div>

      {contextError ? (
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title="Wallet context unavailable"
          description={contextError}
          tone="warning"
          action={{ label: "Open Accounts", onClick: () => navigate("accounts") }}
        />
      ) : null}

      {!contextError && !loading && !activeAccount ? (
        <EmptyState
          icon={<Wallet size={24} />}
          title="No active account connected"
          description="Payments needs an initialized wallet account before it can show live balances or saved recipients."
          tone="info"
          action={{ label: "Open Accounts", onClick: () => navigate("accounts") }}
        />
      ) : null}

      {!contextError && activeAccount && tab === "overview" && (
        <div>
          <div className="ac-hero" style={{ paddingBottom: 4 }}>
            <span className="ac-hero-label">Production Treasury</span>
            <h1 className="ac-hero-amount" style={{ fontSize: 28 }}>
              {isLoading ? "Loading..." : <CurrencyText value={totalValue} compact maximumFractionDigits={1} />}
            </h1>
            <span className="ac-hero-sub">
              {hasBalances
                ? `${tokens.length} live asset${tokens.length === 1 ? "" : "s"} from ${activeAccount.label ?? "active account"}`
                : "No funded assets detected for the active account"}
            </span>
          </div>

          <div className="xfer-shield-strip">
            <div className="xfer-shield-icon"><Shield size={14} /></div>
            <div className="xfer-shield-text">
              <strong>Production uses live balances and saved recipients only</strong>
              <span>
                {lastUpdatedLabel
                  ? `Balances refreshed at ${lastUpdatedLabel}`
                  : "Waiting for the first live balance snapshot"}
              </span>
            </div>
            <CheckCircle2 size={16} style={{ color: "var(--success)", flexShrink: 0 }} />
          </div>

          {error ? (
            <EmptyState
              icon={<AlertTriangle size={24} />}
              title="Live balances are temporarily unavailable"
              description={error.message}
              tone="warning"
              action={{ label: "Open Send", onClick: () => navigate("send") }}
            />
          ) : hasBalances ? (
            <>
              <div className="section-header"><h3>Live Assets</h3></div>
              {tokens.slice(0, 4).map((token) => (
                <div className="xfer-tx-row" key={token.address}>
                  <div className="xfer-tx-icon" style={{ background: "rgba(255,255,255,0.08)" }}>
                    <TokenLogo symbol={token.symbol} size={20} />
                  </div>
                  <div className="xfer-tx-info">
                    <strong>{token.name}</strong>
                    <span>{token.balance} {token.symbol}</span>
                  </div>
                  <div className="xfer-tx-amount">
                    <strong><CurrencyText value={token.value} compact maximumFractionDigits={1} /></strong>
                    <span>{token.change24h >= 0 ? "+" : ""}{token.change24h.toFixed(2)}%</span>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <EmptyState
              icon={<Landmark size={24} />}
              title="No treasury balances yet"
              description="Production overview only renders verified on-chain balances. Fund the active account to populate this workspace."
              tone="info"
              action={{ label: "Open Receive", onClick: () => navigate("receive") }}
            />
          )}
        </div>
      )}

      {!contextError && activeAccount && tab === "transfer" && (
        <div>
          <div className="xfer-actions">
            <button className="xfer-action-btn xfer-send" onClick={() => navigate("send")} type="button">
              <div className="xfer-action-circle"><ArrowUpRight size={22} strokeWidth={2.5} /></div>
              <strong>Send</strong>
              <span>Live balance and fee checks</span>
            </button>
            <button className="xfer-action-btn xfer-receive" onClick={() => navigate("receive")} type="button">
              <div className="xfer-action-circle"><ArrowDownLeft size={22} strokeWidth={2.5} /></div>
              <strong>Request</strong>
              <span>Wallet address or payment QR</span>
            </button>
          </div>

          <div className="xfer-shield-strip">
            <div className="xfer-shield-icon"><Shield size={14} /></div>
            <div className="xfer-shield-text">
              <strong>Recipients come from the persisted address book</strong>
              <span>{recipients.length} saved recipient{recipients.length === 1 ? "" : "s"} available for one-tap send flows</span>
            </div>
            <CheckCircle2 size={16} style={{ color: "var(--success)", flexShrink: 0 }} />
          </div>

          {recipients.length > 0 ? (
            <>
              <div className="section-header"><h3>Saved Recipients</h3></div>
              {recipients.slice(0, 4).map((recipient) => (
                <div className="xfer-tx-row" key={recipient.address}>
                  <div className="xfer-tx-icon" style={{ background: "rgba(52,199,89,0.12)", color: "var(--success)" }}>
                    <Users size={14} />
                  </div>
                  <div className="xfer-tx-info">
                    <strong>{recipient.label}</strong>
                    <span>{recipient.address.slice(0, 6)}...{recipient.address.slice(-4)}</span>
                  </div>
                  <button
                    className="batch-exec-btn"
                    type="button"
                    onClick={() => navigate("send", { recipient: recipient.address })}
                  >
                    <Send size={12} /> Send
                  </button>
                </div>
              ))}
            </>
          ) : (
            <EmptyState
              icon={<Users size={24} />}
              title="No saved recipients yet"
              description="Production transfers only surface trusted recipients you have explicitly saved in Contacts."
              tone="info"
              action={{ label: "Manage Contacts", onClick: () => navigate("contacts") }}
              secondaryAction={{ label: "Open Send", onClick: () => navigate("send") }}
            />
          )}
        </div>
      )}

      {!contextError && activeAccount && tab === "batch" && (
        <EmptyState
          icon={<Layers size={24} />}
          title="Batch payments require a treasury orchestration backend"
          description="Production keeps batch execution disabled until recipient imports, approval policy evaluation, and ledger reconciliation are backed by a real treasury service."
          tone="info"
          action={{ label: "Open Send", onClick: () => navigate("send") }}
          secondaryAction={{ label: "Manage Contacts", onClick: () => navigate("contacts") }}
        />
      )}

      {!contextError && activeAccount && tab === "scheduled" && (
        <EmptyState
          icon={<Calendar size={24} />}
          title="Scheduled transfers are not wired yet"
          description="Recurring treasury jobs stay unavailable in production until policy approvals, execution windows, and audit logging are owned by a persistent scheduler."
          tone="info"
          action={{ label: "Open Send", onClick: () => navigate("send") }}
        />
      )}

      {!contextError && activeAccount && tab === "settlement" && (
        <EmptyState
          icon={<Landmark size={24} />}
          title="Settlement queue requires a live approvals service"
          description="Production settlement stays disabled until counterparty onboarding, multi-sig approvals, and settlement status events are integrated with a real backend."
          tone="info"
          action={{ label: "Open Send", onClick: () => navigate("send") }}
        />
      )}

      {!contextError && activeAccount && tab === "recipients" && (
        <div>
          <div className="ac-hero" style={{ paddingBottom: 4 }}>
            <span className="ac-hero-label">Address Book</span>
            <h1 className="ac-hero-amount" style={{ fontSize: 28 }}>{recipients.length}</h1>
            <span className="ac-hero-sub">persisted recipient{recipients.length === 1 ? "" : "s"}</span>
          </div>

          {recipients.length > 0 ? (
            <>
              {recipients.map((recipient) => (
                <div className="recip-card" key={recipient.address}>
                  <div className="recip-card-top">
                    <div className="recip-card-icon" style={{ background: "rgba(52,199,89,0.12)", color: "var(--success)" }}>
                      <Users size={16} />
                    </div>
                    <div className="recip-card-info">
                      <strong>{recipient.label}</strong>
                      <span className="recip-address">{recipient.address.slice(0, 6)}...{recipient.address.slice(-4)}</span>
                    </div>
                    <span className="compliance-badge cleared">Saved</span>
                  </div>

                  <div className="recip-stats">
                    <div className="recip-stat">
                      <span className="recip-stat-label">Source</span>
                      <strong>Address Book</strong>
                    </div>
                    <div className="recip-stat-divider" />
                    <div className="recip-stat">
                      <span className="recip-stat-label">Added</span>
                      <strong>{formatRelativeContactDate(recipient.addedAt)}</strong>
                    </div>
                    <div className="recip-stat-divider" />
                    <div className="recip-stat">
                      <span className="recip-stat-label">Action</span>
                      <button
                        className="batch-exec-btn"
                        type="button"
                        onClick={() => navigate("send", { recipient: recipient.address })}
                      >
                        <Send size={12} /> Send
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <EmptyState
              icon={<Users size={24} />}
              title="No recipients saved yet"
              description="Add recipients in Contacts to make production send flows faster without relying on placeholder recipient catalogs."
              tone="info"
              action={{ label: "Manage Contacts", onClick: () => navigate("contacts") }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CsvUploadCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      // TODO: parse CSV and create batch payment
    }
  };

  return (
    <div className="csv-upload-card" style={{ marginTop: 14 }}>
      <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />

      {!fileName ? (
        /* Drop zone state */
        <div className="csv-dropzone" onClick={() => fileRef.current?.click()} role="button" tabIndex={0}>
          <div className="csv-dropzone-icon">
            <UploadCloud size={28} />
          </div>
          <strong>Import batch payment</strong>
          <span>Upload CSV or drag & drop</span>
          <div className="csv-dropzone-cols">
            {["recipient", "address", "amount", "asset", "memo"].map((col) => (
              <span className="csv-col-chip" key={col}>{col}</span>
            ))}
          </div>
          <div className="csv-dropzone-footer">
            <ShieldCheck size={10} />
            <span>Each payment screened individually</span>
          </div>
        </div>
      ) : (
        /* File selected state */
        <div className="csv-selected">
          <div className="csv-selected-icon">
            <FileSpreadsheet size={22} />
          </div>
          <div className="csv-selected-info">
            <strong>{fileName}</strong>
            <span>Ready to process</span>
          </div>
          <div className="csv-selected-actions">
            <button className="csv-action-btn csv-process" type="button" onClick={() => {}}>
              <Send size={12} /> Process
            </button>
            <button className="csv-action-btn csv-remove" type="button" onClick={() => setFileName(null)}>
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PaymentsView() {
  const { navigate } = useNavigation();
  const [tab, setTab] = useState<SubTab>("overview");
  const [showLimits, setShowLimits] = useState(true);
  // Live prices subscription keeps the treasury USD totals current.
  // We side-effect only here — individual rows read getPrice where needed.
  useLivePrices(30000);

  if (IS_PRODUCTION_BUILD) {
    return <ProductionPaymentsView navigate={navigate} tab={tab} setTab={setTab} />;
  }

  const dailyPct = (PAYMENT_LIMITS.dailyUsed / PAYMENT_LIMITS.dailyLimit) * 100;
  const monthlyPct = (PAYMENT_LIMITS.monthlyUsed / PAYMENT_LIMITS.monthlyLimit) * 100;

  return (
    <div className="view-padded">
      <div className="sub-tabs" style={{ overflowX: "auto" }}>
        <button className={`sub-tab ${tab === "overview" ? "active" : ""}`} onClick={() => setTab("overview")} type="button"><BarChart3 size={13} /> Overview</button>
        <button className={`sub-tab ${tab === "transfer" ? "active" : ""}`} onClick={() => setTab("transfer")} type="button"><Send size={13} /> Transfer</button>
        <button className={`sub-tab ${tab === "batch" ? "active" : ""}`} onClick={() => setTab("batch")} type="button"><Layers size={13} /> Batch</button>
        <button className={`sub-tab ${tab === "scheduled" ? "active" : ""}`} onClick={() => setTab("scheduled")} type="button"><Calendar size={13} /> Scheduled</button>
        <button className={`sub-tab ${tab === "settlement" ? "active" : ""}`} onClick={() => setTab("settlement")} type="button"><FileCheck size={13} /> Settlement</button>
        <button className={`sub-tab ${tab === "recipients" ? "active" : ""}`} onClick={() => setTab("recipients")} type="button"><Users size={13} /> Recipients</button>
      </div>

      {/* ═══ OVERVIEW — Apple Card Grade ═══ *
       * Visual rhythm mirrors Apple Wallet: a single hero card
       * dominates the top, then a row of stat chips, a one-line
       * "Insights" card (iridescent), a treasury allocation panel
       * with its own container, a row of big rounded action tiles,
       * and a clean "Awaiting Action" list. */}
      {tab === "overview" && (() => {
        /* ─── Derived numbers for the hero + insight card ─── *
         * monthDelta is a signed ratio — negative means spend is
         * DOWN from last month. The hero renders an arrow chip
         * colored green for down (good) and warning-yellow for
         * an increase. */
        const monthDelta =
          (PAYMENT_LIMITS.monthlyUsed - PAYMENT_LIMITS.monthlyPriorUsed) /
          PAYMENT_LIMITS.monthlyPriorUsed;
        const deltaPositive = monthDelta <= 0; // spend down = good
        const deltaAbs = Math.abs(monthDelta * 100).toFixed(0);
        const pendingCount = SETTLEMENT_QUEUE.filter((s) => s.status !== "processing").length;
        const clearedToday = SETTLEMENT_QUEUE.filter((s) => s.status === "processing").length;
        return (
        <div className="pov">
          {/* ═════ Hero — Apple Card treatment ═════ *
           * Gradient-washed card with the full monthly spend as
           * the dominant number. The usage bar at the bottom is
           * inline (not a separate section), matching how Apple
           * Card shows the spend-to-limit progress. */}
          <div className="pov-hero">
            <div className="pov-hero-glow" aria-hidden="true" />
            <div className="pov-hero-content">
              <div className="pov-hero-eyebrow">
                <span className="pov-hero-dot" />
                <span>Monthly Spending</span>
                <span className="pov-hero-period">· April</span>
              </div>

              <h1 className="pov-hero-amount">
                {showLimits ? (
                  <AnimatedNumber
                    value={PAYMENT_LIMITS.monthlyUsed}
                    duration={1400}
                    from={0}
                    format={(v) => (
                      <CurrencyText value={v} compact maximumFractionDigits={1} />
                    )}
                  />
                ) : (
                  <span className="pov-hero-hidden">••••</span>
                )}
              </h1>

              <div className="pov-hero-sub">
                <span>of</span>
                <CurrencyText
                  value={PAYMENT_LIMITS.monthlyLimit}
                  compact
                  maximumFractionDigits={0}
                />
                <span>limit</span>
                <span className={`pov-hero-delta ${deltaPositive ? "pos" : "neg"}`}>
                  {deltaPositive ? <TrendingDown size={9} /> : <ArrowUpRight size={9} />}
                  {deltaAbs}%
                  <span className="pov-hero-delta-period">vs last mo</span>
                </span>
              </div>

              {/* Usage bar — matches Apple Card's monthly progress line.
               * The "remaining" portion is a subtle gradient tail. */}
              <div className="pov-hero-bar">
                <div
                  className="pov-hero-bar-fill"
                  style={{
                    width: `${monthlyPct}%`,
                    background:
                      monthlyPct > 80
                        ? "linear-gradient(90deg, #ff9f0a, #ff6b00)"
                        : "linear-gradient(90deg, #ffffff, rgba(255,255,255,0.7))",
                  }}
                />
              </div>
              <div className="pov-hero-bar-labels">
                <span>{monthlyPct.toFixed(0)}% used</span>
                <span>
                  <CurrencyText
                    value={PAYMENT_LIMITS.monthlyLimit - PAYMENT_LIMITS.monthlyUsed}
                    compact
                    maximumFractionDigits={1}
                  />{" "}
                  left
                </span>
              </div>
            </div>
          </div>

          {/* ═════ Stat chip row — three equal cards ═════ */}
          <div className="pov-chips">
            <div className="pov-chip">
              <span className="pov-chip-label">DAILY</span>
              <strong className="pov-chip-val">
                {showLimits ? (
                  <CurrencyText
                    value={PAYMENT_LIMITS.dailyUsed}
                    compact
                    maximumFractionDigits={1}
                  />
                ) : (
                  "••"
                )}
              </strong>
              <div className="pov-chip-bar">
                <div
                  style={{
                    width: `${dailyPct}%`,
                    background: dailyPct > 80 ? "var(--warning)" : "var(--success)",
                  }}
                />
              </div>
              <span className="pov-chip-sub">{dailyPct.toFixed(0)}% of daily cap</span>
            </div>
            <div className="pov-chip">
              <span className="pov-chip-label">SINGLE TX</span>
              <strong className="pov-chip-val">
                {showLimits ? (
                  <CurrencyText
                    value={PAYMENT_LIMITS.singleTxLimit}
                    compact
                    maximumFractionDigits={0}
                  />
                ) : (
                  "••"
                )}
              </strong>
              <div className="pov-chip-icon-row">
                <Shield size={9} />
                <span>max per tx</span>
              </div>
            </div>
            <div className="pov-chip">
              <span className="pov-chip-label">PENDING</span>
              <strong className="pov-chip-val">{pendingCount}</strong>
              <div className="pov-chip-icon-row">
                <Clock size={9} />
                <span>awaiting action</span>
              </div>
            </div>
          </div>

          {/* ═════ Insights card — iridescent premium strip ═════ *
           * One-line, actionable. Apple Wallet's "Weekly Activity"
           * card and Apple Card's "Insights" both use this pattern:
           * a single card with a sparkle icon and a sentence that
           * summarizes something meaningful, tappable to drill in. */}
          <button
            className="pov-insight"
            onClick={() => setTab("settlement")}
            type="button"
          >
            <div className="pov-insight-shimmer" aria-hidden="true" />
            <div className="pov-insight-icon">
              <Sparkles size={14} strokeWidth={2.4} />
            </div>
            <div className="pov-insight-body">
              <strong>
                {clearedToday} high-value settlement{clearedToday === 1 ? "" : "s"}{" "}
                cleared today
              </strong>
              <span>Compliance screening · travel rule · KYT all passing</span>
            </div>
            <ChevronRight size={14} className="pov-insight-chev" />
          </button>

          {/* ═════ Treasury allocation — container card ═════ */}
          <div className="pov-section-header">
            <h3>Treasury Allocation</h3>
            <span className="pov-section-meta">
              {TREASURY_ASSETS.length} assets ·{" "}
              <CurrencyText
                value={PAYMENT_LIMITS.monthlyUsed}
                compact
                maximumFractionDigits={1}
              />
            </span>
          </div>
          <div className="pov-treasury-card">
            {TREASURY_ASSETS.map((a) => {
              const colors: Record<string, string> = {
                USDC: "#2775ca",
                BUIDL: "#8b5cf6",
                AETHEL: "#c41e1e",
                WETH: "#627eea",
                PYUSD: "#ff9f0a",
              };
              return (
                <div className="pov-treasury-row" key={a.symbol}>
                  <TokenLogo symbol={a.symbol} size={24} />
                  <div className="pov-treasury-info">
                    <strong>{a.symbol}</strong>
                    <span>
                      <CurrencyText
                        value={(PAYMENT_LIMITS.monthlyUsed * a.allocation) / 100}
                        compact
                        maximumFractionDigits={1}
                      />
                    </span>
                  </div>
                  <div className="pov-treasury-bar">
                    <div
                      style={{
                        width: `${a.allocation}%`,
                        background: colors[a.symbol],
                      }}
                    />
                  </div>
                  <span className="pov-treasury-pct">{a.allocation}%</span>
                </div>
              );
            })}
          </div>

          {/* ═════ Quick actions — big rounded tiles ═════ */}
          <div className="pov-actions">
            <button
              className="pov-action pov-action-send"
              onClick={() => setTab("transfer")}
              type="button"
            >
              <div className="pov-action-icon">
                <ArrowUpRight size={18} strokeWidth={2.4} />
              </div>
              <strong>Send</strong>
              <span>Compliance-gated</span>
            </button>
            <button
              className="pov-action pov-action-batch"
              onClick={() => setTab("batch")}
              type="button"
            >
              <div className="pov-action-icon">
                <Layers size={18} strokeWidth={2.4} />
              </div>
              <strong>Batch</strong>
              <span>Multi-recipient</span>
            </button>
            <button
              className="pov-action pov-action-settle"
              onClick={() => setTab("settlement")}
              type="button"
            >
              <div className="pov-action-icon">
                <Zap size={18} strokeWidth={2.4} />
              </div>
              <strong>Settle</strong>
              <span>{pendingCount} awaiting</span>
            </button>
          </div>

          {/* ═════ Awaiting action list ═════ */}
          {pendingCount > 0 && (
            <>
              <div className="pov-section-header">
                <h3>Awaiting Action</h3>
                <span className="pov-section-meta">{pendingCount} pending</span>
              </div>
              <div className="pov-pending-list">
                {SETTLEMENT_QUEUE.filter((s) => s.status !== "processing")
                  .slice(0, 3)
                  .map((s) => (
                    <button
                      className="pov-pending-row"
                      key={s.id}
                      onClick={() => setTab("settlement")}
                      type="button"
                    >
                      <div
                        className={`pov-pending-status pov-status-${STATUS_STYLES[s.status] || "review"}`}
                        aria-hidden="true"
                      />
                      <div className="pov-pending-body">
                        <strong>{s.counterparty}</strong>
                        <span>
                          {s.amount} {s.asset} · {s.signers.signed}/{s.signers.required}{" "}
                          signers · {s.submittedAt}
                        </span>
                      </div>
                      <ChevronRight size={14} className="pov-pending-chev" />
                    </button>
                  ))}
              </div>
            </>
          )}

          {/* ═════ Privacy toggle ═════ */}
          <button
            className="pov-privacy-toggle"
            onClick={() => setShowLimits(!showLimits)}
            type="button"
          >
            {showLimits ? <EyeOff size={11} /> : <Eye size={11} />}
            <span>{showLimits ? "Hide amounts" : "Show amounts"}</span>
          </button>
        </div>
        );
      })()}

      {/* ═══ TRANSFER — Apple Grade ═══ */}
      {tab === "transfer" && (
        <div>
          {/* Hero action buttons — gradient style */}
          <div className="xfer-actions">
            <button className="xfer-action-btn xfer-send" onClick={() => navigate("send")} type="button">
              <div className="xfer-action-circle"><ArrowUpRight size={22} strokeWidth={2.5} /></div>
              <strong>Send</strong>
              <span>Compliance-gated</span>
            </button>
            <button className="xfer-action-btn xfer-receive" onClick={() => navigate("receive")} type="button">
              <div className="xfer-action-circle"><ArrowDownLeft size={22} strokeWidth={2.5} /></div>
              <strong>Request</strong>
              <span>Invoice or link</span>
            </button>
          </div>

          {/* Compliance — compact shield strip */}
          <div className="xfer-shield-strip">
            <div className="xfer-shield-icon"><Shield size={14} /></div>
            <div className="xfer-shield-text">
              <strong>4 compliance gates active</strong>
              <span>AML · Travel Rule · Multi-sig · ISO 20022</span>
            </div>
            <CheckCircle2 size={16} style={{ color: "var(--success)", flexShrink: 0 }} />
          </div>

          {/* Recent transfers — timeline style */}
          <div className="section-header"><h3>Recent</h3></div>
          {[
            { to: "Circle Mint", amount: "$1.2M", asset: "USDC", time: "2h ago", icon: ArrowUpRight, color: "#2775ca" },
            { to: "Cruzible Vault", amount: "$645K", asset: "AETHEL", time: "1d ago", icon: ArrowUpRight, color: "#c41e1e" },
            { to: "Treasury Ops", amount: "$500K", asset: "USDC", time: "3d ago", icon: ArrowUpRight, color: "#2775ca" },
            { to: "BlackRock Fund", amount: "$1.0M", asset: "BUIDL", time: "5d ago", icon: ArrowDownLeft, color: "#8b5cf6" },
          ].map((tx, i) => (
            <div className="xfer-tx-row" key={i}>
              <div className="xfer-tx-icon" style={{ background: `${tx.color}18`, color: tx.color }}>
                <tx.icon size={14} />
              </div>
              <div className="xfer-tx-info">
                <strong>{tx.to}</strong>
                <span>{tx.time}</span>
              </div>
              <div className="xfer-tx-amount">
                <strong>{tx.amount}</strong>
                <span>{tx.asset}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ BATCH — Apple Grade ═══ */}
      {tab === "batch" && (
        <div>
          {/* Hero stat */}
          <div className="ac-hero" style={{ paddingBottom: 4 }}>
            <span className="ac-hero-label">Batch Templates</span>
            <h1 className="ac-hero-amount" style={{ fontSize: 28 }}>{BATCH_TEMPLATES.length}</h1>
            <span className="ac-hero-sub">saved templates ready to execute</span>
          </div>

          {/* Template cards — premium style */}
          {BATCH_TEMPLATES.map((b) => {
            const colors: Record<string, string> = { USDC: "#2775ca", AETHEL: "#c41e1e" };
            const color = colors[b.asset] ?? "var(--ink-soft)";
            return (
              <div className="batch-card" key={b.id}>
                <div className="batch-card-top">
                  <div className="batch-card-icon" style={{ background: `${color}18`, color }}>
                    <b.icon size={16} />
                  </div>
                  <div className="batch-card-info">
                    <strong>{b.name}</strong>
                    <span>{b.recipients} recipients · {b.asset}</span>
                  </div>
                  <span className="compliance-badge cleared">{b.status}</span>
                </div>
                <div className="batch-card-stats">
                  <div><span className="batch-stat-label">Amount</span><strong>{b.totalAmount}</strong></div>
                  <div><span className="batch-stat-label">Last Run</span><strong>{b.lastRun}</strong></div>
                </div>
                <button className="batch-exec-btn" type="button" onClick={() => navigate("send")} style={{ borderColor: color, color }}>
                  <Send size={12} /> Execute
                </button>
              </div>
            );
          })}

          {/* CSV upload */}
          <CsvUploadCard />

          {/* Recent runs — timeline */}
          <div className="section-header"><h3>History</h3></div>
          {RECENT_BATCH_RUNS.map((r) => (
            <div className="xfer-tx-row" key={r.id}>
              <div className="xfer-tx-icon" style={{ background: r.failures > 0 ? "rgba(255,159,10,0.12)" : "rgba(52,199,89,0.12)", color: r.failures > 0 ? "var(--warning)" : "var(--success)" }}>
                {r.failures > 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              </div>
              <div className="xfer-tx-info">
                <strong>{r.template}</strong>
                <span>{r.recipients} recipients · {r.runDate}</span>
              </div>
              <div className="xfer-tx-amount">
                <strong>{r.total.split(" ")[0]}</strong>
                <span>{r.total.split(" ")[1]}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ SCHEDULED — Apple Grade ═══ */}
      {tab === "scheduled" && (
        <div>
          {/* Hero */}
          <div className="ac-hero" style={{ paddingBottom: 4 }}>
            <span className="ac-hero-label">Automated Payments</span>
            <h1 className="ac-hero-amount" style={{ fontSize: 28 }}>{SCHEDULED.filter(s => s.status === "active").length}</h1>
            <span className="ac-hero-sub">active schedules running</span>
          </div>

          {SCHEDULED.map((s) => {
            const isActive = s.status === "active";
            const colors: Record<string, string> = { USDC: "#2775ca", AETHEL: "#c41e1e", BUIDL: "#8b5cf6" };
            const color = colors[s.asset] ?? "var(--ink-soft)";
            const icons: Record<string, typeof Calendar> = { Weekly: RefreshCw, Monthly: Calendar, "Bi-weekly": Clock };
            const FreqIcon = icons[s.frequency] ?? Calendar;
            return (
              <div className="sched-card" key={s.id} style={{ opacity: isActive ? 1 : 0.6 }}>
                <div className="sched-card-top">
                  <div className="sched-card-icon" style={{ background: `${color}18`, color }}>
                    <FreqIcon size={16} />
                  </div>
                  <div className="sched-card-info">
                    <strong>{s.recipient}</strong>
                    <span>{s.frequency}</span>
                  </div>
                  <span className={`compliance-badge ${isActive ? "cleared" : "review"}`}>{s.status}</span>
                </div>

                <div className="sched-card-amount">
                  <strong>{s.amount}</strong>
                  <span>{s.asset}</span>
                </div>

                <div className="sched-card-meta">
                  <div className="sched-meta-item">
                    <span className="sched-meta-label">Next</span>
                    <strong>{s.nextDate}</strong>
                  </div>
                  <div className="sched-meta-divider" />
                  <div className="sched-meta-item">
                    <span className="sched-meta-label">Last</span>
                    <strong>{s.lastExec.split(" — ")[0]}</strong>
                  </div>
                  <div className="sched-meta-divider" />
                  <div className="sched-meta-item">
                    <span className="sched-meta-label">Status</span>
                    <strong style={{ color: s.lastExec.includes("Success") ? "var(--success)" : "var(--warning)" }}>
                      {s.lastExec.includes("Success") ? "✓" : "⚠"} {s.lastExec.split(" — ")[1]}
                    </strong>
                  </div>
                </div>

                {!isActive && (
                  <div className="sched-card-alert">
                    <AlertTriangle size={12} />
                    <span>{s.compliance}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ SETTLEMENT — Apple Grade ═══ */}
      {tab === "settlement" && (
        <div>
          {/* Hero */}
          <div className="ac-hero" style={{ paddingBottom: 4 }}>
            <span className="ac-hero-label">Settlement Queue</span>
            <h1 className="ac-hero-amount" style={{ fontSize: 28 }}>{SETTLEMENT_QUEUE.length}</h1>
            <span className="ac-hero-sub">pending settlements</span>
          </div>

          {SETTLEMENT_QUEUE.map((s) => {
            const colors: Record<string, string> = { USDC: "#2775ca", AETHEL: "#c41e1e", BUIDL: "#8b5cf6", PYUSD: "#ff9f0a" };
            const color = colors[s.asset] ?? "var(--ink-soft)";
            const isProcessing = s.status === "processing";
            const signerPct = (s.signers.signed / s.signers.required) * 100;
            return (
              <div className="settle-card" key={s.id}>
                {/* Header */}
                <div className="settle-card-top">
                  <div className="settle-card-icon" style={{ background: `${color}18`, color }}>
                    <Landmark size={16} />
                  </div>
                  <div className="settle-card-info">
                    <strong>{s.counterparty}</strong>
                    <span>{s.reference}</span>
                  </div>
                  <span className={`compliance-badge ${STATUS_STYLES[s.status]}`}>{s.status.replace(/-/g, " ")}</span>
                </div>

                {/* Amount */}
                <div className="sched-card-amount">
                  <strong>{s.amount}</strong>
                  <span>{s.asset}</span>
                </div>

                {/* Signer progress */}
                <div className="settle-signers">
                  <div className="settle-signer-header">
                    <span>Signatures</span>
                    <strong>{s.signers.signed}/{s.signers.required}</strong>
                  </div>
                  <div className="settle-signer-bar">
                    <div style={{ width: `${signerPct}%`, background: signerPct >= 100 ? "var(--success)" : color }} />
                  </div>
                </div>

                {/* Meta row */}
                <div className="settle-meta-row">
                  <div className="settle-meta-chip" style={{ color: s.riskScore === "medium" ? "var(--warning)" : "var(--success)" }}>
                    <Shield size={10} /> {s.riskScore} risk
                  </div>
                  {s.travelRule && (
                    <div className="settle-meta-chip" style={{ color: "var(--ink-soft)" }}>
                      <Globe size={10} /> Travel Rule
                    </div>
                  )}
                  <span className="settle-time">{s.submittedAt}</span>
                </div>

                {/* Actions */}
                {!isProcessing && (
                  <div className="settle-actions">
                    <button className="settle-btn settle-approve" type="button"><CheckCircle2 size={14} /> Approve</button>
                    <button className="settle-btn settle-reject" type="button"><AlertTriangle size={14} /> Reject</button>
                  </div>
                )}
                {isProcessing && (
                  <div className="settle-processing">
                    <RefreshCw size={12} className="spinner" />
                    <span>Processing settlement...</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ RECIPIENTS — Apple Grade ═══ */}
      {tab === "recipients" && (
        <div>
          {/* Hero */}
          <div className="ac-hero" style={{ paddingBottom: 4 }}>
            <span className="ac-hero-label">Address Book</span>
            <h1 className="ac-hero-amount" style={{ fontSize: 28 }}>{RECIPIENTS.length}</h1>
            <span className="ac-hero-sub">verified recipients</span>
          </div>

          {RECIPIENTS.map((r) => {
            const typeColors: Record<string, string> = { Internal: "#34c759", VASP: "#2775ca", Institutional: "#8b5cf6", Protocol: "#ff9f0a" };
            const typeIcons: Record<string, typeof Building2> = { Internal: Wallet, VASP: Globe, Institutional: Building2, Protocol: Layers };
            const color = typeColors[r.type] ?? "var(--ink-soft)";
            const TypeIcon = typeIcons[r.type] ?? Users;
            return (
              <div className="recip-card" key={r.id}>
                <div className="recip-card-top">
                  <div className="recip-card-icon" style={{ background: `${color}18`, color }}>
                    <TypeIcon size={16} />
                  </div>
                  <div className="recip-card-info">
                    <strong>{r.name}</strong>
                    <span className="recip-address">{r.address}</span>
                  </div>
                  <span className={`compliance-badge ${r.riskTier === "Medium" ? "review" : "cleared"}`}>{r.type}</span>
                </div>

                <div className="recip-stats">
                  <div className="recip-stat">
                    <span className="recip-stat-label">Risk</span>
                    <strong style={{ color: r.riskTier === "Medium" ? "var(--warning)" : "var(--success)" }}>{r.riskTier}</strong>
                  </div>
                  <div className="recip-stat-divider" />
                  <div className="recip-stat">
                    <span className="recip-stat-label">KYC</span>
                    <strong>{r.kycStatus}</strong>
                  </div>
                  <div className="recip-stat-divider" />
                  <div className="recip-stat">
                    <span className="recip-stat-label">Volume</span>
                    <strong>{r.totalVolume}</strong>
                  </div>
                  <div className="recip-stat-divider" />
                  <div className="recip-stat">
                    <span className="recip-stat-label">Last</span>
                    <strong>{r.lastUsed}</strong>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Add button */}
          <button className="recip-add-btn" type="button" onClick={() => navigate("contacts")}>
            <Users size={16} />
            <span>Add New Recipient</span>
          </button>
        </div>
      )}
    </div>
  );
}
