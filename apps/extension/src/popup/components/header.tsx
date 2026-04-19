import { useEffect, useState } from "react";
import { Sun, Moon, Bell, ChevronDown } from "lucide-react";
import { ProfileMenu } from "./profile-menu";
import { CHANNEL } from "../constants/version";
import { useNavigation } from "../router";
import { useComingSoon } from "../hooks/use-coming-soon";

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
  const [theme, setTheme] = useState<"light" | "dark">(readInitialTheme);

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
        <img src="/logo.png" alt="" className="hdr-logo-img" />
      </div>

      <button
        type="button"
        className="hdr-workspace"
        onClick={() => navigate("workspace-selector")}
        aria-label="Switch workspace"
      >
        <div className="hdr-workspace-row">
          <span className="hdr-workspace-name type-subtitle">{workspaceName}</span>
          <ChevronDown size={12} className="hdr-workspace-chevron" strokeWidth={2.5} />
        </div>
        <div className="hdr-workspace-meta">
          <span className="hdr-workspace-live">
            <span className="hdr-pulse-dot" aria-hidden="true" />
            <span className="type-micro">Live</span>
          </span>
          <span className={`env-badge env-badge-${CHANNEL}`}>{CHANNEL.toUpperCase()}</span>
        </div>
      </button>

      <div className="hdr-icon-group">
        <button
          type="button"
          className="hdr-icon-btn"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        >
          {theme === "dark" ? <Sun size={16} strokeWidth={2.2} /> : <Moon size={16} strokeWidth={2.2} />}
        </button>

        <button
          type="button"
          className="hdr-icon-btn"
          onClick={() => {
            if (hasNotifications) {
              navigate("approvals");
            } else {
              comingSoon("Notifications", "coming in v1.0");
            }
          }}
          aria-label={hasNotifications ? `${approvalCount} pending approvals` : "No notifications"}
        >
          <Bell size={16} strokeWidth={2.2} />
          {hasNotifications && <span className="hdr-notif-dot" aria-hidden="true" />}
        </button>

        <ProfileMenu subjectName={subjectName} workspaceName={workspaceName} />
      </div>
    </header>
  );
}
