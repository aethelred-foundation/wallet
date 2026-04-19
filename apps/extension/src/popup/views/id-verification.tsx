import { useMemo } from "react";
import {
  BadgeCheck, Check, Mail, Smartphone, FileText, ScanFace,
  Home, Briefcase, Wallet, ShieldAlert, Sparkles, ArrowRight,
  Building2, Clock,
} from "lucide-react";

/* ─── Data ─────────────────────────────────────────────────────────── *
 * Verification journey fixture. Each verification step has a completion
 * timestamp and icon. Documents list their type, issuing authority, and
 * a masked identifier. Tiers define a three-step ladder the user
 * progresses through: Basic → Enhanced (current) → Institutional. */

type TierName = "Basic" | "Enhanced" | "Institutional";

interface VerificationStep {
  id: string;
  title: string;
  detail: string;
  completedAt: string;
  icon: typeof Check;
  color: string;
}

interface VerificationDoc {
  id: string;
  title: string;
  type: string;
  detail: string;
  icon: typeof FileText;
  color: string;
  expiresAt?: string;
}

interface TierInfo {
  name: TierName;
  level: number;
  unlocks: string;
}

const TIER_LADDER: TierInfo[] = [
  { name: "Basic",         level: 1, unlocks: "Up to $10K / tx" },
  { name: "Enhanced",      level: 2, unlocks: "Up to $500K / tx" },
  { name: "Institutional", level: 3, unlocks: "Unlimited + priority" },
];

const CURRENT_TIER: TierName = "Enhanced";

const VERIFICATION_STEPS: VerificationStep[] = [
  { id: "s1", title: "Email verified",       detail: "ops@aethelred.org confirmed via magic link", completedAt: "Mar 28, 2026", icon: Mail,         color: "#0ea5e9" },
  { id: "s2", title: "Phone verified",       detail: "SMS OTP confirmed for +971 ** ***",         completedAt: "Mar 28, 2026", icon: Smartphone,   color: "#0ea5e9" },
  { id: "s3", title: "Government ID",        detail: "Passport uploaded and NFC-read",            completedAt: "Mar 30, 2026", icon: FileText,     color: "#8b5cf6" },
  { id: "s4", title: "Biometric liveness",   detail: "Face match · 98.4% confidence",             completedAt: "Mar 30, 2026", icon: ScanFace,     color: "#8b5cf6" },
  { id: "s5", title: "Proof of address",     detail: "Utility bill · ADGM registered office",     completedAt: "Mar 31, 2026", icon: Home,         color: "#14b8a6" },
  { id: "s6", title: "Enhanced due diligence", detail: "Wealth source questionnaire reviewed",     completedAt: "Apr 1, 2026",  icon: Briefcase,    color: "#f59e0b" },
  { id: "s7", title: "Source of funds",      detail: "Bank statements verified via Open Banking",  completedAt: "Apr 1, 2026",  icon: Wallet,       color: "#f59e0b" },
  { id: "s8", title: "Sanctions screening",  detail: "OFAC · EU · UN screens cleared",            completedAt: "Apr 1, 2026",  icon: ShieldAlert,  color: "#34c759" },
];

const DOCUMENTS: VerificationDoc[] = [
  { id: "d1", title: "UAE Passport",           type: "Government ID",      detail: "AE · ****4821",          icon: FileText,  color: "#8b5cf6", expiresAt: "Mar 2030" },
  { id: "d2", title: "Proof of Address",       type: "Utility Bill",       detail: "ADGM · issued Feb 2026", icon: Home,      color: "#14b8a6" },
  { id: "d3", title: "Corporate Formation",    type: "Incorporation Docs", detail: "Aethelred Operations LLC", icon: Building2, color: "#2775ca" },
  { id: "d4", title: "Biometric Liveness",     type: "Facial Scan",        detail: "98.4% match confidence", icon: ScanFace,  color: "#ff9f0a" },
];

export function IdVerificationView() {
  const currentTierIndex = TIER_LADDER.findIndex(t => t.name === CURRENT_TIER);
  const nextTier = TIER_LADDER[currentTierIndex + 1] ?? null;
  const progressPct = ((currentTierIndex + 1) / TIER_LADDER.length) * 100;

  const completedCount = VERIFICATION_STEPS.length;
  const lastCompletedAt = useMemo(() => {
    return VERIFICATION_STEPS[VERIFICATION_STEPS.length - 1]?.completedAt ?? "—";
  }, []);

  return (
    <div className="view-padded">
      {/* ═════ Hero — verification status ═════ */}
      <div className="idv-hero">
        <div className="idv-hero-top">
          <div className="idv-hero-icon">
            <BadgeCheck size={22} strokeWidth={2.3} />
          </div>
          <div className="idv-hero-info">
            <span className="idv-hero-label">VERIFICATION STATUS</span>
            <strong className="idv-hero-status">Fully Verified</strong>
            <span className="idv-hero-sub">
              {CURRENT_TIER} KYC · Updated {lastCompletedAt}
            </span>
          </div>
          <div className="idv-hero-check">
            <Check size={18} strokeWidth={3.2} />
          </div>
        </div>

        {/* Tier ladder — Basic → Enhanced → Institutional */}
        <div className="idv-tier-ladder">
          <div className="idv-tier-track">
            <div className="idv-tier-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="idv-tier-steps">
            {TIER_LADDER.map((tier, i) => {
              const isComplete = i <= currentTierIndex;
              const isCurrent = i === currentTierIndex;
              return (
                <div
                  key={tier.name}
                  className={`idv-tier-step ${isComplete ? "done" : ""} ${isCurrent ? "current" : ""}`}
                >
                  <div className="idv-tier-dot">
                    {isComplete ? <Check size={11} strokeWidth={3.2} /> : tier.level}
                  </div>
                  <span className="idv-tier-name">{tier.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═════ Verification checklist ═════ */}
      <div className="idv-section-label">
        <span>VERIFICATION STEPS</span>
        <span className="idv-section-hint">{completedCount} of {completedCount} complete</span>
      </div>

      <div className="idv-checklist">
        {VERIFICATION_STEPS.map((step, i) => {
          const Icon = step.icon;
          const isLast = i === VERIFICATION_STEPS.length - 1;
          return (
            <div className="idv-step" key={step.id}>
              <div className="idv-step-rail">
                <div
                  className="idv-step-icon"
                  style={{
                    background: `linear-gradient(135deg, ${step.color} 0%, ${step.color}c0 100%)`,
                    boxShadow: `0 3px 10px ${step.color}40`,
                  }}
                >
                  <Icon size={13} strokeWidth={2.3} />
                </div>
                {!isLast && <div className="idv-step-line" />}
              </div>
              <div className="idv-step-card">
                <div className="idv-step-header">
                  <strong>{step.title}</strong>
                  <div className="idv-step-check">
                    <Check size={11} strokeWidth={3.2} />
                  </div>
                </div>
                <p className="idv-step-detail">{step.detail}</p>
                <span className="idv-step-time">
                  <Clock size={9} strokeWidth={2.6} />
                  {step.completedAt}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═════ Submitted documents ═════ */}
      <div className="idv-section-label">
        <span>SUBMITTED DOCUMENTS</span>
        <span className="idv-section-hint">{DOCUMENTS.length} verified</span>
      </div>

      <div className="idv-docs">
        {DOCUMENTS.map(doc => {
          const Icon = doc.icon;
          return (
            <div className="idv-doc" key={doc.id}>
              <div
                className="idv-doc-icon"
                style={{
                  background: `linear-gradient(135deg, ${doc.color} 0%, ${doc.color}c0 100%)`,
                  boxShadow: `0 3px 10px ${doc.color}40`,
                }}
              >
                <Icon size={14} strokeWidth={2.3} />
              </div>
              <div className="idv-doc-body">
                <strong>{doc.title}</strong>
                <span className="idv-doc-type">{doc.type}</span>
                <span className="idv-doc-detail">{doc.detail}</span>
              </div>
              <div className="idv-doc-right">
                <div className="idv-doc-badge">
                  <Check size={9} strokeWidth={3.2} />
                  Verified
                </div>
                {doc.expiresAt && (
                  <span className="idv-doc-expires">Expires {doc.expiresAt}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═════ Next tier upgrade card ═════ */}
      {nextTier && (
        <>
          <div className="idv-section-label">
            <span>NEXT LEVEL</span>
          </div>

          <div className="idv-upgrade">
            <div className="idv-upgrade-header">
              <div className="idv-upgrade-icon">
                <Sparkles size={16} strokeWidth={2.3} />
              </div>
              <div className="idv-upgrade-info">
                <span className="idv-upgrade-kicker">UPGRADE TO</span>
                <strong>{nextTier.name}</strong>
              </div>
            </div>

            <p className="idv-upgrade-desc">
              Unlock {nextTier.unlocks.toLowerCase()}, priority compliance review,
              and access to institutional-only dApps.
            </p>

            <div className="idv-upgrade-perks">
              <div className="idv-upgrade-perk">
                <div className="idv-upgrade-perk-dot" />
                <span>Unlimited transaction limits</span>
              </div>
              <div className="idv-upgrade-perk">
                <div className="idv-upgrade-perk-dot" />
                <span>Dedicated compliance officer</span>
              </div>
              <div className="idv-upgrade-perk">
                <div className="idv-upgrade-perk-dot" />
                <span>Access to private deal flow</span>
              </div>
            </div>

            <button className="idv-upgrade-btn" type="button">
              Start upgrade
              <ArrowRight size={13} strokeWidth={2.6} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
