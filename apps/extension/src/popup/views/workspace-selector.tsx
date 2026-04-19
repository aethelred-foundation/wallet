import { Building2, ArrowLeft, Users, Crown, Lock } from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";
import "../../styles/legacy/simple-pages.css";

/* ─── Locked upgrade card fixtures ────────────────────────────────── *
 * In alpha only a single (personal) workspace exists. Two more are
 * planned for Phase 2 — render them grayed out so the user can see
 * the roadmap. */

interface LockedTier {
  id: "enterprise" | "sovereign";
  name: string;
  desc: string;
  icon: typeof Users;
}

const LOCKED_TIERS: readonly LockedTier[] = [
  {
    id: "enterprise",
    name: "Enterprise Workspace",
    desc: "Multi-user treasury with role-based controls and approval flows.",
    icon: Users,
  },
  {
    id: "sovereign",
    name: "Sovereign Workspace",
    desc: "On-chain governance, delegated signing, and institutional custody.",
    icon: Crown,
  },
];

export function WorkspaceSelectorView({ state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const ws = state.activeWorkspace;
  const upgradeTiers = IS_PRODUCTION_BUILD ? [] : LOCKED_TIERS;

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      {/* ═════ Hero ═════ */}
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

      {/* ═════ Active workspace card ═════ */}
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
            <strong className="wks-active-name">{ws.name}</strong>
            <span className="wks-active-dot">Active</span>
          </div>
          <div className="wks-active-badges">
            <span className="wks-badge">{ws.kind}</span>
            <span className="wks-badge is-role">{ws.role}</span>
          </div>
          {ws.summary && (
            <p className="wks-active-summary">{ws.summary}</p>
          )}
        </div>
      </div>

      {upgradeTiers.length > 0 && (
        <>
          {/* ═════ Upgrade / phase-2 tiers ═════ */}
          <div className="wks-section-label">
            <span>UPGRADE TO</span>
          </div>

          <div className="wks-locked-list">
            {upgradeTiers.map((tier) => {
              const Icon = tier.icon;
              return (
                <div className="wks-locked" key={tier.id}>
                  <div className="wks-locked-icon">
                    <Icon size={18} strokeWidth={2.3} />
                  </div>
                  <div className="wks-locked-body">
                    <div className="wks-locked-top">
                      <strong className="wks-locked-name">{tier.name}</strong>
                      <span className="wks-locked-pill">
                        <Lock size={9} strokeWidth={2.8} />
                        Phase 2
                      </span>
                    </div>
                    <p className="wks-locked-desc">{tier.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
