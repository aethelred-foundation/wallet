import { Shield, ShieldCheck, ArrowLeft, Check } from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import "../../styles/legacy/simple-pages.css";

export function PolicyView({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const mode = state.policy.mode;
  const highlights = state.policy.highlights ?? [];

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      {/* ═════ Hero ═════ */}
      <div className="pol-hero">
        <div className="pol-hero-top">
          <div className="pol-hero-icon">
            <Shield size={20} strokeWidth={2.3} />
          </div>
          <div className="pol-hero-info">
            <span className="pol-hero-label">POLICY</span>
            <strong className="pol-hero-title">Guardrails</strong>
            <span className="pol-hero-sub">
              Deterministic rules applied at signing time
            </span>
          </div>
        </div>
      </div>

      {/* ═════ Mode hero card ═════ */}
      <div className="pol-section-label">
        <span>ACTIVE MODE</span>
        <span className="pol-section-hint">
          {state.activeWorkspace.kind} defaults
        </span>
      </div>

      <div className="pol-mode">
        <div className="pol-mode-shield">
          <Shield size={28} strokeWidth={2.3} />
        </div>
        <div className="pol-mode-body">
          <span className="pol-mode-label">POLICY MODE</span>
          <span className="pol-mode-pill">{mode}</span>
          <p className="pol-mode-sub">
            Evaluated on every signing intent with a full audit trail.
          </p>
        </div>
      </div>

      {/* ═════ Highlights list ═════ */}
      <div className="pol-section-label">
        <span>HIGHLIGHTS</span>
        <span className="pol-section-hint">
          {highlights.length} {highlights.length === 1 ? "rule" : "rules"}
        </span>
      </div>

      <div className="pol-list">
        {highlights.map((highlight, i) => (
          <div className="pol-item" key={i}>
            <div className="pol-item-icon">
              <ShieldCheck size={16} strokeWidth={2.3} />
            </div>
            <span className="pol-item-text">{highlight}</span>
          </div>
        ))}

        {/* Compliance footer chips */}
        <div className="pol-footer">
          <span className="pol-chip">
            <Check size={11} strokeWidth={2.8} />
            Deterministic evaluation
          </span>
          <span className="pol-chip">
            <Check size={11} strokeWidth={2.8} />
            Elixir-ready schemas
          </span>
        </div>
      </div>
    </div>
  );
}
