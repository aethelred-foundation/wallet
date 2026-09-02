import { useEffect, useState } from "react";
import { Sun, Moon, Bell, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProfileMenu } from "./profile-menu";
import { DappImage } from "./dapp-image";
import { getRuntimeBuildProvenance } from "../constants/version";
import { useNavigation } from "../router";
import { useComingSoon } from "../hooks/use-coming-soon";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

interface HeaderProps {
  workspaceName: string;
  subjectName: string;
  approvalCount?: number;
}

const THEME_STORAGE_KEY = "aethelred-theme";

/**
 * Resolve the initial theme from localStorage, falling back to whatever
 * the document already has set (usually populated by index.html before
 * React mounts so we don't flash the wrong theme). Private-mode browsers
 * can throw on localStorage access, so everything is wrapped.
 */
function readInitialTheme(): "light" | "dark" {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable — fall through
  }
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "light" || attr === "dark") return attr;
  }
  return "dark";
}

/**
 * Premium header — gradient logo tile on the left, workspace display with
 * a live-pulse indicator in the center, and a trio of icon buttons on the
 * right (theme toggle, notifications, profile). Built entirely from design
 * tokens so it adapts cleanly to both themes.
 *
 * The release-channel badge is preserved but moved underneath the workspace
 * name as a small chip so it no longer competes with the icon group.
 */
export function Header({ workspaceName, subjectName, approvalCount = 0 }: HeaderProps) {
  const { navigate } = useNavigation();
  const comingSoon = useComingSoon();
  const { t } = useTranslation();
  const [theme, setTheme] = useState<"light" | "dark">(readInitialTheme);
  const runtimeChannel = getRuntimeBuildProvenance().channel;

  /* Keep the documentElement + localStorage in sync. We do this in an
     effect (instead of inline in the click handler) so that an external
     change — e.g. developer-tools toggling the theme — stays consistent
     if we ever wire it up that way. */
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // private-mode browsers — persistence is best-effort
    }
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const hasNotifications = approvalCount > 0;

  return (
    <header className="wallet-header">
      {/* Logo — rendered without a background tile so the icon stands
          on its own against the glass header. The `.hdr-logo-mark`
          wrapper is kept for consistent sizing + the soft glow. */}
      <div className="hdr-logo-mark" aria-hidden="true">
        <DappImage name="logo" width={28} height={28} alt="" eager className="hdr-logo-img" />
      </div>

      <button
        type="button"
        className="hdr-workspace"
        onClick={() => navigate("workspace-selector")}
        aria-label={t("header.switchWorkspace")}
      >
        <div className="hdr-workspace-row">
          <span className="hdr-workspace-name type-subtitle">{workspaceName}</span>
          <ChevronDown size={12} className="hdr-workspace-chevron" strokeWidth={2.5} />
        </div>
        <div className="hdr-workspace-meta">
          {runtimeChannel ? (
            <span className={`env-badge env-badge-${runtimeChannel}`}>
              {runtimeChannel.toUpperCase()}
            </span>
          ) : null}
        </div>
      </button>

      <div className="hdr-icon-group">
        <button
          type="button"
          className="hdr-icon-btn"
          onClick={toggleTheme}
          aria-label={t(theme === "dark" ? "header.themeSwitchLight" : "header.themeSwitchDark")}
        >
          {theme === "dark" ? <Sun size={16} strokeWidth={2.2} /> : <Moon size={16} strokeWidth={2.2} />}
        </button>

        {hasNotifications ? (
          <button
            type="button"
            className="hdr-icon-btn"
            onClick={() => navigate("approvals")}
            aria-label={t("header.notificationsPending", { count: approvalCount })}
          >
            <Bell size={16} strokeWidth={2.2} />
            <span className="hdr-notif-dot" aria-hidden="true" />
          </button>
        ) : !IS_PRODUCTION_BUILD ? (
          <button
            type="button"
            className="hdr-icon-btn"
            onClick={() => comingSoon("Notifications", "coming in v1.0")}
            aria-label={t("header.notificationsEmpty")}
          >
            <Bell size={16} strokeWidth={2.2} />
          </button>
        ) : null}

        <ProfileMenu subjectName={subjectName} workspaceName={workspaceName} />
      </div>
    </header>
  );
}
