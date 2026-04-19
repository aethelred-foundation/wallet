import { useMemo, useState } from "react";
import {
  Bot, Shield, Pause, Play, Settings, ChevronLeft, ChevronRight,
  Sparkles, DollarSign, ScanLine, Key, Globe, AlertTriangle, CheckCircle2,
  Activity, Timer, BarChart3, Check,
} from "lucide-react";
import { useComingSoon } from "../hooks/use-coming-soon";

/* ─── Types ────────────────────────────────────────────────────────── *
 * AgentCategory drives the icon + accent color assignment. Each category
 * maps to a function-specific lucide icon and an iOS Settings color
 * rather than the generic Bot with red/gray tint the old page used. */
type AgentCategory = "treasury" | "compliance" | "staking" | "settlement";
type AgentStatus = "active" | "suspended";

interface Agent {
  id: string;
  name: string;
  category: AgentCategory;
  type: string;
  status: AgentStatus;
  permissions: string[];
  rateLimit: number;       // max ops per hour
  opsThisHour: number;     // current hour utilization
  opsToday: number;
  threshold: string;
  totalOps: number;
  lastActive: string;
  anomalies: number;
}

/* Initial fixture data — in useState so suspend/resume updates immutably.
   The previous code mutated a module-level constant at assignment time,
   which did not trigger re-renders and silently leaked state between
   navigations. */
const INITIAL_AGENTS: Agent[] = [
  {
    id: "m1", name: "Treasury Rebalancer", category: "treasury",
    type: "Autonomous treasury management",
    status: "active",
    permissions: ["Transfer up to $50K", "Convert stablecoins", "Check balances"],
    rateLimit: 20, opsThisHour: 4, opsToday: 14, threshold: "$50,000",
    totalOps: 1847, lastActive: "3m ago", anomalies: 0,
  },
  {
    id: "m2", name: "Compliance Monitor", category: "compliance",
    type: "Read-only compliance scanning",
    status: "active",
    permissions: ["Screen transactions", "Generate reports", "Flag suspicious activity"],
    rateLimit: 100, opsThisHour: 23, opsToday: 67, threshold: "N/A (read-only)",
    totalOps: 12450, lastActive: "1m ago", anomalies: 0,
  },
  {
    id: "m3", name: "Cruzible Keeper", category: "staking",
    type: "Yield auto-compounding keeper",
    status: "active",
    permissions: ["Claim staking rewards", "Reinvest yields"],
    rateLimit: 5, opsThisHour: 1, opsToday: 2, threshold: "$100,000",
    totalOps: 340, lastActive: "2h ago", anomalies: 0,
  },
  {
    id: "m4", name: "Cross-Border Settler", category: "settlement",
    type: "International settlement orchestration",
    status: "suspended",
    permissions: ["Initiate settlements", "Generate Travel Rule data"],
    rateLimit: 10, opsThisHour: 0, opsToday: 0, threshold: "$25,000",
    totalOps: 89, lastActive: "3d ago", anomalies: 3,
  },
];

/* Category → icon + color. These mirror the iOS Settings-style tile
   convention used in the profile menu: semantic colors per function. */
const CATEGORY_META: Record<AgentCategory, { Icon: typeof Bot; color: string; label: string }> = {
  treasury:   { Icon: DollarSign, color: "#34c759", label: "Treasury" },
  compliance: { Icon: ScanLine,   color: "#2775ca", label: "Compliance" },
  staking:    { Icon: Key,        color: "#ff9f0a", label: "Staking" },
  settlement: { Icon: Globe,      color: "#8b5cf6", label: "Settlement" },
};

export function MachineDelegationView() {
  const comingSoon = useComingSoon();
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = agents.find(a => a.id === selectedId);

  /* Aggregate stats for the hero card — computed with useMemo so we
     only recalculate when the agents array actually changes. */
  const stats = useMemo(() => {
    const activeCount = agents.filter(a => a.status === "active").length;
    const opsToday = agents.reduce((sum, a) => sum + a.opsToday, 0);
    const anomalies = agents.reduce((sum, a) => sum + a.anomalies, 0);
    const totalOps = agents.reduce((sum, a) => sum + a.totalOps, 0);
    return { activeCount, opsToday, anomalies, totalOps };
  }, [agents]);

  /* Immutable status toggle — replaces the old `machine.status = ...`
     mutation that silently broke React reactivity. */
  const toggleStatus = (id: string) => {
    setAgents(prev => prev.map(a => a.id === id
      ? { ...a, status: a.status === "active" ? "suspended" : "active" }
      : a
    ));
    // Keep detail view open so the state swap is visible.
  };

  /* ─── Detail view ─── */
  if (selected) {
    const meta = CATEGORY_META[selected.category];
    const { Icon } = meta;
    const ratePercent = Math.min(100, Math.round((selected.opsThisHour / selected.rateLimit) * 100));
    const isActive = selected.status === "active";

    return (
      <div className="view-padded">
        <button
          className="agent-back"
          onClick={() => setSelectedId(null)}
          type="button"
        >
          <ChevronLeft size={14} /> <span>Agents</span>
        </button>

        {/* Agent identity hero */}
        <div className="agent-detail-hero" style={{
          background: `linear-gradient(135deg, ${meta.color}1a 0%, ${meta.color}05 100%)`,
          borderColor: `${meta.color}40`,
        }}>
          <div className="agent-detail-icon" style={{
            background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}d0 100%)`,
            boxShadow: `0 4px 14px ${meta.color}40`,
          }}>
            <Icon size={22} strokeWidth={2.3} />
          </div>
          <div className="agent-detail-info">
            <span className="agent-detail-category">{meta.label}</span>
            <strong className="agent-detail-name">{selected.name}</strong>
            <span className="agent-detail-type">{selected.type}</span>
          </div>
          <div className={`agent-status-pill ${isActive ? "active" : "suspended"}`}>
            <span className="agent-status-dot" />
            {isActive ? "Live" : "Paused"}
          </div>
        </div>

        {/* Anomaly alert — only when anomalies > 0 */}
        {selected.anomalies > 0 && (
          <div className="agent-anomaly-alert">
            <AlertTriangle size={15} />
            <div>
              <strong>{selected.anomalies} anomal{selected.anomalies === 1 ? "y" : "ies"} detected</strong>
              <span>Review before reactivating this agent</span>
            </div>
          </div>
        )}

        {/* Stats grid */}
        <div className="agent-stats-grid">
          <div className="agent-stat-tile">
            <Activity size={13} />
            <strong>{selected.opsToday}</strong>
            <span>Today</span>
          </div>
          <div className="agent-stat-tile">
            <BarChart3 size={13} />
            <strong>{selected.totalOps.toLocaleString()}</strong>
            <span>All-time</span>
          </div>
          <div className="agent-stat-tile">
            <Timer size={13} />
            <strong>{selected.lastActive}</strong>
            <span>Last run</span>
          </div>
        </div>

        {/* Rate limit visualization */}
        <div className="agent-rate-card">
          <div className="agent-rate-header">
            <div>
              <span className="agent-rate-label">Rate limit</span>
              <strong className="agent-rate-value">
                {selected.opsThisHour} / {selected.rateLimit}
                <span>ops this hour</span>
              </strong>
            </div>
            <div className={`agent-rate-percent ${ratePercent > 80 ? "hot" : ratePercent > 50 ? "warm" : "cool"}`}>
              {ratePercent}%
            </div>
          </div>
          <div className="agent-rate-track">
            <div
              className={`agent-rate-fill ${ratePercent > 80 ? "hot" : ratePercent > 50 ? "warm" : "cool"}`}
              style={{ width: `${ratePercent}%` }}
            />
          </div>
        </div>

        {/* Approval threshold */}
        <div className="agent-detail-row">
          <div className="agent-detail-row-icon" style={{ background: "#34c75920", color: "#34c759" }}>
            <Shield size={14} />
          </div>
          <div className="agent-detail-row-body">
            <span>Human approval required above</span>
            <strong>{selected.threshold}</strong>
          </div>
        </div>

        {/* Permissions */}
        <div className="agent-section-label">Permissions</div>
        <div className="agent-permissions">
          {selected.permissions.map((p, i) => (
            <div className="agent-permission-chip" key={i}>
              <div className="agent-permission-check">
                <Check size={11} strokeWidth={3} />
              </div>
              <span>{p}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="agent-actions">
          <button
            className={`agent-action-btn ${isActive ? "danger" : "primary"}`}
            onClick={() => toggleStatus(selected.id)}
            type="button"
          >
            {isActive ? <><Pause size={14} /> Suspend</> : <><Play size={14} /> Reactivate</>}
          </button>
          <button
            className="agent-action-btn secondary is-coming-soon"
            onClick={() => comingSoon(`Configure ${selected.name}`, "rate limits, thresholds & permissions UI ships in v0.9.1")}
            type="button"
          >
            <Settings size={14} /> Configure
          </button>
        </div>
      </div>
    );
  }

  /* ─── List view ─── */
  return (
    <div className="view-padded">
      {/* Overview hero — command-center summary of all agents */}
      <div className="agents-hero">
        <div className="agents-hero-header">
          <div className="agents-hero-icon">
            <Sparkles size={18} strokeWidth={2.3} />
          </div>
          <div className="agents-hero-title-block">
            <span className="agents-hero-label">AI AGENTS</span>
            <strong className="agents-hero-title">
              {stats.activeCount} <span>of {agents.length} live</span>
            </strong>
          </div>
          <div className={`agents-hero-pulse ${stats.activeCount > 0 ? "on" : "off"}`}>
            <span />
          </div>
        </div>
        <div className="agents-hero-stats">
          <div className="agents-hero-stat">
            <strong>{stats.opsToday}</strong>
            <span>Ops today</span>
          </div>
          <div className="agents-hero-divider" />
          <div className="agents-hero-stat">
            <strong>{stats.totalOps.toLocaleString()}</strong>
            <span>All-time</span>
          </div>
          <div className="agents-hero-divider" />
          <div className="agents-hero-stat">
            <strong style={{ color: stats.anomalies > 0 ? "var(--danger)" : "var(--success)" }}>
              {stats.anomalies}
            </strong>
            <span>Anomalies</span>
          </div>
        </div>
      </div>

      {/* Education banner — only on first-run / when all agents active */}
      <div className="agents-info-banner">
        <Bot size={14} />
        <span>Autonomous agents operate within rate limits and value thresholds. Operations above thresholds auto-escalate to human reviewers.</span>
      </div>

      {/* Agent list */}
      <div className="agents-list">
        {agents.map(agent => {
          const meta = CATEGORY_META[agent.category];
          const { Icon } = meta;
          const ratePercent = Math.min(100, Math.round((agent.opsThisHour / agent.rateLimit) * 100));
          const isActive = agent.status === "active";

          return (
            <button
              key={agent.id}
              className={`agent-card ${!isActive ? "suspended" : ""}`}
              onClick={() => setSelectedId(agent.id)}
              type="button"
            >
              <div className="agent-card-top">
                <div
                  className="agent-card-icon"
                  style={{
                    background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}c0 100%)`,
                    boxShadow: `0 2px 8px ${meta.color}40`,
                  }}
                >
                  <Icon size={15} strokeWidth={2.3} />
                </div>
                <div className="agent-card-info">
                  <strong>{agent.name}</strong>
                  <span className="agent-card-category">{meta.label}</span>
                </div>
                {agent.anomalies > 0 ? (
                  <div className="agent-card-anomaly">
                    <AlertTriangle size={11} />
                    {agent.anomalies}
                  </div>
                ) : (
                  <div className={`agent-card-status ${isActive ? "active" : "suspended"}`}>
                    {isActive ? <CheckCircle2 size={13} /> : <Pause size={11} />}
                  </div>
                )}
                <ChevronRight size={14} className="agent-card-arrow" />
              </div>

              {/* Rate bar — only meaningful when agent is active */}
              {isActive && (
                <div className="agent-card-rate">
                  <div className="agent-card-rate-header">
                    <span>{agent.opsThisHour} / {agent.rateLimit} ops/hr</span>
                    <span className="agent-card-rate-dot" />
                    <span>{agent.opsToday} today</span>
                    <span className="agent-card-rate-dot" />
                    <span>{agent.lastActive}</span>
                  </div>
                  <div className="agent-card-rate-track">
                    <div
                      className={`agent-card-rate-fill ${ratePercent > 80 ? "hot" : ratePercent > 50 ? "warm" : "cool"}`}
                      style={{ width: `${ratePercent}%` }}
                    />
                  </div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
