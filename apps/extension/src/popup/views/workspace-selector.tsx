import { ArrowLeft, Building2 } from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import "../../styles/legacy/simple-pages.css";

export function WorkspaceSelectorView({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const workspace = state.activeWorkspace;

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      <div className="wks-hero">
        <div className="wks-hero-top">
          <div className="wks-hero-icon">
            <Building2 size={20} strokeWidth={2.3} />
          </div>
          <div className="wks-hero-info">
            <span className="wks-hero-label">WORKSPACE</span>
            <strong className="wks-hero-title">Identity</strong>
            <span className="wks-hero-sub">Active context for signing and policy</span>
          </div>
        </div>
      </div>

      <div className="wks-section-label">
        <span>ACTIVE</span>
        <span className="wks-section-hint">1 workspace</span>
      </div>

      <div className="wks-active">
        <div className="wks-active-icon">
          <Building2 size={22} strokeWidth={2.3} />
        </div>
        <div className="wks-active-body">
          <div className="wks-active-top">
            <strong className="wks-active-name">{workspace.name}</strong>
            <span className="wks-active-dot">Active</span>
          </div>
          <div className="wks-active-badges">
            <span className="wks-badge">{workspace.kind}</span>
            <span className="wks-badge is-role">{workspace.role}</span>
          </div>
          {workspace.summary && (
            <p className="wks-active-summary">{workspace.summary}</p>
          )}
        </div>
      </div>
    </div>
  );
}
