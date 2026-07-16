import { useState, useEffect } from "react";
import {
  User, Moon, Sun, Globe, DollarSign, Languages, Bell, Wifi,
  Code, TestTube, FileText, Database, Server, HardDrive,
  ChevronRight, Info, Check, Settings as SettingsIcon,
  ChevronDown, Terminal, Vibrate, Volume2, Zap, LifeBuoy,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { useFormat } from "../i18n/format";
import { DISPLAY_VERSION, SHORT_VERSION, PACKAGE_COUNT } from "../constants/version";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";
import { isHapticsEnabled, setHapticsEnabled } from "../hooks/use-haptics";
import { isSoundEnabled, setSoundEnabled } from "../hooks/use-sound";
import { errorCaptureEnabled, setErrorCaptureEnabled, SUPPORT_URL } from "../lib/error-log";
import i18n from "../i18n/i18n";

/* ─── Currency / Language fixture data ─────────────────────────────── */
/* Supported display currencies. The code is passed verbatim to
   Intl.NumberFormat via the FormatProvider, so any valid ISO-4217 code
   will work — new rows just need to be added here. */
const CURRENCIES = [
  { code: "USD", name: "US Dollar",      symbol: "$"  },
  { code: "EUR", name: "Euro",           symbol: "€"  },
  { code: "GBP", name: "Pound Sterling", symbol: "£"  },
  { code: "JPY", name: "Japanese Yen",   symbol: "¥"  },
  { code: "CHF", name: "Swiss Franc",    symbol: "Fr." },
  { code: "CNY", name: "Chinese Yuan",   symbol: "¥"  },
  { code: "INR", name: "Indian Rupee",   symbol: "₹"  },
];

const LANGUAGES = [
  { code: "en", name: "English"   },
  { code: "ar", name: "العربية"  },
  { code: "zh", name: "中文"      },
  { code: "es", name: "Español"   },
  { code: "fr", name: "Français"  },
  { code: "de", name: "Deutsch"   },
  { code: "ja", name: "日本語"    },
];

/* ─── Settings defaults ─────────────────────────────────────
 * The "Reset settings" action wipes these localStorage keys so the
 * app returns to first-run behaviour. Keep this list in sync with
 * every `localStorage.setItem("aethelred-…")` call in the codebase
 * — a forgotten entry means a user's reset leaves stale preferences. */
const SETTINGS_STORAGE_KEYS = [
  "aethelred-theme",
  "aethelred-language",
  "aethelred-currency",
  "aethelred-reduced-motion",
  "aethelred-haptics",
  "aethelred-sound",
  "aethelred-dev-mode",
  "aethelred-notif-approvals",
  "aethelred-notif-alerts",
  "aethelred-notif-settlements",
  "aethelred-ui-version",
];

/* Cache keys cleared by the "Clear cache" action. Well-known entries
 * are enumerated; anything else under the `aethelred-cache-` prefix
 * is wiped by the prefix-sweep in `handleClearCache`. */
const CACHE_STORAGE_KEYS = [
  "aethelred-cache-balances",
  "aethelred-cache-prices",
  "aethelred-cache-dapps",
];

export function SettingsView({ state: _state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const { send } = useBackground();
  const { t } = useTranslation();
  /* Currency is owned by the FormatProvider so every view that reads
     `useFormat().formatCurrency(...)` reacts to the same single source
     of truth. The picker below updates it via setCurrency, which also
     persists to localStorage. */
  const { currency, setCurrency } = useFormat();

  /* Read current theme from the DOM on mount. This stays in sync with the
     theme initialization in main.tsx, which runs before React mounts. */
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-theme") === "dark",
  );

  /* Keep local state in sync if the attribute changes externally
     (e.g., when navigating back from another view that also toggled it). */
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      setDark(prev => (prev === isDark ? prev : isDark));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  const [showAdvanced, setShowAdvanced] = useState(false);
  /* Developer mode persists across popup opens so power users don't
     have to re-enable it every time. Stored in localStorage. */
  const [devMode, setDevMode] = useState(() => {
    try { return localStorage.getItem("aethelred-dev-mode") === "1"; }
    catch { return false; }
  });
  const toggleDevMode = () => {
    const next = !devMode;
    setDevMode(next);
    try { localStorage.setItem("aethelred-dev-mode", next ? "1" : "0"); }
    catch { /* private mode */ }
  };
  const [testnets, setTestnets] = useState(true);
  const [stageLogs, setStageLogs] = useState(false);
  const [showCurrency, setShowCurrency] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);
  /* Language picker is wired to i18next — on change we call
   * `i18n.changeLanguage(code)` AND persist to `aethelred-language` so
   * the choice survives reloads. The local `language` state mirrors the
   * i18n current language so the picker displays the right row. */
  const [languageCode, setLanguageCode] = useState(() => {
    try {
      return localStorage.getItem("aethelred-language") ?? "en";
    } catch {
      return "en";
    }
  });
  const [showNotifications, setShowNotifications] = useState(false);

  /* Notification preferences persist to localStorage so closing and
     reopening the popup preserves the user's choices. The default is
     "all on" (truthy fallback) which matches what Apple Settings does
     for notification categories the user hasn't explicitly touched. */
  const [notifApprovals, setNotifApprovalsState] = useState(
    () => { try { return localStorage.getItem("aethelred-notif-approvals") !== "0"; } catch { return true; } }
  );
  const [notifAlerts, setNotifAlertsState] = useState(
    () => { try { return localStorage.getItem("aethelred-notif-alerts") !== "0"; } catch { return true; } }
  );
  const [notifSettlements, setNotifSettlementsState] = useState(
    () => { try { return localStorage.getItem("aethelred-notif-settlements") !== "0"; } catch { return true; } }
  );
  const setNotifApprovals = (v: boolean) => {
    setNotifApprovalsState(v);
    try { localStorage.setItem("aethelred-notif-approvals", v ? "1" : "0"); } catch { /* noop */ }
  };
  const setNotifAlerts = (v: boolean) => {
    setNotifAlertsState(v);
    try { localStorage.setItem("aethelred-notif-alerts", v ? "1" : "0"); } catch { /* noop */ }
  };
  const setNotifSettlements = (v: boolean) => {
    setNotifSettlementsState(v);
    try { localStorage.setItem("aethelred-notif-settlements", v ? "1" : "0"); } catch { /* noop */ }
  };
  /* ─── Interaction preferences ──────────────────────────────────────
   * Haptic, sound, and reduced-motion toggles. Each persists to
   * chrome.storage.local via their hook's setter; we seed local state
   * from the synchronous read so the toggle renders in the right spot
   * on first paint. */
  const [hapticsEnabledState, setHapticsEnabledLocal] = useState(() => isHapticsEnabled());
  const [soundEnabledState, setSoundEnabledLocal] = useState(() => isSoundEnabled());
  const [reducedMotionState, setReducedMotionState] = useState(() => {
    try {
      return localStorage.getItem("aethelred-reduced-motion") === "1";
    } catch {
      return false;
    }
  });
  const toggleHaptics = () => {
    const next = !hapticsEnabledState;
    setHapticsEnabledLocal(next);
    setHapticsEnabled(next);
  };
  const toggleSound = () => {
    const next = !soundEnabledState;
    setSoundEnabledLocal(next);
    setSoundEnabled(next);
  };
  const [crashCaptureState, setCrashCaptureState] = useState(() => errorCaptureEnabled());
  const toggleCrashCapture = () => {
    const next = !crashCaptureState;
    setCrashCaptureState(next);
    setErrorCaptureEnabled(next);
  };
  const openSupport = () => {
    try {
      window.open(SUPPORT_URL, "_blank", "noopener,noreferrer");
    } catch {
      /* popup context may block window.open — no-op */
    }
  };
  const toggleReducedMotion = () => {
    const next = !reducedMotionState;
    setReducedMotionState(next);
    try {
      localStorage.setItem("aethelred-reduced-motion", next ? "1" : "0");
    } catch {
      // private mode
    }
    // Apply to the document so CSS respects the override immediately.
    if (next) {
      document.documentElement.setAttribute("data-reduced-motion", "1");
    } else {
      document.documentElement.removeAttribute("data-reduced-motion");
    }
  };

  const [showIpfs, setShowIpfs] = useState(false);
  const [ipfsGateway, setIpfsGateway] = useState("https://ipfs.io/ipfs/");
  const [showRpc, setShowRpc] = useState(false);
  const [customRpc, setCustomRpc] = useState("");
  const [exportDone, setExportDone] = useState(false);
  const [auditExportDone, setAuditExportDone] = useState(false);
  const [clearCacheDone, setClearCacheDone] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const allowDeveloperSurface = !IS_PRODUCTION_BUILD;

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    setDark(!dark);
    /* Persist so the theme survives reloads and page navigations */
    try { localStorage.setItem("aethelred-theme", next); } catch { /* private mode */ }
  };

  const handleExport = async () => {
    const events = await send("get-audit-events", { limit: 5000 });
    const blob = new Blob(
      [JSON.stringify({
        version: "1.0.0",
        exportedAt: Date.now(),
        state: "encrypted",
        events,
      }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aethelred-state-${Date.now()}.json`;
    a.click();
    setExportDone(true);
    setTimeout(() => setExportDone(false), 3000);
  };

  /* ─── Audit-log export (user-visible) ──────────────────────
   * The general "State Export" above is an advanced developer surface.
   * This export is the user-facing one exposed under Privacy & Safety:
   * it downloads ONLY the audit log (not the full wallet state) as a
   * plain JSON file the user can hand to auditors. Kept separate so
   * advanced / non-advanced users get the right affordance by default. */
  const handleAuditExport = async () => {
    const events = await send("get-audit-events", { limit: 50_000 });
    const blob = new Blob(
      [JSON.stringify({ version: "1.0.0", exportedAt: Date.now(), events }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aethelred-audit-${Date.now()}.json`;
    a.click();
    setAuditExportDone(true);
    setTimeout(() => setAuditExportDone(false), 3000);
  };

  /* ─── Clear-cache action ──────────────────────────────────
   * Wipes well-known cache keys plus anything under the generic
   * `aethelred-cache-` prefix. Does NOT touch preferences, keys, or
   * account data — the scope is deliberately "computed-from-network"
   * values only. */
  const handleClearCache = () => {
    try {
      CACHE_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
      const prefix = "aethelred-cache-";
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) doomed.push(key);
      }
      doomed.forEach((k) => localStorage.removeItem(k));
    } catch {
      // private mode — nothing to clear, that's fine
    }
    setClearCacheDone(true);
    setTimeout(() => setClearCacheDone(false), 3000);
  };

  /* ─── Reset-to-defaults action ────────────────────────────
   * Wipes every preference key listed in SETTINGS_STORAGE_KEYS and
   * reloads the popup so first-render reads fresh values. We confirm
   * via window.confirm — a toast won't block action for destructive
   * operations, and we want the user to have to acknowledge it. */
  const handleResetDefaults = () => {
    const confirmMsg = t("settings.rows.resetDefaultsConfirm");
    if (!window.confirm(confirmMsg)) return;
    try {
      SETTINGS_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
    } catch {
      // private mode
    }
    /* Reset DOM attributes so the user sees the change without a hard
     * reload — the popup chrome re-reads these. */
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-reduced-motion");
    setResetDone(true);
    // Give the toast a moment, then reload for a clean first-render.
    setTimeout(() => window.location.reload(), 900);
  };

  const currentCurrency = CURRENCIES.find(c => c.code === currency) ?? CURRENCIES[0];

  return (
    <div className="view-padded">
      {/* ═════ Settings hero ═════ */}
      <div className="set-hero">
        <div className="set-hero-icon">
          <SettingsIcon size={20} strokeWidth={2.3} />
        </div>
        <div className="set-hero-info">
          <span className="set-hero-label">PREFERENCES</span>
          <strong className="set-hero-title">Settings</strong>
          <span className="set-hero-sub">Aethelred {SHORT_VERSION}</span>
        </div>
        <div className="set-hero-chips">
          <div className="set-hero-chip">
            {dark ? <Moon size={10} strokeWidth={2.6} /> : <Sun size={10} strokeWidth={2.6} />}
            <span>{dark ? "Dark" : "Light"}</span>
          </div>
          <div className="set-hero-chip">
            <span className="set-hero-chip-sym">{currentCurrency.symbol}</span>
            <span>{currency}</span>
          </div>
        </div>
      </div>

      {/* ═════ General ═════ */}
      <div className="set-section-header">
        <div className="set-section-icon" style={{ background: "linear-gradient(135deg, #64748b 0%, #94a3b8 100%)" }}>
          <SettingsIcon size={12} strokeWidth={2.4} />
        </div>
        <span>GENERAL</span>
      </div>
      <div className="set-group">
        <button className="set-row" onClick={() => navigate("accounts")} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <User size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>Account</strong>
            <span>Profile, workspace, display name</span>
          </div>
          <ChevronRight size={14} className="set-row-chev" />
        </button>

        <div className="set-row" onClick={toggleTheme} role="button" tabIndex={0}>
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)" }}>
            {dark ? <Moon size={14} strokeWidth={2.3} /> : <Sun size={14} strokeWidth={2.3} />}
          </div>
          <div className="set-row-body">
            <strong>Appearance</strong>
            <span>{dark ? "Dark · Charcoal" : "Light · White Smoke"}</span>
          </div>
          <div className={`set-toggle ${dark ? "on" : ""}`}>
            <div className="set-toggle-thumb" />
          </div>
        </div>

        <button className="set-row" onClick={() => setShowCurrency(!showCurrency)} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #34c759 0%, #30d158 100%)" }}>
            <DollarSign size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>Currency</strong>
            <span>{currentCurrency.name}</span>
          </div>
          <div className="set-row-value">{currency}</div>
          <ChevronRight size={14} className={`set-row-chev ${showCurrency ? "flipped" : ""}`} />
        </button>
        {showCurrency && (
          <div className="set-expand">
            {CURRENCIES.map(c => (
              <button
                key={c.code}
                className={`set-option ${currency === c.code ? "active" : ""}`}
                onClick={() => { setCurrency(c.code); setShowCurrency(false); }}
                type="button"
              >
                <span className="set-option-sym">{c.symbol}</span>
                <div className="set-option-body">
                  <strong>{c.code}</strong>
                  <span>{c.name}</span>
                </div>
                {currency === c.code && (
                  <div className="set-option-check">
                    <Check size={11} strokeWidth={3.2} />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        <button className="set-row" onClick={() => setShowLanguage(!showLanguage)} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)" }}>
            <Languages size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>{t("settings.rows.language")}</strong>
            <span>{LANGUAGES.find((l) => l.code === languageCode)?.name ?? "English"}</span>
          </div>
          <ChevronRight size={14} className={`set-row-chev ${showLanguage ? "flipped" : ""}`} />
        </button>
        {showLanguage && (
          <div className="set-expand">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                className={`set-option ${languageCode === l.code ? "active" : ""}`}
                onClick={() => {
                  setLanguageCode(l.code);
                  /* Persist AND apply to i18next. If the language isn't
                   * bundled (e.g. Arabic / Japanese), i18next falls back
                   * to English gracefully — we still save the user's
                   * choice so adding the locale later lights it up. */
                  try {
                    localStorage.setItem("aethelred-language", l.code);
                  } catch {
                    // private mode
                  }
                  void i18n.changeLanguage(l.code);
                  setShowLanguage(false);
                }}
                type="button"
              >
                <div className="set-option-body set-option-body-single">
                  <strong>{l.name}</strong>
                </div>
                {languageCode === l.code && (
                  <div className="set-option-check">
                    <Check size={11} strokeWidth={3.2} />
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        <button className="set-row" onClick={() => setShowNotifications(!showNotifications)} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #ff3b30 0%, #ff6b6b 100%)" }}>
            <Bell size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>Notifications</strong>
            <span>Approvals, alerts, settlements</span>
          </div>
          <ChevronRight size={14} className={`set-row-chev ${showNotifications ? "flipped" : ""}`} />
        </button>
        {showNotifications && (
          <div className="set-expand">
            <div className="set-sub-row" onClick={() => setNotifApprovals(!notifApprovals)} role="button" tabIndex={0}>
              <span>Approval requests</span>
              <div className={`set-toggle ${notifApprovals ? "on" : ""}`}>
                <div className="set-toggle-thumb" />
              </div>
            </div>
            <div className="set-sub-row" onClick={() => setNotifAlerts(!notifAlerts)} role="button" tabIndex={0}>
              <span>Security alerts</span>
              <div className={`set-toggle ${notifAlerts ? "on" : ""}`}>
                <div className="set-toggle-thumb" />
              </div>
            </div>
            <div className="set-sub-row" onClick={() => setNotifSettlements(!notifSettlements)} role="button" tabIndex={0}>
              <span>Settlement confirmations</span>
              <div className={`set-toggle ${notifSettlements ? "on" : ""}`}>
                <div className="set-toggle-thumb" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═════ Network ═════ */}
      <div className="set-section-header">
        <div className="set-section-icon" style={{ background: "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)" }}>
          <Wifi size={12} strokeWidth={2.4} />
        </div>
        <span>NETWORK</span>
      </div>
      <div className="set-group">
        <button className="set-row" onClick={() => navigate("network-selector")} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)" }}>
            <Globe size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>Networks</strong>
            <span>Ethereum, Polygon, Arbitrum, Base, Aethelred</span>
          </div>
          <ChevronRight size={14} className="set-row-chev" />
        </button>

        <button className="set-row" onClick={() => navigate("network-selector")} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <Wifi size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>Network Provider</strong>
            <span>Default RPC · LlamaRPC</span>
          </div>
          <ChevronRight size={14} className="set-row-chev" />
        </button>
      </div>

      {/* ═════ Interaction ═════ */}
      <div className="set-section-header">
        <div className="set-section-icon" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)" }}>
          <Zap size={12} strokeWidth={2.4} />
        </div>
        <span>INTERACTION</span>
      </div>
      <div className="set-group">
        <div className="set-row" onClick={toggleHaptics} role="button" tabIndex={0}>
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)" }}>
            <Vibrate size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>Haptic feedback</strong>
            <span>{hapticsEnabledState ? "Vibrations on tap, confirm, and errors" : "Off"}</span>
          </div>
          <div className={`set-toggle ${hapticsEnabledState ? "on" : ""}`}>
            <div className="set-toggle-thumb" />
          </div>
        </div>

        <div className="set-row" onClick={toggleSound} role="button" tabIndex={0}>
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <Volume2 size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>Sound effects</strong>
            <span>{soundEnabledState ? "Click, copy, success, and error cues" : "Muted"}</span>
          </div>
          <div className={`set-toggle ${soundEnabledState ? "on" : ""}`}>
            <div className="set-toggle-thumb" />
          </div>
        </div>

        <div className="set-row" onClick={toggleReducedMotion} role="button" tabIndex={0}>
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #64748b 0%, #94a3b8 100%)" }}>
            <Zap size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>Reduced motion</strong>
            <span>
              {reducedMotionState
                ? "Minimise animations app-wide"
                : "Override system preference to hide motion"}
            </span>
          </div>
          <div className={`set-toggle ${reducedMotionState ? "on" : ""}`}>
            <div className="set-toggle-thumb" />
          </div>
        </div>
      </div>

      {/* ═════ Advanced (collapsible) ═════ */}
      {allowDeveloperSurface ? (
        <>
          <button
            className={`set-advanced-trigger ${showAdvanced ? "open" : ""}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
            type="button"
          >
            <div className="set-section-icon" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)" }}>
              <Code size={12} strokeWidth={2.4} />
            </div>
            <span>ADVANCED</span>
            <ChevronDown size={13} className="set-advanced-chev" />
          </button>
          {showAdvanced && (
            <div className="set-group">
              <div className="set-row" onClick={toggleDevMode} role="button" tabIndex={0}>
                <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)" }}>
                  <Code size={14} strokeWidth={2.3} />
                </div>
                <div className="set-row-body">
                  <strong>Developer Mode</strong>
                  <span>{devMode ? "Enabled · unlocks diagnostic tools" : "Unlock diagnostic tools and feature flags"}</span>
                </div>
                <div className={`set-toggle ${devMode ? "on" : ""}`}>
                  <div className="set-toggle-thumb" />
                </div>
              </div>
              {devMode && (
                <button className="set-row" onClick={() => navigate("developer-tools")} type="button">
                  <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)" }}>
                    <Terminal size={14} strokeWidth={2.3} />
                  </div>
                  <div className="set-row-body">
                    <strong>Developer Tools</strong>
                    <span>7 diagnostic tools · state inspector, command shell, flags</span>
                  </div>
                  <ChevronRight size={14} className="set-row-chev" />
                </button>
              )}

              <div className="set-row" onClick={() => setTestnets(!testnets)} role="button" tabIndex={0}>
                <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)" }}>
                  <TestTube size={14} strokeWidth={2.3} />
                </div>
                <div className="set-row-body">
                  <strong>Testnets</strong>
                  <span>{testnets ? "Sepolia, Aethelred Testnet visible" : "Hidden"}</span>
                </div>
                <div className={`set-toggle ${testnets ? "on" : ""}`}>
                  <div className="set-toggle-thumb" />
                </div>
              </div>

              <div className="set-row" onClick={() => setStageLogs(!stageLogs)} role="button" tabIndex={0}>
                <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)" }}>
                  <FileText size={14} strokeWidth={2.3} />
                </div>
                <div className="set-row-body">
                  <strong>Stage Logs</strong>
                  <span>{stageLogs ? "Verbose logging active" : "Normal logging"}</span>
                </div>
                <div className={`set-toggle ${stageLogs ? "on" : ""}`}>
                  <div className="set-toggle-thumb" />
                </div>
              </div>

              <button className="set-row" onClick={() => setShowIpfs(!showIpfs)} type="button">
                <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)" }}>
                  <Database size={14} strokeWidth={2.3} />
                </div>
                <div className="set-row-body">
                  <strong>IPFS Gateway</strong>
                  <span>{ipfsGateway}</span>
                </div>
                <ChevronRight size={14} className={`set-row-chev ${showIpfs ? "flipped" : ""}`} />
              </button>
              {showIpfs && (
                <div className="set-expand">
                  <input
                    className="set-input"
                    value={ipfsGateway}
                    onChange={e => setIpfsGateway(e.target.value)}
                    placeholder="https://ipfs.io/ipfs/"
                  />
                  <button className="set-btn primary" onClick={() => setShowIpfs(false)} type="button">
                    Save gateway
                  </button>
                </div>
              )}

              <button className="set-row" onClick={() => setShowRpc(!showRpc)} type="button">
                <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)" }}>
                  <Server size={14} strokeWidth={2.3} />
                </div>
                <div className="set-row-body">
                  <strong>Custom RPC</strong>
                  <span>Add custom RPC endpoints</span>
                </div>
                <ChevronRight size={14} className={`set-row-chev ${showRpc ? "flipped" : ""}`} />
              </button>
              {showRpc && (
                <div className="set-expand">
                  <input
                    className="set-input"
                    value={customRpc}
                    onChange={e => setCustomRpc(e.target.value)}
                    placeholder="https://rpc.example.com"
                  />
                  <button className="set-btn primary" onClick={() => setShowRpc(false)} type="button">
                    Add endpoint
                  </button>
                </div>
              )}

              <button className="set-row" onClick={handleExport} type="button">
                <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #06b6d4 0%, #22d3ee 100%)" }}>
                  <HardDrive size={14} strokeWidth={2.3} />
                </div>
                <div className="set-row-body">
                  <strong>State Export</strong>
                  <span>{exportDone ? "Downloaded" : "Export wallet state as JSON"}</span>
                </div>
                {exportDone
                  ? <div className="set-row-done"><Check size={12} strokeWidth={3.2} /></div>
                  : <ChevronRight size={14} className="set-row-chev" />}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="set-group">
          <div className="set-row" style={{ cursor: "default" }}>
            <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #64748b 0%, #94a3b8 100%)" }}>
              <Code size={14} strokeWidth={2.3} />
            </div>
            <div className="set-row-body">
              <strong>Advanced controls</strong>
              <span>Development-only tools are hidden in production.</span>
            </div>
          </div>
        </div>
      )}

      {/* ═════ Privacy & Safety ═════ *
       * Three user-facing destructive/export actions:
       *   - Export audit log (non-destructive, user-visible)
       *   - Clear cache (destructive, scoped to computed caches)
       *   - Reset settings (destructive, confirmed via window.confirm) */}
      <div className="set-section-header">
        <div className="set-section-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
          <FileText size={12} strokeWidth={2.4} />
        </div>
        <span>{t("settings.sections.privacyAndSafety")}</span>
      </div>
      <div className="set-group">
        <button className="set-row" onClick={handleAuditExport} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <FileText size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>{t("settings.rows.auditExport")}</strong>
            <span>{auditExportDone ? t("settings.rows.stateExportDone") : t("settings.rows.auditExportSub")}</span>
          </div>
          {auditExportDone
            ? <div className="set-row-done"><Check size={12} strokeWidth={3.2} /></div>
            : <ChevronRight size={14} className="set-row-chev" />}
        </button>

        <button className="set-row" onClick={handleClearCache} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #64748b 0%, #94a3b8 100%)" }}>
            <Database size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>{t("settings.rows.clearCache")}</strong>
            <span>{clearCacheDone ? t("settings.rows.clearCacheDone") : t("settings.rows.clearCacheSub")}</span>
          </div>
          {clearCacheDone
            ? <div className="set-row-done"><Check size={12} strokeWidth={3.2} /></div>
            : <ChevronRight size={14} className="set-row-chev" />}
        </button>

        <button className="set-row" onClick={handleResetDefaults} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #ef4444 0%, #f87171 100%)" }}>
            <HardDrive size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>{t("settings.rows.resetDefaults")}</strong>
            <span>{resetDone ? t("settings.rows.resetDefaultsDone") : t("settings.rows.resetDefaultsSub")}</span>
          </div>
          {resetDone
            ? <div className="set-row-done"><Check size={12} strokeWidth={3.2} /></div>
            : <ChevronRight size={14} className="set-row-chev" />}
        </button>
      </div>

      {/* ═════ About ═════ */}
      <div className="set-section-header">
        <div className="set-section-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
          <Info size={12} strokeWidth={2.4} />
        </div>
        <span>{t("settings.sections.about")}</span>
      </div>
      <div className="set-group">
        <button className="set-row" onClick={() => navigate("deployment-info")} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <Info size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>{t("settings.rows.about")}</strong>
            <span>{DISPLAY_VERSION} · {PACKAGE_COUNT} packages · Enterprise</span>
          </div>
          <ChevronRight size={14} className="set-row-chev" />
        </button>

        <button className="set-row" onClick={openSupport} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <LifeBuoy size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>{t("settings.rows.support")}</strong>
            <span>{t("settings.rows.supportSub")}</span>
          </div>
          <ChevronRight size={14} className="set-row-chev" />
        </button>

        <div className="set-row" onClick={toggleCrashCapture} role="button" tabIndex={0}>
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #64748b 0%, #94a3b8 100%)" }}>
            <LifeBuoy size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>{t("settings.rows.crashCapture")}</strong>
            <span>{t("settings.rows.crashCaptureSub")}</span>
          </div>
          <div className={`set-toggle ${crashCaptureState ? "on" : ""}`}>
            <div className="set-toggle-thumb" />
          </div>
        </div>
      </div>
    </div>
  );
}
