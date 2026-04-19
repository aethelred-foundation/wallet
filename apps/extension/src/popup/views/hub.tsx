import { useState } from "react";
import { LayoutGrid, Bell, Vote, ShieldCheck, CheckCircle2, XCircle, Clock, Users, Sparkles, ArrowRight, Globe, Rocket } from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { DappLogo } from "../components/dapp-logo";
import { EmptyState } from "../components/empty-state";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

type SubTab = "dapps" | "approvals" | "governance" | "policy";

type ProposalStatus = "active" | "passed" | "rejected";
type ProposalCategory = "Treasury" | "Compliance" | "Protocol" | "Listing";

interface Proposal {
  id: string;
  title: string;
  category: ProposalCategory;
  description: string;
  status: ProposalStatus;
  votesFor: number;
  votesAgainst: number;
  endsIn: string;
  quorum: number; // percentage 0-100
  userVote?: "for" | "against" | null;
}

const INITIAL_PROPOSALS: Proposal[] = [
  {
    id: "g1",
    title: "Increase Cruzible vault cap to $100M",
    category: "Treasury",
    description: "Double the staking vault cap from $50M to $100M to accommodate institutional inflows.",
    status: "active",
    votesFor: 847,
    votesAgainst: 123,
    endsIn: "3d",
    quorum: 67,
    userVote: null,
  },
  {
    id: "g2",
    title: "Add PYUSD as approved settlement asset",
    category: "Listing",
    description: "Enable PayPal USD for cross-border settlements in NoblePay, subject to the standard compliance framework.",
    status: "active",
    votesFor: 1240,
    votesAgainst: 45,
    endsIn: "5d",
    quorum: 67,
    userVote: null,
  },
  {
    id: "g3",
    title: "Update FATF Travel Rule threshold to $3,000",
    category: "Compliance",
    description: "Align with the updated FATF guidance lowering the Travel Rule threshold from $1,000 to $3,000.",
    status: "passed",
    votesFor: 2100,
    votesAgainst: 89,
    endsIn: "Ended",
    quorum: 67,
    userVote: "for",
  },
];

type DappStatus = "Live" | "Planned" | "Design";

interface DappMeta {
  id: string;
  name: string;
  category: string;
  status: DappStatus;
  summary: string;
  metric: { label: string; value: string };
  accent: string;
  featured?: boolean;
}

const DAPPS: DappMeta[] = [
  {
    id: "cruzible",
    name: "Cruzible",
    category: "Liquid Staking",
    status: "Live",
    summary: "TEE-verified liquid staking vault earning 8.4% APY on AETHEL with 14-day unbonding.",
    metric: { label: "TVL", value: "$52.4M" },
    accent: "#c41e1e",
    featured: true,
  },
  {
    id: "shiora",
    name: "Shiora",
    category: "Health Data",
    status: "Design",
    summary: "End-to-end encrypted health records with consent-based sharing.",
    metric: { label: "Users", value: "6,840" },
    accent: "#8b5cf6",
  },
  {
    id: "zeroid",
    name: "ZeroID",
    category: "Identity",
    status: "Planned",
    summary: "Self-sovereign identity registry with 48-hour recovery timelock.",
    metric: { label: "IDs", value: "14,280" },
    accent: "#2775ca",
  },
  {
    id: "terraqura",
    name: "TerraQura",
    category: "Carbon Credits",
    status: "Design",
    summary: "M-of-N multi-sig governance for tokenized carbon credit verification.",
    metric: { label: "Signers", value: "5 of 7" },
    accent: "#34c759",
  },
  {
    id: "noblepay",
    name: "NoblePay",
    category: "Payments",
    status: "Design",
    summary: "Compliance-gated cross-border payments with real-time AML screening.",
    metric: { label: "24h Vol", value: "$8.1M" },
    accent: "#059669",
  },
];

export function HubView({ state }: { state: AethelredWalletState }) {
  const [tab, setTab] = useState<SubTab>("dapps");
  const [proposals, setProposals] = useState<Proposal[]>(INITIAL_PROPOSALS);
  const [proposalFilter, setProposalFilter] = useState<ProposalStatus | "All">("All");
  const { navigate } = useNavigation();
  const { send } = useBackground();
  const visibleDapps = IS_PRODUCTION_BUILD ? DAPPS.filter((d) => d.status === "Live") : DAPPS;

  const handleApprovalDecision = async (id: string, decision: "approved" | "rejected") => {
    await send("approval-response", { approvalId: id, decision, reviewerId: state.subject.id });
  };

  const handleVote = (proposalId: string, direction: "for" | "against") => {
    setProposals((prev) => prev.map((p) => {
      if (p.id !== proposalId || p.status !== "active" || p.userVote) return p;
      return {
        ...p,
        votesFor: direction === "for" ? p.votesFor + 1 : p.votesFor,
        votesAgainst: direction === "against" ? p.votesAgainst + 1 : p.votesAgainst,
        userVote: direction,
      };
    }));
  };

  return (
    <div className="view-padded">
      <div className="sub-tabs">
        <button className={`sub-tab ${tab === "dapps" ? "active" : ""}`} onClick={() => setTab("dapps")} type="button"><LayoutGrid size={14} /> dApps</button>
        <button className={`sub-tab ${tab === "approvals" ? "active" : ""}`} onClick={() => setTab("approvals")} type="button">
          <Bell size={14} /> Approvals {state.pendingApprovals.length > 0 && <span className="sub-tab-badge">{state.pendingApprovals.length}</span>}
        </button>
        <button className={`sub-tab ${tab === "governance" ? "active" : ""}`} onClick={() => setTab("governance")} type="button"><Vote size={14} /> Governance</button>
        <button className={`sub-tab ${tab === "policy" ? "active" : ""}`} onClick={() => setTab("policy")} type="button"><ShieldCheck size={14} /> Policy</button>
      </div>

      {tab === "dapps" && (() => {
        /* ─── Hub dApps — Apple Grade ─── */
        const live = visibleDapps.filter(d => d.status === "Live").length;
        const planned = visibleDapps.filter(d => d.status === "Planned").length;
        const design = visibleDapps.filter(d => d.status === "Design").length;
        const featured = visibleDapps.find(d => d.featured) ?? visibleDapps[0];
        const rest = visibleDapps.filter(d => !d.featured);

        const statusBadgeClass = (status: DappStatus) =>
          status === "Live" ? "cleared" : status === "Planned" ? "review" : "review";

        return (
          <div>
            {/* Hero — ecosystem summary */}
            <div className="hub-ecosystem-hero">
              <div className="hub-hero-icon">
                <Globe size={18} />
              </div>
              <div className="hub-hero-info">
                <span className="hub-hero-label">{IS_PRODUCTION_BUILD ? "Live Ecosystem" : "Aethelred Ecosystem"}</span>
                <strong className="hub-hero-title">{visibleDapps.length} {visibleDapps.length === 1 ? "Protocol" : "Protocols"}</strong>
              </div>
              <div className="hub-hero-stats">
                <div className="hub-hero-stat">
                  <strong className="hub-stat-live">{live}</strong>
                  <span>Live</span>
                </div>
                {!IS_PRODUCTION_BUILD && (
                  <>
                    <div className="hub-hero-stat">
                      <strong>{planned}</strong>
                      <span>Planned</span>
                    </div>
                    <div className="hub-hero-stat">
                      <strong>{design}</strong>
                      <span>Design</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Featured protocol — the live one */}
            {featured && (
              <div className="hub-featured-section">
                <div className="hub-section-header">
                  <Sparkles size={12} />
                  <span>FEATURED</span>
                </div>
                <div
                  className="hub-featured-card"
                  onClick={() => navigate("app-catalog")}
                  role="button"
                  tabIndex={0}
                  style={{ borderColor: `${featured.accent}40` }}
                >
                  <div className="hub-featured-mesh" aria-hidden="true" style={{ background: `radial-gradient(circle at 20% 0%, ${featured.accent}22 0%, transparent 60%)` }} />
                  <div className="hub-featured-top">
                    <div className="hub-featured-logo">
                      <DappLogo name={featured.name} size={44} />
                    </div>
                    <div className="hub-featured-info">
                      <strong>{featured.name}</strong>
                      <span>{featured.category}</span>
                    </div>
                    <span className={`compliance-badge ${statusBadgeClass(featured.status)}`}>● {featured.status}</span>
                  </div>
                  <p className="hub-featured-summary">{featured.summary}</p>
                  <div className="hub-featured-footer">
                    <div className="hub-featured-metric">
                      <span>{featured.metric.label}</span>
                      <strong style={{ color: featured.accent }}>{featured.metric.value}</strong>
                    </div>
                    <button
                      className="hub-featured-btn"
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigate("app-catalog"); }}
                      style={{ background: featured.accent }}
                    >
                      Open <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Rest — refreshed 2×2 grid. The section-count span was
             * removed because it read like a stray "4" floating next to
             * the heading text with no clear label. The count can be
             * inferred from the grid itself. */}
            {rest.length === 0 ? (
              <EmptyState
                icon={<Globe size={18} />}
                title="No additional live protocols yet"
                description="Production hides roadmap and design surfaces until they are actually shipped."
                tone="info"
                padding="md"
              />
            ) : (
              <>
                <div className="hub-section-header">
                  <Rocket size={12} />
                  <span>{IS_PRODUCTION_BUILD ? "MORE LIVE PROTOCOLS" : "MORE PROTOCOLS"}</span>
                </div>
                <div className="hub-grid">
                  {rest.map((d) => (
                    <div
                      className="hub-card hub-card-v2"
                      key={d.id}
                      onClick={() => navigate("app-catalog")}
                      role="button"
                      tabIndex={0}
                      style={{ borderColor: `${d.accent}22` }}
                    >
                      <div className="hub-card-accent" style={{ background: d.accent }} />
                      <div className="hub-card-top">
                        <DappLogo name={d.name} size={32} />
                        <span className={`compliance-badge ${statusBadgeClass(d.status)}`}>{d.status}</span>
                      </div>
                      <strong className="hub-card-name">{d.name}</strong>
                      <span className="hub-card-category">{d.category}</span>
                      <div className="hub-card-metric">
                        <span>{d.metric.label}</span>
                        <strong style={{ color: d.accent }}>{d.metric.value}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {tab === "approvals" && (() => {
        /* ─── Approvals — Apple Grade ─── */
        const pending = state.pendingApprovals;
        const count = pending.length;

        /* Extract amount from title/summary if present (e.g., "250000 AEL") */
        const extractAmount = (text: string): { amount: string; asset: string } | null => {
          const match = text.match(/(\d{1,3}(?:[,.]?\d{3})*)\s*(AEL|AETHEL|USDC|BUIDL|EUR|USD|PYUSD|WETH)/i);
          if (match) {
            return { amount: match[1].replace(/[,.]/g, ",").replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,"), asset: match[2].toUpperCase() };
          }
          return null;
        };

        /* Determine approval severity based on amount magnitude */
        const severityFromAmount = (amountStr?: string): "high" | "medium" | "low" => {
          if (!amountStr) return "low";
          const num = parseInt(amountStr.replace(/[,]/g, ""), 10);
          if (num >= 100000) return "high";
          if (num >= 10000) return "medium";
          return "low";
        };

        return (
          <div>
            {/* Hero — notification style */}
            <div className={`apv-hero ${count > 0 ? "has-pending" : "all-clear"}`}>
              <div className="apv-hero-icon">
                {count > 0 ? <Bell size={20} /> : <CheckCircle2 size={20} />}
                {count > 0 && <span className="apv-hero-pulse" />}
              </div>
              <div className="apv-hero-body">
                <strong>{count > 0 ? `${count} ${count === 1 ? "item needs" : "items need"} review` : "All clear"}</strong>
                <span>
                  {count > 0
                    ? "Multi-sig and policy-gated actions awaiting your decision"
                    : "No pending approvals at this time"}
                </span>
              </div>
            </div>

            {count === 0 ? (
              /* Polished empty state */
              <div className="apv-empty">
                <div className="apv-empty-icon">
                  <CheckCircle2 size={28} />
                </div>
                <strong>Inbox zero</strong>
                <p>You're all caught up. New approval requests will appear here when reviewers are needed for multi-sig or policy-gated operations.</p>
              </div>
            ) : (
              <div className="apv-list">
                {pending.map((a) => {
                  const extracted = extractAmount(a.title) || extractAmount(a.summary);
                  const severity = severityFromAmount(extracted?.amount);
                  const severityColor = severity === "high" ? "#ff3b30" : severity === "medium" ? "#ff9f0a" : "#2775ca";
                  const severityLabel = severity === "high" ? "High Value" : severity === "medium" ? "Medium Value" : "Low Value";

                  return (
                    <div className="apv-card" key={a.id}>
                      {/* Severity stripe */}
                      <div className="apv-card-stripe" style={{ background: severityColor }} />

                      {/* Header row */}
                      <div className="apv-card-top">
                        <div className="apv-card-icon" style={{ background: `${severityColor}18`, color: severityColor }}>
                          <Bell size={14} />
                        </div>
                        <div className="apv-card-title-wrap">
                          <strong className="apv-card-title">{a.title}</strong>
                          <span className="apv-card-app">{a.appName}</span>
                        </div>
                        <span className="apv-severity-badge" style={{ color: severityColor, background: `${severityColor}18` }}>
                          {severityLabel}
                        </span>
                      </div>

                      {/* Amount (if extracted) */}
                      {extracted && (
                        <div className="apv-amount-box">
                          <span className="apv-amount-label">Amount</span>
                          <div className="apv-amount-row">
                            <strong className="apv-amount-value">{extracted.amount}</strong>
                            <span className="apv-amount-asset">{extracted.asset}</span>
                          </div>
                        </div>
                      )}

                      {/* Summary */}
                      <p className="apv-card-summary">{a.summary}</p>

                      {/* Meta row */}
                      <div className="apv-meta-row">
                        <div className="apv-meta-item">
                          <Users size={10} />
                          <span>{a.requiredAction}</span>
                        </div>
                        <div className="apv-meta-item">
                          <Clock size={10} />
                          <span>Awaiting review</span>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="apv-actions">
                        <button
                          className="apv-btn apv-btn-approve"
                          onClick={() => handleApprovalDecision(a.id, "approved")}
                          type="button"
                        >
                          <CheckCircle2 size={14} /> Approve
                        </button>
                        <button
                          className="apv-btn apv-btn-reject"
                          onClick={() => handleApprovalDecision(a.id, "rejected")}
                          type="button"
                        >
                          <XCircle size={14} /> Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {tab === "governance" && (() => {
        /* ─── Governance — Apple Grade ─── */
        const activeCount = proposals.filter(p => p.status === "active").length;
        const passedCount = proposals.filter(p => p.status === "passed").length;
        const totalVotes = proposals.reduce((sum, p) => sum + p.votesFor + p.votesAgainst, 0);

        const filters: Array<ProposalStatus | "All"> = ["All", "active", "passed", "rejected"];
        const filtered = proposalFilter === "All"
          ? proposals
          : proposals.filter((p) => p.status === proposalFilter);

        const categoryColor = (c: ProposalCategory): string =>
          c === "Treasury" ? "#c41e1e"
          : c === "Compliance" ? "#ff9f0a"
          : c === "Protocol" ? "#8b5cf6"
          : "#2775ca"; /* Listing */

        return (
          <div>
            {/* Hero summary */}
            <div className="gov-hero">
              <div className="gov-hero-icon">
                <Vote size={18} />
              </div>
              <div className="gov-hero-info">
                <span className="gov-hero-label">DAO Governance</span>
                <strong className="gov-hero-title">{activeCount} active, {passedCount} passed</strong>
              </div>
              <div className="gov-hero-metric">
                <strong>{totalVotes.toLocaleString()}</strong>
                <span>votes cast</span>
              </div>
            </div>

            {/* Filter chips */}
            <div className="gov-filters">
              {filters.map((f) => (
                <button
                  key={f}
                  className={`gov-filter ${proposalFilter === f ? "active" : ""}`}
                  type="button"
                  onClick={() => setProposalFilter(f)}
                >
                  {f === "All" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <div className="rsrch-empty">
                <Vote size={22} />
                <strong>No {proposalFilter !== "All" ? proposalFilter : ""} proposals</strong>
                <span>Check back soon for new governance items</span>
              </div>
            ) : (
              <div className="gov-list">
                {filtered.map((p) => {
                  const totalP = p.votesFor + p.votesAgainst;
                  const forPct = totalP > 0 ? (p.votesFor / totalP) * 100 : 0;
                  const againstPct = totalP > 0 ? (p.votesAgainst / totalP) * 100 : 0;
                  const isActive = p.status === "active";
                  const isPassed = p.status === "passed";
                  const isRejected = p.status === "rejected";
                  const catColor = categoryColor(p.category);
                  const voted = !!p.userVote;

                  return (
                    <div className={`gov-card gov-card-${p.status}`} key={p.id}>
                      {/* Top row */}
                      <div className="gov-card-top">
                        <span className="gov-category-chip" style={{ color: catColor, background: `${catColor}18` }}>
                          {p.category.toUpperCase()}
                        </span>
                        <span className={`gov-status-chip gov-status-${p.status}`}>
                          {isPassed && <CheckCircle2 size={10} />}
                          {isRejected && <XCircle size={10} />}
                          {isActive && <Clock size={10} />}
                          {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                        </span>
                      </div>

                      {/* Title & description */}
                      <strong className="gov-card-title">{p.title}</strong>
                      <p className="gov-card-desc">{p.description}</p>

                      {/* Vote percentages */}
                      <div className="gov-vote-header">
                        <div className="gov-vote-side">
                          <span className="gov-vote-label gov-vote-for">For</span>
                          <strong className="gov-vote-pct">{forPct.toFixed(0)}%</strong>
                        </div>
                        <div className="gov-vote-side gov-vote-side-right">
                          <strong className="gov-vote-pct gov-vote-against-text">{againstPct.toFixed(0)}%</strong>
                          <span className="gov-vote-label gov-vote-against">Against</span>
                        </div>
                      </div>

                      {/* Progress bar with quorum marker */}
                      <div className="gov-bar">
                        <div className="gov-bar-for" style={{ width: `${forPct}%` }} />
                        <div className="gov-bar-against" style={{ width: `${againstPct}%` }} />
                        <div className="gov-bar-quorum" style={{ left: `${p.quorum}%` }} title={`Quorum: ${p.quorum}%`}>
                          <span className="gov-quorum-label">Q</span>
                        </div>
                      </div>

                      {/* Vote counts + meta */}
                      <div className="gov-meta">
                        <span className="gov-meta-count">
                          <span className="gov-dot-for" /> {p.votesFor.toLocaleString()} for
                        </span>
                        <span className="gov-meta-count">
                          <span className="gov-dot-against" /> {p.votesAgainst.toLocaleString()} against
                        </span>
                        <span className="gov-meta-time">
                          <Clock size={10} /> {p.endsIn === "Ended" ? "Ended" : `Ends in ${p.endsIn}`}
                        </span>
                      </div>

                      {/* Action buttons — only for active, not yet voted */}
                      {isActive && !voted && (
                        <div className="gov-actions">
                          <button
                            className="gov-btn gov-btn-for"
                            onClick={() => handleVote(p.id, "for")}
                            type="button"
                          >
                            <CheckCircle2 size={14} /> Vote For
                          </button>
                          <button
                            className="gov-btn gov-btn-against"
                            onClick={() => handleVote(p.id, "against")}
                            type="button"
                          >
                            <XCircle size={14} /> Vote Against
                          </button>
                        </div>
                      )}
                      {voted && (
                        <div className="gov-voted">
                          <CheckCircle2 size={13} />
                          <span>You voted <strong>{p.userVote === "for" ? "For" : "Against"}</strong></span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {tab === "policy" && (() => {
        /* ─── Policy — Apple Grade ─── */
        const policyMode = state.policy.mode;

        /* Strictness score (0-100) based on policy mode */
        const modeInfo: Record<string, { label: string; strictness: number; color: string; description: string }> = {
          "guided": {
            label: "Guided",
            strictness: 25,
            color: "#2775ca",
            description: "Automated decisions with human guidance on risky actions.",
          },
          "approval-required": {
            label: "Approval Required",
            strictness: 60,
            color: "#ff9f0a",
            description: "Most actions require at least one reviewer before execution.",
          },
          "dual-control": {
            label: "Dual Control",
            strictness: 85,
            color: "#c41e1e",
            description: "Two reviewers must approve every sensitive operation.",
          },
          "committee": {
            label: "Committee",
            strictness: 100,
            color: "#8b5cf6",
            description: "Multi-sig committee governs all treasury and compliance actions.",
          },
        };
        const info = modeInfo[policyMode] ?? modeInfo["approval-required"];

        /* SVG gauge math */
        const gaugeR = 34;
        const gaugeC = 2 * Math.PI * gaugeR;
        const gaugeFill = (info.strictness / 100) * gaugeC;

        return (
          <div>
            {/* Hero — workspace identity + compliance score */}
            <div className="pol-hero">
              <div className="pol-hero-left">
                <span className="pol-hero-label">Workspace</span>
                <strong className="pol-hero-name">{state.activeWorkspace.name}</strong>
                <span className="pol-hero-kind">{state.activeWorkspace.kind} · {state.activeWorkspace.role}</span>
              </div>
              <div className="pol-gauge-wrap">
                <svg width={84} height={84} viewBox="0 0 84 84">
                  <circle cx={42} cy={42} r={gaugeR} fill="none" stroke="var(--line)" strokeWidth={5} />
                  <circle
                    cx={42} cy={42} r={gaugeR}
                    fill="none"
                    stroke={info.color}
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeDasharray={`${gaugeFill} ${gaugeC}`}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dasharray 600ms ease" }}
                  />
                </svg>
                <div className="pol-gauge-center">
                  <strong style={{ color: info.color }}>{info.strictness}</strong>
                  <span>STRICT</span>
                </div>
              </div>
            </div>

            {/* Policy Mode card */}
            <div className="pol-section-header">
              <ShieldCheck size={12} />
              <span>POLICY MODE</span>
            </div>
            <div className="pol-mode-card" style={{ borderColor: `${info.color}40` }}>
              <div className="pol-mode-mesh" aria-hidden="true" style={{ background: `radial-gradient(circle at 0% 0%, ${info.color}14 0%, transparent 60%)` }} />
              <div className="pol-mode-header">
                <div className="pol-mode-icon" style={{ background: `${info.color}18`, color: info.color }}>
                  <ShieldCheck size={20} />
                </div>
                <div className="pol-mode-info">
                  <strong>{info.label}</strong>
                  <span>{info.description}</span>
                </div>
              </div>
            </div>

            {/* Active Rules */}
            <div className="pol-section-header">
              <CheckCircle2 size={12} />
              <span>ACTIVE RULES</span>
              <span className="pol-count">{state.policy.highlights.length}</span>
            </div>
            <div className="pol-rules">
              {state.policy.highlights.map((h, i) => (
                <div className="pol-rule-card" key={i}>
                  <div className="pol-rule-icon">
                    <CheckCircle2 size={13} />
                  </div>
                  <span>{h}</span>
                </div>
              ))}
            </div>

            {/* Access details */}
            <div className="pol-section-header">
              <Users size={12} />
              <span>YOUR ACCESS</span>
            </div>
            <div className="pol-access-grid">
              <div className="pol-access-item">
                <span className="pol-access-label">Role</span>
                <strong>{state.activeWorkspace.role}</strong>
              </div>
              <div className="pol-access-item">
                <span className="pol-access-label">Workspace Type</span>
                <strong>{state.activeWorkspace.kind}</strong>
              </div>
              <div className="pol-access-item">
                <span className="pol-access-label">Active Sessions</span>
                <div className="pol-sessions">
                  <span className="pol-session-pulse" />
                  <strong>{state.sessions.length}</strong>
                </div>
              </div>
              <div className="pol-access-item">
                <span className="pol-access-label">Status</span>
                <strong className="pol-status-active">
                  <CheckCircle2 size={11} /> Active
                </strong>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
