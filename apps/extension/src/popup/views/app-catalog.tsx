import { useState } from "react";
import { Globe, ShieldCheck, ChevronLeft, ChevronRight, ArrowRight, CheckCircle2, Sparkles, Zap, TrendingUp, BookOpen, AlertTriangle, AlertCircle } from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { DappLogo } from "../components/dapp-logo";
import { EmptyState } from "../components/empty-state";
import { useNavigation } from "../router";
import { useComingSoon } from "../hooks/use-coming-soon";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";
import "../../styles/legacy/app-catalog.css";

/* Action button — primary user-facing CTA */
interface DAppAction {
  label: string;
  description: string;
  primary?: boolean;
}

/* Key metric shown in stats grid */
interface DAppStat {
  label: string;
  value: string;
  trend?: "up" | "down" | "neutral";
}

/* Trust/security indicator */
interface DAppTrust {
  label: string;
  detail: string;
}

/* Risk disclosure — plain-language warning */
interface DAppRisk {
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
}

interface DAppDetail {
  id: string;
  name: string;
  category: string;
  logo: string;
  logoBg: string;
  status: string;
  statusColor: string;
  integrationMode: string;
  trustLevel: string;
  summary: string;
  features: string[];
  /* New user-facing sections */
  actions: DAppAction[];
  stats: DAppStat[];
  howItWorks: string[]; // 3 steps
  trust: DAppTrust[];
  risks: DAppRisk[];
}

const DAPPS: DAppDetail[] = [
  {
    id: "cruzible",
    name: "Cruzible",
    category: "Treasury / Liquid Staking",
    logo: "/dapp-cruzible.png",
    logoBg: "#1e1b5e",
    status: "Live",
    statusColor: "success",
    integrationMode: "EVM",
    trustLevel: "First-party",
    summary: "Liquid staking vault with TEE-verified validator selection. Stake AETHEL, receive stAETHEL, earn 8.4% APY with 14-day unbonding.",
    features: ["Liquid staking with stAETHEL", "TEE validator attestation", "Merkle proof reward distribution", "14-day unbonding period", "Multi-attestor quorum (2/3)", "Keeper bond challenge mechanism"],
    actions: [
      { label: "Stake AETHEL", description: "Lock AETHEL and earn yield", primary: true },
      { label: "Claim Rewards", description: "Withdraw earned stAETHEL" },
      { label: "Unstake", description: "Begin the 14-day unbonding period" },
    ],
    stats: [
      { label: "APY", value: "8.4%", trend: "up" },
      { label: "TVL", value: "$52.4M" },
      { label: "Your Position", value: "1.2M AETHEL" },
      { label: "Total Stakers", value: "847" },
    ],
    howItWorks: [
      "Deposit AETHEL into the vault — you'll receive stAETHEL 1:1 as a receipt token.",
      "TEE-verified validators stake your AETHEL on the network and earn rewards on your behalf.",
      "Your stAETHEL balance grows automatically with each reward distribution, and can be unstaked anytime.",
    ],
    trust: [
      { label: "Audited by ConsenSys Diligence", detail: "Full report published Mar 2026" },
      { label: "$50M slashing insurance", detail: "Backed by Aethelred Foundation" },
      { label: "TEE validator attestation", detail: "Hardware-verified execution" },
      { label: "Open source", detail: "github.com/aethelred-foundation/cruzible" },
    ],
    risks: [
      { severity: "low", title: "14-day unbonding period", detail: "Unstaked funds are locked for 14 days before becoming withdrawable." },
      { severity: "medium", title: "Slashing risk", detail: "Validator misbehavior can result in a small penalty. Insured up to $50M." },
      { severity: "low", title: "Smart contract risk", detail: "Audited code, but all on-chain protocols carry residual risk." },
    ],
  },
  {
    id: "zeroid",
    name: "ZeroID",
    category: "Self-Sovereign Identity",
    logo: "/dapp-zeroid.png",
    logoBg: "#2a2a2a",
    status: "Planned",
    statusColor: "",
    integrationMode: "EVM",
    trustLevel: "First-party",
    summary: "Decentralized identity registry with recovery, delegation, and auth key management. 48-hour recovery timelock, up to 16 auth keys per identity.",
    features: ["DID registration with recovery hash", "48-hour recovery timelock", "Delegate management with expiry", "Up to 16 auth keys per identity", "Batch registration (50/tx)", "Nonce-based replay protection"],
    actions: [
      { label: "Create Identity", description: "Register a new decentralized identity", primary: true },
      { label: "Manage Keys", description: "Add or revoke authorization keys" },
      { label: "Add Delegate", description: "Authorize someone to act on your behalf" },
    ],
    stats: [
      { label: "Total IDs", value: "14,280", trend: "up" },
      { label: "Your IDs", value: "0" },
      { label: "Recovery Time", value: "48 hours" },
      { label: "Max Auth Keys", value: "16" },
    ],
    howItWorks: [
      "Register a decentralized identifier (DID) linked to a recovery hash — you own it, not a company.",
      "Add authorization keys for different devices, or delegate limited permissions to trusted parties.",
      "If you lose access, initiate recovery — after a 48-hour safety window you regain control.",
    ],
    trust: [
      { label: "W3C DID compliant", detail: "Open identity standard" },
      { label: "Self-custodial", detail: "Only you can control your identity" },
      { label: "48-hour recovery timelock", detail: "Protects against unauthorized recovery" },
      { label: "Open source", detail: "github.com/aethelred-foundation/zeroid" },
    ],
    risks: [
      { severity: "medium", title: "Key management responsibility", detail: "You are solely responsible for securing your authorization keys." },
      { severity: "low", title: "Recovery timelock", detail: "If compromised, recovery takes 48 hours — prevents rushed attacks but delays legitimate use." },
    ],
  },
  {
    id: "terraqura",
    name: "TerraQura",
    category: "Carbon Credit Governance",
    logo: "/dapp-terraqura.png",
    logoBg: "#2e6b3e",
    status: "Design",
    statusColor: "warning",
    integrationMode: "EVM",
    trustLevel: "First-party",
    summary: "M-of-N multisig governance for carbon credit verification. EIP-712 typed signatures, 7-day transaction expiry, 2-10 signers.",
    features: ["M-of-N multisig (2-10 signers)", "EIP-712 typed data signing", "7-day transaction expiry", "Signer add/remove governance", "Confirmation threshold tracking", "Batch governance actions"],
    actions: [
      { label: "Submit Proposal", description: "Propose a new governance action", primary: true },
      { label: "Review Pending", description: "Sign off on in-flight proposals" },
      { label: "Manage Signers", description: "Add or remove multi-sig members" },
    ],
    stats: [
      { label: "Active Signers", value: "5 of 7" },
      { label: "Pending", value: "3 proposals" },
      { label: "Executed", value: "142 total" },
      { label: "Quorum", value: "3 of 5" },
    ],
    howItWorks: [
      "Any member submits a governance proposal — it's signed with EIP-712 typed data for clarity.",
      "Other signers review and confirm. The proposal needs M of N signatures to reach the quorum.",
      "Once approved, the transaction executes on-chain automatically. Expires after 7 days if unexecuted.",
    ],
    trust: [
      { label: "Multi-sig governance", detail: "No single point of control" },
      { label: "EIP-712 signed proposals", detail: "Human-readable signing surface" },
      { label: "7-day expiry", detail: "Prevents stale proposals from lingering" },
      { label: "Open source", detail: "github.com/aethelred-foundation/terraqura" },
    ],
    risks: [
      { severity: "medium", title: "Coordination overhead", detail: "Requires M signers to cooperate — slower than single-sig, but much safer." },
      { severity: "medium", title: "Key loss risk", detail: "If enough signers lose their keys, governance becomes impossible to complete." },
    ],
  },
  {
    id: "shiora",
    name: "Shiora",
    category: "Health Data Management",
    logo: "",
    logoBg: "#0ea5e9",
    status: "Design",
    statusColor: "warning",
    integrationMode: "Cosmos compatibility",
    trustLevel: "First-party",
    summary: "Privacy-preserving health record registry with consent management. AES-256-GCM encryption, IPFS storage, fine-grained consent with 10 scopes.",
    features: ["Encrypted health records (AES-256-GCM)", "IPFS CID storage with pinning", "Consent management (10 scopes)", "Auto-renewal with opt-out", "TEE attestation for verification", "Cosmos SDK compatibility layer"],
    actions: [
      { label: "Upload Record", description: "Encrypt and register a health record", primary: true },
      { label: "Grant Consent", description: "Share with a provider for a period" },
      { label: "View Consents", description: "Manage who can access what" },
    ],
    stats: [
      { label: "Total Users", value: "6,840", trend: "up" },
      { label: "Your Records", value: "0" },
      { label: "Active Consents", value: "0" },
      { label: "Encryption", value: "AES-256-GCM" },
    ],
    howItWorks: [
      "Your health record is encrypted locally with AES-256-GCM before it ever leaves your device.",
      "The encrypted blob is stored on IPFS with pinning — you control the storage key.",
      "Grant scoped, time-limited access to providers. Revoke anytime with a single tap.",
    ],
    trust: [
      { label: "End-to-end encrypted", detail: "Keys never leave your device" },
      { label: "IPFS with pinning", detail: "Decentralized, redundant storage" },
      { label: "Consent-based access", detail: "10 granular permission scopes" },
      { label: "HIPAA-compatible design", detail: "Works with US healthcare regulations" },
      { label: "Open source", detail: "github.com/aethelred-foundation/shiora" },
    ],
    risks: [
      { severity: "high", title: "Encryption key loss", detail: "If you lose your key, records cannot be recovered. Back it up securely." },
      { severity: "medium", title: "IPFS pinning dependency", detail: "Unpinned records may become inaccessible over time." },
    ],
  },
  {
    id: "noblepay",
    name: "NoblePay",
    category: "Compliance-Gated Payments",
    logo: "/dapp-noblepay.jpg",
    logoBg: "#f5f0e0",
    status: "Design",
    statusColor: "warning",
    integrationMode: "EVM",
    trustLevel: "First-party",
    summary: "Cross-border payments with AML screening, sanctions checks, and FATF Travel Rule compliance. TEE attestation before settlement, 3 business tiers.",
    features: ["AML risk scoring (0-100)", "Sanctions list screening", "FATF Travel Rule compliance", "3 tiers: Standard/Premium/Enterprise", "TEE attestation for settlement", "Fee split: 70% recipient / 30% treasury"],
    actions: [
      { label: "Send Payment", description: "Initiate a compliance-screened transfer", primary: true },
      { label: "View Pending", description: "Track AML-reviewed payments" },
      { label: "Refund", description: "Reverse a payment within the policy window" },
    ],
    stats: [
      { label: "24h Volume", value: "$8.1M", trend: "up" },
      { label: "Your Tier", value: "Enterprise" },
      { label: "Screenings", value: "Real-time" },
      { label: "Fee", value: "0.1%" },
    ],
    howItWorks: [
      "Initiate a payment — recipient, amount, and purpose are captured upfront for Travel Rule compliance.",
      "AML screening runs automatically: sanctions lists, risk scoring, and jurisdiction checks.",
      "Approved payments settle via TEE-attested execution. Failed screenings return the funds with a reason.",
    ],
    trust: [
      { label: "AML screening (0-100 risk score)", detail: "Every payment scored in real time" },
      { label: "FATF Travel Rule compliant", detail: "Originator & beneficiary data captured" },
      { label: "OFAC / EU / UN sanctions", detail: "Live list updates" },
      { label: "TEE-verified settlement", detail: "Hardware-attested execution" },
      { label: "Open source", detail: "github.com/aethelred-foundation/noblepay" },
    ],
    risks: [
      { severity: "low", title: "Compliance delays", detail: "Payments flagged by AML may take up to 24 hours to review." },
      { severity: "low", title: "Refund timelock", detail: "Refunds subject to a 48-hour dispute window." },
    ],
  },
];

// Uses the shared DappLogo component from ../components/dapp-logo.tsx

export function AppCatalogView({ state: _state }: { state: AethelredWalletState }) {
  /* Read optional initial appId from route params so other views can deep-link
     into a specific dApp detail via navigate("app-catalog", { appId: "cruzible" }). */
  const { params } = useNavigation();
  const comingSoon = useComingSoon();
  const initialAppId = params?.appId ?? null;
  const [selected, setSelected] = useState<string | null>(initialAppId);
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const visibleDapps = IS_PRODUCTION_BUILD ? DAPPS.filter((d) => d.status === "Live") : DAPPS;
  const selectedApp = DAPPS.find((d) => d.id === selected) ?? null;
  const blockedApp = IS_PRODUCTION_BUILD && selectedApp && selectedApp.status !== "Live" ? selectedApp : null;

  if (blockedApp) {
    return (
      <div className="view-padded dapp-detail">
        <button className="dapp-back" onClick={() => setSelected(null)} type="button">
          <ChevronLeft size={16} />
          <span>Catalog</span>
        </button>

        <EmptyState
          icon={<AlertTriangle size={28} />}
          title={`${blockedApp.name} is not available in this release`}
          description="Production only shows live dApps. Roadmap, planned, and design surfaces stay hidden until they ship."
          tone="warning"
          padding="lg"
          action={{ label: "Back to Catalog", onClick: () => setSelected(null), primary: true }}
        />
      </div>
    );
  }

  if (selectedApp && (!IS_PRODUCTION_BUILD || selectedApp.status === "Live")) {
    const app = selectedApp;
    return (
      <div className="view-padded dapp-detail">
        {/* Back button */}
        <button className="dapp-back" onClick={() => setSelected(null)} type="button">
          <ChevronLeft size={16} />
          <span>Catalog</span>
        </button>

        {/* Premium hero card */}
        <div className="dapp-detail-hero">
          <div className="dapp-detail-hero-mesh" aria-hidden="true" />
          <div className="dapp-detail-hero-top">
            <div className="dapp-detail-logo">
              <DappLogo name={app.name} size={56} />
            </div>
            <div className="dapp-detail-title">
              <h2>{app.name}</h2>
              <span>{app.category}</span>
            </div>
          </div>
          <div className="dapp-detail-meta-row">
            <span className={`dapp-detail-status dapp-detail-status-${app.statusColor || "neutral"}`}>
              ● {app.status}
            </span>
            <span className="dapp-detail-chip"><ShieldCheck size={10} /> {app.trustLevel}</span>
          </div>
          <p className="dapp-detail-summary">{app.summary}</p>
        </div>

        {/* ─── Actions — primary user CTAs ─── */}
        <div className="dapp-detail-section">
          <div className="dapp-detail-section-header">
            <Zap size={14} />
            <h3>Actions</h3>
          </div>
          {IS_PRODUCTION_BUILD ? (
            <EmptyState
              icon={<Zap size={18} />}
              title="Protocol actions unavailable"
              description="Production hides launch shortcuts and in-protocol actions until the wallet ships a real dApp browser."
              tone="info"
              padding="sm"
            />
          ) : (
            <div className="dapp-actions-grid">
              {app.actions.map((a, i) => (
                <button
                  className={`dapp-action-btn is-coming-soon ${a.primary ? "primary" : ""}`}
                  key={i}
                  type="button"
                  onClick={() => comingSoon(`${app.name} · ${a.label}`, "dApp actions wire up in v1.0")}
                >
                  <div className="dapp-action-body">
                    <strong>{a.label}</strong>
                    <span>{a.description}</span>
                  </div>
                  <ArrowRight size={14} className="dapp-action-arrow" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ─── Stats — live metrics ─── */}
        <div className="dapp-detail-section">
          <div className="dapp-detail-section-header">
            <TrendingUp size={14} />
            <h3>Key Metrics</h3>
          </div>
          <div className="dapp-stats-grid">
            {app.stats.map((s, i) => (
              <div className="dapp-stat-card" key={i}>
                <span className="dapp-stat-label">{s.label}</span>
                <strong className={`dapp-stat-value ${s.trend === "up" ? "up" : ""}`}>{s.value}</strong>
              </div>
            ))}
          </div>
        </div>

        {/* ─── How it works ─── */}
        <div className="dapp-detail-section">
          <div className="dapp-detail-section-header">
            <BookOpen size={14} />
            <h3>How It Works</h3>
          </div>
          <div className="dapp-steps">
            {app.howItWorks.map((step, i) => (
              <div className="dapp-step" key={i}>
                <div className="dapp-step-num">{i + 1}</div>
                <p>{step}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Features — premium card list ─── */}
        <div className="dapp-detail-section">
          <div className="dapp-detail-section-header">
            <Sparkles size={14} />
            <h3>Features</h3>
            <span className="dapp-detail-count">{app.features.length}</span>
          </div>
          <div className="dapp-features-grid">
            {app.features.map((f, i) => (
              <div className="dapp-feature-card" key={i}>
                <div className="dapp-feature-dot"><CheckCircle2 size={13} /></div>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Trust & Security ─── */}
        <div className="dapp-detail-section">
          <div className="dapp-detail-section-header">
            <ShieldCheck size={14} />
            <h3>Trust & Security</h3>
          </div>
          <div className="dapp-trust-list">
            {app.trust.map((t, i) => (
              (() => {
                /* If the detail is a GitHub URL, render the card as an external link */
                const isLink = t.detail.startsWith("github.com/") || t.detail.startsWith("https://");
                const href = isLink
                  ? (t.detail.startsWith("http") ? t.detail : `https://${t.detail}`)
                  : undefined;
                const Tag: "a" | "div" = isLink ? "a" : "div";
                const linkProps = isLink
                  ? { href, target: "_blank", rel: "noopener noreferrer", className: "dapp-trust-card dapp-trust-card-link" }
                  : { className: "dapp-trust-card" };
                return (
                  <Tag {...(linkProps as any)} key={i}>
                    <div className="dapp-trust-icon"><ShieldCheck size={13} /></div>
                    <div className="dapp-trust-info">
                      <strong>{t.label}</strong>
                      <span>{t.detail}</span>
                    </div>
                    {isLink && <ArrowRight size={12} className="dapp-trust-arrow" />}
                  </Tag>
                );
              })()
            ))}
          </div>
        </div>

        {/* ─── Risks ─── */}
        <div className="dapp-detail-section">
          <div className="dapp-detail-section-header">
            <AlertTriangle size={14} />
            <h3>Things to Know</h3>
          </div>
          <div className="dapp-risks-list">
            {app.risks.map((r, i) => (
              <div className={`dapp-risk-card dapp-risk-${r.severity}`} key={i}>
                <div className="dapp-risk-icon">
                  <AlertCircle size={13} />
                </div>
                <div className="dapp-risk-info">
                  <strong>{r.title}</strong>
                  <span>{r.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Launch button */}
        {IS_PRODUCTION_BUILD ? (
          <button
            className="dapp-launch-btn"
            type="button"
            disabled
            aria-label={`Launch ${app.name} unavailable in this release`}
          >
            <span>Launch unavailable in this release</span>
            <ArrowRight size={16} />
          </button>
        ) : (
          <button
            className="dapp-launch-btn is-coming-soon"
            type="button"
            onClick={() => comingSoon(`Launch ${app.name}`, "dApp browser ships in v1.0")}
          >
            <span>Launch {app.name}</span>
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    );
  }

  /* ─── Catalog list view — Apple Grade ─── */

  /* Map each detailed category to a top-level facet so the filter
     chips stay scannable even as new dApps are added. */
  const facetOf = (cat: string): string => {
    const c = cat.toLowerCase();
    if (c.includes("staking") || c.includes("treasury") || c.includes("carbon")) return "Finance";
    if (c.includes("governance") || c.includes("vote")) return "Governance";
    if (c.includes("identity") || c.includes("id")) return "Identity";
    if (c.includes("compliance") || c.includes("payment")) return "Compliance";
    if (c.includes("health") || c.includes("data")) return "Data";
    return "Protocol";
  };

  /* Facet counts for chip badges; "All" always first. */
  const facets = ["All", ...Array.from(new Set(visibleDapps.map((d) => facetOf(d.category))))];
  const facetCount = (f: string) =>
    f === "All" ? visibleDapps.length : visibleDapps.filter((d) => facetOf(d.category) === f).length;

  const filteredDapps =
    categoryFilter === "All"
      ? visibleDapps
      : visibleDapps.filter((d) => facetOf(d.category) === categoryFilter);

  const statusVariant = (s: string): "success" | "warning" | "neutral" =>
    s === "Live" ? "success" : s === "Design" ? "warning" : "neutral";

  return (
    <div className="view-padded">
      {/* ─── Hero — purple accent ─── */}
      <div className="apc2-hero">
        <div className="apc2-hero-mesh" aria-hidden="true" />
        <div className="apc2-hero-icon">
          <Globe size={18} />
        </div>
        <div className="apc2-hero-body">
          <span className="apc2-hero-label">App Catalog</span>
          <strong className="apc2-hero-title">{visibleDapps.length} {visibleDapps.length === 1 ? "Protocol" : "Protocols"}</strong>
        </div>
        <div className="apc2-hero-stats">
          <div className="apc2-hero-stat">
            <strong className="apc2-stat-live">{visibleDapps.length}</strong>
            <span>{IS_PRODUCTION_BUILD ? "Available" : "Live"}</span>
          </div>
        </div>
      </div>

      {/* ─── Filter chips by facet ─── */}
      <div className="apc2-filters">
        {facets.map((f) => (
          <button
            key={f}
            className={`apc2-filter ${categoryFilter === f ? "active" : ""}`}
            type="button"
            onClick={() => setCategoryFilter(f)}
          >
            {f}
            <span className="apc2-filter-count">{facetCount(f)}</span>
          </button>
        ))}
      </div>

      {/* ─── Section header ─── */}
      <div className="apc2-section-header">
        <Sparkles size={12} />
        <span>Protocols</span>
        <span className="apc2-section-count">{filteredDapps.length}</span>
      </div>

      {/* ─── Card grid ─── */}
      {filteredDapps.length === 0 ? (
        <div className="apc2-empty">
          <div className="apc2-empty-icon"><Sparkles size={18} /></div>
          <strong>No live protocols in {categoryFilter}</strong>
          <span>Production only shows dApps that are actually available in this release.</span>
        </div>
      ) : (
        <div className="apc2-grid">
          {filteredDapps.map((dapp) => (
            <button
              className="apc2-card"
              key={dapp.id}
              onClick={() => setSelected(dapp.id)}
              type="button"
            >
              <div className="apc2-card-logo">
                <DappLogo name={dapp.name} size={44} />
              </div>
              <div className="apc2-card-body">
                <div className="apc2-card-top">
                  <strong className="apc2-card-name">{dapp.name}</strong>
                  <span className="apc2-card-category">{dapp.category}</span>
                </div>
                <p className="apc2-card-summary">{dapp.summary}</p>
                <div className="apc2-card-meta">
                  <span className="apc2-card-trust">
                    <ShieldCheck size={10} /> {dapp.trustLevel}
                  </span>
                  <span className={`apc2-card-status status-${statusVariant(dapp.status)}`}>
                    ● {dapp.status}
                  </span>
                </div>
              </div>
              <ChevronRight size={16} className="apc2-card-chevron" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
