import { useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Code,
  Copy,
  ExternalLink,
  Globe,
  Heart,
  LifeBuoy,
  ScrollText,
  Server,
} from "lucide-react";
import { useNavigation } from "../router";
import { DappImage } from "../components/dapp-image";
import {
  COPYRIGHT_YEAR,
  formatRuntimeVersion,
  getRuntimeBuildProvenance,
} from "../constants/version";

const LINKS: Array<{ icon: typeof Globe; label: string; url: string; color: string }> = [
  { icon: Globe, label: "Website", url: "https://aethelred.org", color: "#0ea5e9" },
  { icon: BookOpen, label: "Documentation", url: "https://docs.aethelred.org", color: "#8b5cf6" },
  { icon: Code, label: "Source Code", url: "https://github.com/aethelred-foundation", color: "#6366f1" },
  { icon: LifeBuoy, label: "Support", url: "https://aethelred.org/support", color: "#14b8a6" },
  { icon: ScrollText, label: "Privacy Policy", url: "https://aethelred.org/privacy", color: "#64748b" },
  { icon: ScrollText, label: "Terms of Service", url: "https://aethelred.org/terms", color: "#64748b" },
];

const CREDITS: Array<{ name: string; kind: string; license: string }> = [
  { name: "React", kind: "UI framework", license: "MIT" },
  { name: "Vite", kind: "Build tool", license: "MIT" },
  { name: "TypeScript", kind: "Language", license: "Apache-2.0" },
  { name: "Lucide React", kind: "Icon library", license: "ISC" },
  { name: "viem", kind: "EVM client", license: "MIT" },
];

type CopyState = "idle" | "copied" | "failed";

export function DeploymentInfoView() {
  const { navigate } = useNavigation();
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const runtimeBuild = getRuntimeBuildProvenance();
  const displayVersion = formatRuntimeVersion(runtimeBuild);

  const copyVersion = async () => {
    setCopyState("idle");
    try {
      if (runtimeBuild.source !== "runtime-manifest") {
        throw new Error("Runtime manifest unavailable");
      }
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(`Aethelred Wallet ${displayVersion}`);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const provenanceMessage = copyState === "copied"
    ? "Version copied"
    : copyState === "failed"
      ? "Could not copy version"
      : runtimeBuild.source === "runtime-manifest"
        ? "Read from the installed extension manifest"
        : "Runtime manifest unavailable";

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      <div className="about-hero">
        <div className="about-hero-logo">
          <DappImage name="logo" width={72} height={72} alt="Aethelred" className="about-hero-logo-img" />
        </div>
        <strong className="about-hero-name">Aethelred Wallet</strong>
        <span className="about-hero-tagline">Built for trust, every transaction</span>

        <button
          className="about-version-pill"
          onClick={() => void copyVersion()}
          type="button"
          title="Copy installed version"
          aria-label="Copy installed wallet version"
        >
          {runtimeBuild.channel ? (
            <span className={`about-channel ${runtimeBuild.channel}`}>
              {runtimeBuild.channel.toUpperCase()}
            </span>
          ) : null}
          <span className="about-version-number">{displayVersion}</span>
          {copyState === "copied"
            ? <Check size={11} strokeWidth={3.2} />
            : <Copy size={11} strokeWidth={2.3} />}
        </button>

        <div className="about-hero-meta" role="status" aria-live="polite">
          <span>{provenanceMessage}</span>
        </div>
      </div>

      <div className="about-section-label">VERSION</div>
      <div className="about-kv-card">
        <div className="about-kv">
          <span>Installed version</span>
          <strong>{displayVersion}</strong>
        </div>
        <div className="about-kv">
          <span>Manifest version</span>
          <code>{runtimeBuild.version ?? "Unavailable"}</code>
        </div>
        <div className="about-kv">
          <span>Release name</span>
          <code>{runtimeBuild.versionName ?? "Unavailable"}</code>
        </div>
        <div className="about-kv">
          <span>Release channel</span>
          <strong>{runtimeBuild.channel?.toUpperCase() ?? "Unavailable"}</strong>
        </div>
        <div className="about-kv">
          <span>Build date</span>
          <strong>Unavailable</strong>
        </div>
        <div className="about-kv">
          <span>Commit</span>
          <code>Unavailable</code>
        </div>
      </div>

      <div className="about-section-label">
        <span>DEPLOYMENT</span>
      </div>
      <div className="dep-active-card">
        <div className="dep-active-top">
          <div className="dep-active-icon">
            <Server size={22} strokeWidth={2.3} />
          </div>
          <div className="dep-active-info">
            <span className="dep-active-kicker">DEPLOYMENT PROFILE</span>
            <strong>Unavailable</strong>
          </div>
          <div className="dep-active-badge">Not configured</div>
        </div>
        <p className="dep-active-desc">
          This wallet runtime does not expose an authoritative active deployment profile.
        </p>
      </div>

      <div className="about-section-label">
        <span>LINKS</span>
      </div>
      <div className="about-links">
        {LINKS.map((link) => {
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

      <div className="about-section-label">
        <span>OPEN SOURCE</span>
        <span className="about-section-hint">Acknowledgments</span>
      </div>
      <div className="about-credits">
        {CREDITS.map((credit) => (
          <div className="about-credit" key={credit.name}>
            <div className="about-credit-body">
              <strong>{credit.name}</strong>
              <span>{credit.kind}</span>
            </div>
            <div className="about-credit-license">{credit.license}</div>
          </div>
        ))}
      </div>

      <div className="about-legal">
        <Heart size={10} strokeWidth={2.6} />
        <span>© {COPYRIGHT_YEAR} Aethelred Foundation · All rights reserved</span>
      </div>
    </div>
  );
}
