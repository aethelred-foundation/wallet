import { useMemo, useState } from "react";
import {
  Server, Shield, Cloud, WifiOff, ArrowLeft,
  CheckCircle2, Users, Layers, Lock, Zap, FileCheck,
  Building2, Hexagon, Sparkles, Copy, Check, ExternalLink,
  Globe, BookOpen, LifeBuoy, ScrollText, Code, Heart,
} from "lucide-react";
import { ALL_PROFILES, type DeploymentTier } from "@aethelred/wallet-deployment";
import { useNavigation } from "../router";
import { DappImage } from "../components/dapp-image";
import {
  DISPLAY_VERSION, SEMVER, BUILD_NUMBER, CODENAME, CHANNEL,
  BUILD_DATE, PACKAGE_COUNT, GIT_SHA, COPYRIGHT_YEAR,
} from "../constants/version";

/* ─── Tier → icon + color map ──────────────────────────────────────── */
const TIER_META: Record<DeploymentTier, { icon: typeof Cloud; color: string; label: string }> = {
  "shared-cloud":     { icon: Cloud,    color: "#0ea5e9", label: "Shared Cloud"     },
  "dedicated-tenant": { icon: Server,   color: "#8b5cf6", label: "Dedicated Tenant" },
  "sovereign-cloud":  { icon: Shield,   color: "#6366f1", label: "Sovereign Cloud"  },
  "self-hosted":      { icon: Building2,color: "#14b8a6", label: "Self-Hosted"      },
  "air-gapped":       { icon: WifiOff,  color: "#475569", label: "Air-Gapped"       },
};

const FEATURE_ICONS: Record<string, { icon: typeof Shield; label: string }> = {
  dualControl:       { icon: Users,        label: "Dual Control"       },
  committeeApproval: { icon: Users,        label: "Committee Approval" },
  offlineSigning:    { icon: WifiOff,      label: "Offline Signing"    },
  hsmIntegration:    { icon: Lock,         label: "HSM Integration"    },
  mpcCustody:        { icon: Layers,       label: "MPC Custody"        },
  auditExport:       { icon: FileCheck,    label: "Audit Export"       },
  evidencePackaging: { icon: FileCheck,    label: "Evidence Pkg"       },
  customPolicies:    { icon: Shield,       label: "Custom Policies"    },
  adminConsole:      { icon: Zap,          label: "Admin Console"      },
  multiWorkspace:    { icon: Layers,       label: "Multi-Workspace"    },
  approvalWorkflows: { icon: CheckCircle2, label: "Approval Flows"     },
  realTimeOps:       { icon: Zap,          label: "Real-Time Ops"      },
  spendLimits:       { icon: Shield,       label: "Spend Limits"       },
  serviceIdentities: { icon: Hexagon,      label: "Service IDs"        },
  agentIdentities:   { icon: Hexagon,      label: "Agent IDs"          },
};

/* What's new — Apple-grade milestone release notes. Each entry
   represents a recent change in reverse chronological order. */
const WHATS_NEW: Array<{ icon: typeof Sparkles; title: string; description: string; color: string }> = [
  { icon: Sparkles, color: "#c41e1e",
    title: "Apple Grade design overhaul",
    description: "Every surface redesigned to iOS Settings / Apple Wallet quality. New heroes, filter chips, iOS toggles, and 12 upgraded pages." },
  { icon: Zap, color: "#ff9f0a",
    title: "Developer Tools",
    description: "Power-user mode with 7 diagnostic sections: live state inspector, command shell, audit stream, storage editor, feature flags, perf monitor." },
  { icon: Shield, color: "#34c759",
    title: "Dedicated ID Verification",
    description: "Verification journey page with tier ladder, step checklist, document cards, and upgrade path to Institutional." },
  { icon: Heart, color: "#ec4899",
    title: "Premium splash animation",
    description: "Cold-start reveal with logo fade-in and holofoil shine — mimics the Apple boot animation scaled to a wallet popup." },
];

/* External links */
const LINKS: Array<{ icon: typeof Globe; label: string; url: string; color: string }> = [
  { icon: Globe,      label: "Website",         url: "https://aethelred.org",                     color: "#0ea5e9" },
  { icon: BookOpen,   label: "Documentation",   url: "https://docs.aethelred.org",                color: "#8b5cf6" },
  { icon: Code,     label: "Source Code",     url: "https://github.com/aethelred-foundation",   color: "#6366f1" },
  { icon: LifeBuoy,   label: "Support",         url: "https://aethelred.org/support",             color: "#14b8a6" },
  { icon: ScrollText, label: "Privacy Policy",  url: "https://aethelred.org/privacy",             color: "#64748b" },
  { icon: ScrollText, label: "Terms of Service",url: "https://aethelred.org/terms",               color: "#64748b" },
];

/* Open source acknowledgments */
const CREDITS: Array<{ name: string; kind: string; license: string }> = [
  { name: "React",        kind: "UI framework",  license: "MIT" },
  { name: "Vite",         kind: "Build tool",    license: "MIT" },
  { name: "TypeScript",   kind: "Language",      license: "Apache-2.0" },
  { name: "Lucide React", kind: "Icon library",  license: "ISC" },
  { name: "viem",         kind: "EVM client",    license: "MIT" },
];

export function DeploymentInfoView() {
  const { navigate } = useNavigation();
  const [copiedVersion, setCopiedVersion] = useState(false);

  const activeProfile = useMemo(() => ALL_PROFILES[0], []);
  const otherProfiles = useMemo(() => ALL_PROFILES.slice(1), []);
  const activeMeta = TIER_META[activeProfile.tier];
  const ActiveIcon = activeMeta.icon;

  const enabledFeatureCount = useMemo(
    () => Object.values(activeProfile.features).filter(v => v === true).length,
    [activeProfile],
  );

  const copyVersion = () => {
    navigator.clipboard.writeText(`Aethelred Wallet ${SEMVER} (Build ${BUILD_NUMBER})`);
    setCopiedVersion(true);
    setTimeout(() => setCopiedVersion(false), 1800);
  };

  const channelBadgeClass =
    CHANNEL === "beta" ? "beta" :
    CHANNEL === "alpha" ? "alpha" :
    CHANNEL === "rc" ? "rc" : "stable";

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      {/* ═════ App identity hero — the "business card" ═════ */}
      <div className="about-hero">
        {/* Real Aethelred logo — same /logo.png used by the header
            component and the popup.html splash screen. Single source
            of truth for brand imagery across the entire app. */}
        <div className="about-hero-logo">
          <DappImage name="logo" width={72} height={72} alt="Aethelred" className="about-hero-logo-img" />
        </div>
        <strong className="about-hero-name">Aethelred Wallet</strong>
        <span className="about-hero-tagline">Built for trust, every transaction</span>

        <button className="about-version-pill" onClick={copyVersion} type="button" title="Copy version">
          <span className={`about-channel ${channelBadgeClass}`}>{CHANNEL.toUpperCase()}</span>
          <span className="about-version-number">{DISPLAY_VERSION}</span>
          <span className="about-build-number">(#{BUILD_NUMBER})</span>
          {copiedVersion
            ? <Check size={11} strokeWidth={3.2} />
            : <Copy size={11} strokeWidth={2.3} />}
        </button>

        <div className="about-hero-meta">
          <span>Built {BUILD_DATE}</span>
        </div>
      </div>

      {/* ═════ Version details (iOS-style KV list) ═════ */}
      <div className="about-section-label">VERSION</div>
      <div className="about-kv-card">
        <div className="about-kv">
          <span>Version</span>
          <strong>{DISPLAY_VERSION}</strong>
        </div>
        <div className="about-kv">
          <span>SemVer</span>
          <code>{SEMVER}</code>
        </div>
        <div className="about-kv">
          <span>Build number</span>
          <strong>#{BUILD_NUMBER}</strong>
        </div>
        <div className="about-kv">
          <span>Build date</span>
          <strong>{BUILD_DATE}</strong>
        </div>
        <div className="about-kv">
          <span>Commit</span>
          <code>{GIT_SHA}</code>
        </div>
        <div className="about-kv">
          <span>Channel</span>
          <span className={`about-channel inline ${channelBadgeClass}`}>{CHANNEL.toUpperCase()}</span>
        </div>
        <div className="about-kv">
          <span>Packages</span>
          <strong>{PACKAGE_COUNT}</strong>
        </div>
      </div>

      {/* ═════ What's new ═════ */}
      <div className="about-section-label">
        <span>WHAT'S NEW</span>
        <span className="about-section-hint">{CODENAME}</span>
      </div>
      <div className="about-whats-new">
        {WHATS_NEW.map((item, i) => {
          const Icon = item.icon;
          return (
            <div className="about-note" key={i}>
              <div
                className="about-note-icon"
                style={{
                  background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}c0 100%)`,
                  boxShadow: `0 3px 10px ${item.color}40`,
                }}
              >
                <Icon size={13} strokeWidth={2.3} />
              </div>
              <div className="about-note-body">
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ═════ Deployment tier (condensed from previous version) ═════ */}
      <div className="about-section-label">
        <span>DEPLOYMENT</span>
      </div>
      <div
        className="dep-active-card"
        style={{
          background: `linear-gradient(135deg, ${activeMeta.color}20 0%, ${activeMeta.color}05 100%)`,
          borderColor: `${activeMeta.color}40`,
        }}
      >
        <div className="dep-active-top">
          <div
            className="dep-active-icon"
            style={{
              background: `linear-gradient(135deg, ${activeMeta.color} 0%, ${activeMeta.color}c0 100%)`,
              boxShadow: `0 6px 18px ${activeMeta.color}50`,
            }}
          >
            <ActiveIcon size={22} strokeWidth={2.3} />
          </div>
          <div className="dep-active-info">
            <span className="dep-active-kicker">TIER {ALL_PROFILES.indexOf(activeProfile) + 1}</span>
            <strong>{activeProfile.name}</strong>
          </div>
          <div className="dep-active-badge">
            <div className="dep-active-badge-dot" />
            Active
          </div>
        </div>
        <p className="dep-active-desc">{activeProfile.description}</p>
        <div className="dep-active-props">
          <div className="dep-active-prop">
            <span>Catalog</span>
            <strong>{activeProfile.catalogMode}</strong>
          </div>
          <div className="dep-active-prop">
            <span>Custody</span>
            <strong>{activeProfile.defaultCustody}</strong>
          </div>
          <div className="dep-active-prop">
            <span>Audit</span>
            <strong>{activeProfile.compliance.auditRetentionDays}d</strong>
          </div>
        </div>
        <div className="dep-section-mini">ENABLED FEATURES · {enabledFeatureCount}</div>
        <div className="dep-feature-grid">
          {Object.entries(activeProfile.features)
            .filter(([, enabled]) => enabled === true)
            .map(([key]) => {
              const meta = FEATURE_ICONS[key];
              if (!meta) return null;
              const Icon = meta.icon;
              return (
                <div className="dep-feature-chip" key={key}>
                  <Icon size={9} strokeWidth={2.6} />
                  <span>{meta.label}</span>
                </div>
              );
            })}
        </div>
      </div>

      {/* Upgrade path (compact) */}
      <div className="about-tier-compact">
        {otherProfiles.map(profile => {
          const meta = TIER_META[profile.tier];
          const Icon = meta.icon;
          const tierIndex = ALL_PROFILES.indexOf(profile) + 1;
          return (
            <div className="about-tier-row" key={profile.id}>
              <div className="about-tier-index">T{tierIndex}</div>
              <div
                className="about-tier-icon"
                style={{
                  background: `linear-gradient(135deg, ${meta.color} 0%, ${meta.color}c0 100%)`,
                }}
              >
                <Icon size={11} strokeWidth={2.3} />
              </div>
              <strong>{profile.name}</strong>
              <span>{meta.label}</span>
            </div>
          );
        })}
      </div>

      {/* ═════ External links ═════ */}
      <div className="about-section-label">
        <span>LINKS</span>
      </div>
      <div className="about-links">
        {LINKS.map(link => {
          const Icon = link.icon;
          return (
            <a
              className="about-link"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              key={link.label}
            >
              <div
                className="about-link-icon"
                style={{
                  background: `linear-gradient(135deg, ${link.color} 0%, ${link.color}c0 100%)`,
                }}
              >
                <Icon size={13} strokeWidth={2.3} />
              </div>
              <span>{link.label}</span>
              <ExternalLink size={11} className="about-link-arrow" />
            </a>
          );
        })}
      </div>

      {/* ═════ Credits / Acknowledgments ═════ */}
      <div className="about-section-label">
        <span>OPEN SOURCE</span>
        <span className="about-section-hint">{CREDITS.length} projects</span>
      </div>
      <div className="about-credits">
        {CREDITS.map(c => (
          <div className="about-credit" key={c.name}>
            <div className="about-credit-body">
              <strong>{c.name}</strong>
              <span>{c.kind}</span>
            </div>
            <div className="about-credit-license">{c.license}</div>
          </div>
        ))}
      </div>

      {/* ═════ Legal footer ═════ */}
      <div className="about-legal">
        <Heart size={10} strokeWidth={2.6} />
        <span>
          © {COPYRIGHT_YEAR} Aethelred Foundation · All rights reserved
        </span>
      </div>
    </div>
  );
}
