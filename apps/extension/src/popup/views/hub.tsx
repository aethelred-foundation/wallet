import { useState } from "react";
import { LayoutGrid, Bell, ShieldCheck, CheckCircle2, Users, Globe } from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { EmptyState } from "../components/empty-state";

type SubTab = "dapps" | "policy";

export function HubView({ state }: { state: AethelredWalletState }) {
  const [tab, setTab] = useState<SubTab>("dapps");
  const { navigate } = useNavigation();

  return (
    <div className="view-padded">
      <div className="sub-tabs">
        <button className={`sub-tab ${tab === "dapps" ? "active" : ""}`} onClick={() => setTab("dapps")} type="button"><LayoutGrid size={14} /> dApps</button>
        <button className="sub-tab" onClick={() => navigate("approvals")} type="button">
          <Bell size={14} /> Approvals {state.pendingApprovals.length > 0 && <span className="sub-tab-badge">{state.pendingApprovals.length}</span>}
        </button>
        <button className={`sub-tab ${tab === "policy" ? "active" : ""}`} onClick={() => setTab("policy")} type="button"><ShieldCheck size={14} /> Policy</button>
      </div>

      {tab === "dapps" && (
        <EmptyState
          icon={<Globe size={28} />}
          title="Connect dApps from their websites"
          description="Open a dApp you trust and approve its connection request in this wallet. Review or revoke approved sessions under Connected Sites."
          tone="info"
          padding="lg"
          action={{
            label: "Review Connected Sites",
            onClick: () => navigate("connected-sites"),
            primary: true,
          }}
        />
      )}

      {tab === "policy" && (() => {
        const policyMode = state.policy.mode;
        const policyModeLabel = policyMode.replaceAll("-", " ");

        return (
          <div>
            {/* Workspace identity only. No invented compliance/strictness score. */}
            <div className="pol-hero">
              <div className="pol-hero-left">
                <span className="pol-hero-label">Workspace</span>
                <strong className="pol-hero-name">{state.activeWorkspace.name}</strong>
                <span className="pol-hero-kind">{state.activeWorkspace.kind} · {state.activeWorkspace.role}</span>
              </div>
            </div>

            {/* Policy Mode card */}
            <div className="pol-section-header">
              <ShieldCheck size={12} />
              <span>POLICY MODE</span>
            </div>
            <div className="pol-mode-card">
              <div className="pol-mode-header">
                <div className="pol-mode-icon">
                  <ShieldCheck size={20} />
                </div>
                <div className="pol-mode-info">
                  <strong style={{ textTransform: "capitalize" }}>{policyModeLabel}</strong>
                  <span>Configured policy mode</span>
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
