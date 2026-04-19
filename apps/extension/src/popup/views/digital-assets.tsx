import { useMemo, useState } from "react";
import {
  Award, FileCheck, Building2, Stamp, ScrollText,
  Lock, Sparkles, ShieldCheck, Leaf, Ship, CheckCircle2,
  Clock, TrendingUp,
} from "lucide-react";

type AssetTab = "certificates" | "badges" | "documents";
type CertStatus = "valid" | "renewal-due";

interface Certificate {
  id: string;
  title: string;
  issuer: string;
  issuedAt: string;      // ISO-parsable date string
  expiresAt: string;     // ISO-parsable date string
  status: CertStatus;
  type: string;
}

interface Badge {
  id: string;
  title: string;
  level: string;
  issuedAt: string;
  soulbound: boolean;
  chain: string;
}

type DocCategory = "bond" | "carbon" | "trade";
interface TokenizedDocument {
  id: string;
  title: string;
  type: string;
  category: DocCategory;
  value: string;
  numericValue: number;  // for hero totals
  issuer: string;
  chain: string;
  tokenStandard: string;
}

const CERTIFICATES: Certificate[] = [
  { id: "c1", title: "SOC 2 Type II Compliance", issuer: "Aethelred Foundation", issuedAt: "Mar 15, 2026", expiresAt: "Mar 15, 2027", status: "valid", type: "Compliance Certificate" },
  { id: "c2", title: "ISO 27001 Information Security", issuer: "BSI Group", issuedAt: "Jan 8, 2026", expiresAt: "Jan 8, 2029", status: "valid", type: "Security Certificate" },
  { id: "c3", title: "ADGM DLT Foundation License", issuer: "ADGM FSRA", issuedAt: "Nov 1, 2025", expiresAt: "Nov 1, 2026", status: "renewal-due", type: "Regulatory License" },
];

const BADGES: Badge[] = [
  { id: "b1", title: "KYC Enhanced Verified",       level: "Enhanced",      issuedAt: "Apr 1, 2026",  soulbound: true,  chain: "Ethereum" },
  { id: "b2", title: "AML Clean Record (12 months)", level: "Gold",          issuedAt: "Apr 11, 2026", soulbound: true,  chain: "Ethereum" },
  { id: "b3", title: "Accredited Investor",         level: "Institutional", issuedAt: "Feb 15, 2026", soulbound: true,  chain: "Ethereum" },
  { id: "b4", title: "Cruzible Validator Delegate", level: "Active",        issuedAt: "Mar 1, 2026",  soulbound: false, chain: "Aethelred" },
];

const DOCUMENTS: TokenizedDocument[] = [
  { id: "d1", title: "Tokenized Treasury Bond — Series A",        type: "Bond",         category: "bond",   value: "$3,000,000",    numericValue: 3_000_000, issuer: "BlackRock", chain: "Ethereum",  tokenStandard: "ERC-1155" },
  { id: "d2", title: "Carbon Credit Certificate — Batch 2026-Q1", type: "Environmental", category: "carbon", value: "5,000 t CO₂",   numericValue: 0,          issuer: "TerraQura", chain: "Aethelred", tokenStandard: "ERC-721"  },
  { id: "d3", title: "Trade Finance Letter of Credit",            type: "Trade Finance", category: "trade",  value: "$1,200,000",    numericValue: 1_200_000, issuer: "NoblePay",  chain: "Ethereum",  tokenStandard: "ERC-721"  },
];

/* Level → gradient pair. Gold uses actual gold tones, Enhanced uses trust blue,
   Institutional uses premium purple, Active uses live green. Semantic color
   mapping like iOS Settings tile convention. */
const LEVEL_META: Record<string, { from: string; to: string; glow: string }> = {
  Gold:          { from: "#f59e0b", to: "#fbbf24", glow: "rgba(245, 158, 11, 0.35)" },
  Enhanced:      { from: "#2775ca", to: "#4a9eff", glow: "rgba(39, 117, 202, 0.35)" },
  Institutional: { from: "#8b5cf6", to: "#a78bfa", glow: "rgba(139, 92, 246, 0.35)" },
  Active:        { from: "#34c759", to: "#30d158", glow: "rgba(52, 199, 89, 0.35)" },
};

/* Document category → icon + color. Bonds get the document stack in
   teal (institutional), carbon credits get a leaf in green (environmental),
   trade finance gets a ship icon in blue (international commerce). */
const DOC_META: Record<DocCategory, { Icon: typeof Building2; color: string; label: string }> = {
  bond:   { Icon: Building2, color: "#0ea5e9", label: "Fixed Income" },
  carbon: { Icon: Leaf,      color: "#34c759", label: "Environmental" },
  trade:  { Icon: Ship,      color: "#2775ca", label: "Trade Finance" },
};

/* ─── Date helpers ──────────────────────────────────────────────── *
 * Parses the human-readable date strings from the fixture data and
 * computes an expiry progress percentage (0 = just issued, 100 = expired).
 * The "today" reference is new Date() — fixture dates are anchored to
 * early 2026 so the three certificates render at believable progress
 * states in development. */
function parseDate(s: string): Date {
  return new Date(s);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatRemaining(days: number): string {
  if (days <= 0) return "Expired";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} left`;
  if (days < 365) return `${Math.round(days / 30)} months left`;
  const years = Math.floor(days / 365);
  const remainingMonths = Math.round((days % 365) / 30);
  return remainingMonths > 0
    ? `${years}y ${remainingMonths}mo left`
    : `${years} year${years === 1 ? "" : "s"} left`;
}

export function DigitalAssetsView() {
  const [tab, setTab] = useState<AssetTab>("certificates");

  /* Pre-compute per-certificate expiry state so the UI doesn't recalc
     on every render. Memoized on the CERTIFICATES constant which never
     changes, so effectively cached once. */
  const certStates = useMemo(() => {
    const now = new Date();
    return CERTIFICATES.map(c => {
      const issued = parseDate(c.issuedAt);
      const expires = parseDate(c.expiresAt);
      const totalDays = daysBetween(issued, expires) || 1;
      const elapsedDays = Math.max(0, daysBetween(issued, now));
      const remainingDays = Math.max(0, daysBetween(now, expires));
      const percentElapsed = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
      return { id: c.id, percentElapsed, remainingDays, remainingLabel: formatRemaining(remainingDays) };
    });
  }, []);

  /* Aggregate values for the Documents hero — only monetary assets
     count toward "Total value" (the carbon credit is unit-denominated). */
  const totalDocValue = useMemo(() => {
    const total = DOCUMENTS.reduce((sum, d) => sum + d.numericValue, 0);
    return "$" + (total / 1_000_000).toFixed(1) + "M";
  }, []);

  const expiringSoon = certStates.filter(s => s.remainingDays < 365).length;

  return (
    <div className="view-padded">
      {/* ───── Digital Vault hero ───── */}
      <div className="da-hero">
        <div className="da-hero-top">
          <div className="da-hero-icon">
            <Stamp size={18} strokeWidth={2.3} />
          </div>
          <div className="da-hero-title-block">
            <span className="da-hero-label">DIGITAL VAULT</span>
            <strong className="da-hero-title">
              {CERTIFICATES.length + BADGES.length + DOCUMENTS.length} <span>tokenized assets</span>
            </strong>
          </div>
          <div className="da-hero-badge">
            <ShieldCheck size={14} />
            <span>Verified</span>
          </div>
        </div>
        <div className="da-hero-stats">
          <div className="da-hero-stat">
            <strong>{CERTIFICATES.length}</strong>
            <span>Certificates</span>
          </div>
          <div className="da-hero-divider" />
          <div className="da-hero-stat">
            <strong>{BADGES.length}</strong>
            <span>Badges</span>
          </div>
          <div className="da-hero-divider" />
          <div className="da-hero-stat">
            <strong>{totalDocValue}</strong>
            <span>RWA Value</span>
          </div>
        </div>
      </div>

      {/* ───── Sub tabs ───── */}
      <div className="sub-tabs">
        <button className={`sub-tab ${tab === "certificates" ? "active" : ""}`} onClick={() => setTab("certificates")} type="button">
          <Award size={13} /> Certificates
        </button>
        <button className={`sub-tab ${tab === "badges" ? "active" : ""}`} onClick={() => setTab("badges")} type="button">
          <Stamp size={13} /> Badges
        </button>
        <button className={`sub-tab ${tab === "documents" ? "active" : ""}`} onClick={() => setTab("documents")} type="button">
          <ScrollText size={13} /> Documents
        </button>
      </div>

      {/* ───── Certificates tab ───── */}
      {tab === "certificates" && (
        <div>
          {expiringSoon > 0 && (
            <div className="da-banner">
              <Clock size={14} />
              <span>{expiringSoon} certificate{expiringSoon === 1 ? "" : "s"} {expiringSoon === 1 ? "expires" : "expire"} within the next 12 months</span>
            </div>
          )}

          <div className="da-section-label">Compliance &amp; Regulatory</div>

          <div className="da-cert-list">
            {CERTIFICATES.map(cert => {
              const state = certStates.find(s => s.id === cert.id)!;
              const isValid = cert.status === "valid";
              const heatClass = state.percentElapsed > 75 ? "hot" : state.percentElapsed > 50 ? "warm" : "cool";
              return (
                <div className="da-cert-card" key={cert.id}>
                  <div className="da-cert-top">
                    <div className="da-cert-icon">
                      <FileCheck size={16} strokeWidth={2.3} />
                    </div>
                    <div className="da-cert-body">
                      <strong className="da-cert-title">{cert.title}</strong>
                      <div className="da-cert-meta">
                        <span>{cert.type}</span>
                        <span className="da-meta-dot" />
                        <span>{cert.issuer}</span>
                      </div>
                    </div>
                    <div className={`da-status-pill ${isValid ? "valid" : "warn"}`}>
                      <span className="da-status-dot" />
                      {isValid ? "Valid" : "Renewal"}
                    </div>
                  </div>

                  <div className="da-cert-progress">
                    <div className="da-cert-progress-header">
                      <span className="da-cert-range">{cert.issuedAt} → {cert.expiresAt}</span>
                      <span className={`da-cert-remaining ${heatClass}`}>{state.remainingLabel}</span>
                    </div>
                    <div className="da-cert-track">
                      <div
                        className={`da-cert-fill ${heatClass}`}
                        style={{ width: `${state.percentElapsed}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ───── Badges (Soulbound Tokens) tab ───── */}
      {tab === "badges" && (
        <div>
          <div className="da-section-label">Identity &amp; Reputation SBTs</div>

          <div className="da-badge-grid">
            {BADGES.map(badge => {
              const meta = LEVEL_META[badge.level] ?? LEVEL_META.Active;
              return (
                <div className="da-badge-card" key={badge.id}>
                  <div
                    className="da-badge-tile"
                    style={{
                      background: `linear-gradient(135deg, ${meta.from} 0%, ${meta.to} 100%)`,
                      boxShadow: `0 4px 14px ${meta.glow}, inset 0 1px 0 rgba(255, 255, 255, 0.2)`,
                    }}
                  >
                    <Sparkles size={20} strokeWidth={2.3} />
                    {badge.soulbound && (
                      <div className="da-badge-lock" title="Soulbound — non-transferable">
                        <Lock size={9} strokeWidth={3} />
                      </div>
                    )}
                  </div>
                  <div className="da-badge-body">
                    <strong className="da-badge-title">{badge.title}</strong>
                    <div className="da-badge-meta">
                      <span className="da-badge-level" style={{ color: meta.from }}>{badge.level}</span>
                      <span className="da-meta-dot" />
                      <span>{badge.chain}</span>
                    </div>
                    <span className="da-badge-date">Issued {badge.issuedAt}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ───── Documents (Tokenized RWA) tab ───── */}
      {tab === "documents" && (
        <div>
          <div className="da-section-label">Tokenized Real-World Assets</div>

          <div className="da-doc-list">
            {DOCUMENTS.map(doc => {
              const meta = DOC_META[doc.category];
              const { Icon } = meta;
              return (
                <div className="da-doc-card" key={doc.id}>
                  <div className="da-doc-top">
                    <div
                      className="da-doc-icon"
                      style={{
                        background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}c0 100%)`,
                        boxShadow: `0 3px 10px ${meta.color}40`,
                      }}
                    >
                      <Icon size={16} strokeWidth={2.3} />
                    </div>
                    <div className="da-doc-body">
                      <strong className="da-doc-title">{doc.title}</strong>
                      <span className="da-doc-category" style={{ color: meta.color }}>{meta.label}</span>
                    </div>
                  </div>

                  <div className="da-doc-value-row">
                    <div className="da-doc-value-col">
                      <span className="da-doc-value-label">Notional</span>
                      <strong className="da-doc-value">{doc.value}</strong>
                    </div>
                    <div className="da-doc-issuer">
                      <span>Issued by</span>
                      <strong>{doc.issuer}</strong>
                    </div>
                  </div>

                  <div className="da-doc-footer">
                    <div className="da-doc-chip">
                      <CheckCircle2 size={10} />
                      <span>{doc.tokenStandard}</span>
                    </div>
                    <div className="da-doc-chip">
                      <TrendingUp size={10} />
                      <span>{doc.chain}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
