import { useState } from "react";
import {
  CheckCircle2,
  Layers3,
  ShieldCheck,
  Sparkles,
  Building2,
  ScrollText,
  Users,
  Server,
  Key,
  Globe,
  Shield,
  Settings,
  Clock,
} from "lucide-react";
import { ALL_PROFILES } from "@aethelred/wallet-deployment";
import { ALL_TEMPLATES } from "@aethelred/wallet-approval";
import {
  personalPolicyBundle,
  enterprisePolicyBundle,
  sovereignPolicyBundle,
} from "@aethelred/wallet-policy";

type AdminView = "dashboard" | "workspaces" | "policies" | "approvals" | "deployment" | "audit" | "identities";

const tabs: Array<{ id: AdminView; label: string; icon: typeof Settings }> = [
  { id: "dashboard", label: "Dashboard", icon: Sparkles },
  { id: "workspaces", label: "Workspaces", icon: Building2 },
  { id: "policies", label: "Policies", icon: ShieldCheck },
  { id: "approvals", label: "Approvals", icon: ScrollText },
  { id: "deployment", label: "Deployment", icon: Server },
  { id: "identities", label: "Identities", icon: Users },
  { id: "audit", label: "Audit", icon: Clock },
];

export default function App() {
  const [activeView, setActiveView] = useState<AdminView>("dashboard");

  return (
    <main className="workspace-page">
      <nav className="admin-nav">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`admin-nav-tab${activeView === id ? " active" : ""}`}
            onClick={() => setActiveView(id)}
            type="button"
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      {activeView === "dashboard" && <DashboardView />}
      {activeView === "workspaces" && <WorkspacesView />}
      {activeView === "policies" && <PoliciesView />}
      {activeView === "approvals" && <ApprovalsView />}
      {activeView === "deployment" && <DeploymentView />}
      {activeView === "identities" && <IdentitiesView />}
      {activeView === "audit" && <AuditView />}
    </main>
  );
}

function DashboardView() {
  const workstreams = [
    { title: "Trust kernel", summary: "BIP-39 HD keys, PBKDF2+AES-GCM encryption, secp256k1 signing with policy gate.", status: "Active" },
    { title: "Policy engine", summary: "Deterministic rule evaluation with personal, enterprise, and sovereign templates.", status: "Active" },
    { title: "Audit pipeline", summary: "SHA-256 hash-chained tamper-evident events with integrity verification.", status: "Active" },
    { title: "Simulation service", summary: "Transaction preview, message analysis, address reputation, phishing detection.", status: "Active" },
    { title: "Approval workflows", summary: "Quorum types: any-one, majority, unanimous, threshold, sequential.", status: "Active" },
    { title: "Deployment manager", summary: "5 tiers: shared cloud → dedicated → sovereign → self-hosted → air-gapped.", status: "Active" },
  ];

  return (
    <>
      <section className="hero-card">
        <span className="eyebrow"><Sparkles size={14} /> Admin console</span>
        <h1>Aethelred Wallet</h1>
        <p>Trust platform with wallet interfaces. All phases built: personal, enterprise, and sovereign operations from one core.</p>
        <div className="hero-grid">
          <div className="hero-stat">
            <span>Architecture</span>
            <strong>8 packages, 3 modes</strong>
          </div>
          <div className="hero-stat">
            <span>Deployment tiers</span>
            <strong>5 tiers available</strong>
          </div>
        </div>
      </section>

      <section className="grid-3">
        {workstreams.map((item) => (
          <div className="panel" key={item.title}>
            <div className="panel-header">
              <h2>{item.title}</h2>
              <span className="status success"><CheckCircle2 size={14} />{item.status}</span>
            </div>
            <p className="muted">{item.summary}</p>
          </div>
        ))}
      </section>
    </>
  );
}

function WorkspacesView() {
  const workspaceTypes = [
    { kind: "personal", name: "Personal", summary: "Individual consumers, investors, ecosystem participants. Guided policy with warn-level controls.", icon: Key },
    { kind: "enterprise", name: "Enterprise", summary: "Treasury teams, compliance officers, regulated business units. Approval-required with reviewer routing.", icon: Building2 },
    { kind: "sovereign", name: "Sovereign", summary: "Ministries, agencies, critical infrastructure operators. Dual-control with committee approval.", icon: Shield },
  ];

  return (
    <>
      <section className="hero-card">
        <span className="eyebrow"><Building2 size={14} /> Workspace management</span>
        <h1>Workspace modes</h1>
        <p>One product core with different assurance modes. Workspace kind determines default policy, approval templates, and feature availability.</p>
      </section>

      <div className="grid-3">
        {workspaceTypes.map(({ kind, name, summary, icon: Icon }) => (
          <div className="panel" key={kind}>
            <div className="panel-header">
              <h2><Icon size={18} style={{ marginRight: 8 }} />{name}</h2>
            </div>
            <p className="muted">{summary}</p>
            <div style={{ marginTop: 12 }}>
              <span className="chip">{kind}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PoliciesView() {
  const bundles = [personalPolicyBundle, enterprisePolicyBundle, sovereignPolicyBundle];

  return (
    <>
      <section className="hero-card">
        <span className="eyebrow"><ShieldCheck size={14} /> Policy engine</span>
        <h1>Policy bundles</h1>
        <p>Deterministic rule evaluation. Same inputs always produce same outputs. Elixir-ready schemas for Phase 2+ admin control-plane.</p>
      </section>

      {bundles.map((bundle) => (
        <div className="panel" key={bundle.id}>
          <div className="panel-header">
            <h2>{bundle.name}</h2>
            <span className="pill"><Layers3 size={14} />{bundle.mode}</span>
          </div>
          <ul className="checklist">
            {bundle.rules.map((rule) => (
              <li key={rule.id}>
                <ShieldCheck size={16} />
                <div>
                  <strong>{rule.name}</strong>
                  <p className="muted" style={{ margin: "4px 0 0" }}>{rule.message}</p>
                  <span className={`chip ${rule.outcome === "deny" ? "chip-warning" : ""}`} style={{ marginTop: 4 }}>{rule.outcome}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function ApprovalsView() {
  return (
    <>
      <section className="hero-card">
        <span className="eyebrow"><ScrollText size={14} /> Approval workflows</span>
        <h1>Approval templates</h1>
        <p>Quorum-based approval with escalation. Templates define reviewer requirements, timeout handling, and quorum type.</p>
      </section>

      <div className="grid-3">
        {ALL_TEMPLATES.map((template) => (
          <div className="panel" key={template.id}>
            <div className="panel-header">
              <h2>{template.name}</h2>
            </div>
            <p className="muted">{template.description}</p>
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span className="chip">{template.quorum.type}</span>
              <span className="chip">{template.workspaceKind}</span>
              <span className="chip">{template.expiryMinutes}m expiry</span>
              {template.escalation && <span className="chip">Escalation: {template.escalation.trigger}</span>}
              {template.quorum.threshold && <span className="chip">{template.quorum.threshold}-of-N</span>}
            </div>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {template.reviewerRoles.map((role) => (
                <span className="chip" key={role}>{role}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function DeploymentView() {
  return (
    <>
      <section className="hero-card">
        <span className="eyebrow"><Server size={14} /> Deployment tiers</span>
        <h1>Multi-tier deployment</h1>
        <p>Same architecture adapts to cloud, dedicated, sovereign, self-hosted, and air-gapped environments.</p>
      </section>

      {ALL_PROFILES.map((profile) => (
        <div className="panel" key={profile.id}>
          <div className="panel-header">
            <h2>{profile.name}</h2>
            <span className="pill">{profile.tier}</span>
          </div>
          <p className="muted">{profile.description}</p>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span className="chip">Custody: {profile.defaultCustody}</span>
            <span className="chip">Catalog: {profile.catalogMode}</span>
            <span className="chip">Audit: {profile.compliance.auditRetentionDays}d</span>
            {profile.compliance.regulatoryFramework && <span className="chip">{profile.compliance.regulatoryFramework}</span>}
            {profile.features.dualControl && <span className="chip">Dual control</span>}
            {profile.features.committeeApproval && <span className="chip">Committee</span>}
            {profile.features.offlineSigning && <span className="chip">Offline signing</span>}
            {profile.features.hsmIntegration && <span className="chip">HSM</span>}
            {profile.features.serviceIdentities && <span className="chip">Service identities</span>}
            {profile.features.agentIdentities && <span className="chip">Agent identities</span>}
          </div>
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {profile.custodyOptions.map((opt) => (
              <span className="chip" key={opt}>{opt}</span>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function IdentitiesView() {
  return (
    <>
      <section className="hero-card">
        <span className="eyebrow"><Users size={14} /> Service &amp; agent identities</span>
        <h1>Identity management</h1>
        <p>Phase 3 feature: non-human identities for automated operations. Service identities represent API consumers, agent identities represent autonomous actors.</p>
      </section>

      <div className="two-up">
        <div className="panel">
          <div className="panel-header"><h2>Service identities</h2></div>
          <p className="muted">API consumers with workspace-scoped permissions. Each service identity has its own credential and audit trail.</p>
          <ul className="checklist">
            <li><Users size={16} /><span>Workspace-scoped permissions</span></li>
            <li><Key size={16} /><span>API key authentication</span></li>
            <li><Clock size={16} /><span>Activity tracking and expiry</span></li>
            <li><Shield size={16} /><span>Suspend/revoke lifecycle</span></li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>Agent identities</h2></div>
          <p className="muted">Autonomous actors with rate limits and human-approval gates. Agents are children of service identities.</p>
          <ul className="checklist">
            <li><Users size={16} /><span>Parent service binding</span></li>
            <li><ShieldCheck size={16} /><span>Capability restrictions</span></li>
            <li><Clock size={16} /><span>Rate limiting (ops/hour)</span></li>
            <li><ScrollText size={16} /><span>Optional human-in-the-loop</span></li>
          </ul>
        </div>
      </div>
    </>
  );
}

function AuditView() {
  return (
    <>
      <section className="hero-card">
        <span className="eyebrow"><Clock size={14} /> Audit &amp; evidence</span>
        <h1>Evidence pipeline</h1>
        <p>Tamper-evident SHA-256 hash chain. Every operation is recorded with cryptographic proof of ordering and integrity.</p>
      </section>

      <div className="two-up">
        <div className="panel">
          <div className="panel-header"><h2>Event types</h2></div>
          <ul className="checklist">
            {["request-received", "policy-evaluated", "approval-requested", "approval-decided",
              "signing-executed", "response-sent", "session-created", "session-revoked",
              "workspace-switched", "account-created", "key-generated", "lock-state-changed",
              "wallet-initialized", "export-requested"].map((kind) => (
              <li key={kind}><CheckCircle2 size={14} /><span style={{ fontFamily: "monospace", fontSize: 12 }}>{kind}</span></li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <div className="panel-header"><h2>Evidence features</h2></div>
          <ul className="checklist">
            <li><Shield size={16} /><span>SHA-256 hash chain linking each event to its predecessor</span></li>
            <li><ScrollText size={16} /><span>Evidence records grouping related events (request→policy→approval→sign)</span></li>
            <li><Key size={16} /><span>Export packages with integrity hash verification</span></li>
            <li><Globe size={16} /><span>Elixir-ready schemas for Phase 2+ event ingestion</span></li>
            <li><Clock size={16} /><span>10,000 event retention with FIFO eviction</span></li>
            <li><Server size={16} /><span>Compliance-tier retention: 90d (cloud) to 10yr (air-gapped)</span></li>
          </ul>
        </div>
      </div>
    </>
  );
}
