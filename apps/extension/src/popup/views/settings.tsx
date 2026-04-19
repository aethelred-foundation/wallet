import { useState, useEffect } from "react";
import {
  User, Moon, Sun, Globe, DollarSign, Languages, Bell, Wifi,
  Code, TestTube, FileText, Database, Server, HardDrive,
  ChevronRight, Info, Check, Settings as SettingsIcon,
  ChevronDown, Terminal,
} from "lucide-react";
import type { AethelredWalletState } from "@aethelred/wallet-connect";
import { useNavigation } from "../router";
import { useBackground } from "../hooks/use-background";
import { useFormat } from "../i18n/format";
import { DISPLAY_VERSION, SHORT_VERSION, PACKAGE_COUNT } from "../constants/version";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

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

export function SettingsView({ state: _state }: { state: AethelredWalletState }) {
  const { navigate } = useNavigation();
  const { send } = useBackground();
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
  const [language, setLanguage] = useState("English");
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
  const [showIpfs, setShowIpfs] = useState(false);
  const [ipfsGateway, setIpfsGateway] = useState("https://ipfs.io/ipfs/");
  const [showRpc, setShowRpc] = useState(false);
  const [customRpc, setCustomRpc] = useState("");
  const [exportDone, setExportDone] = useState(false);
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
            <strong>Language</strong>
            <span>{language}</span>
          </div>
          <ChevronRight size={14} className={`set-row-chev ${showLanguage ? "flipped" : ""}`} />
        </button>
        {showLanguage && (
          <div className="set-expand">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                className={`set-option ${language === l.name ? "active" : ""}`}
                onClick={() => { setLanguage(l.name); setShowLanguage(false); }}
                type="button"
              >
                <div className="set-option-body set-option-body-single">
                  <strong>{l.name}</strong>
                </div>
                {language === l.name && (
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

      {/* ═════ About ═════ */}
      <div className="set-section-header">
        <div className="set-section-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
          <Info size={12} strokeWidth={2.4} />
        </div>
        <span>ABOUT</span>
      </div>
      <div className="set-group">
        <button className="set-row" onClick={() => navigate("deployment-info")} type="button">
          <div className="set-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <Info size={14} strokeWidth={2.3} />
          </div>
          <div className="set-row-body">
            <strong>About Aethelred Wallet</strong>
            <span>{DISPLAY_VERSION} · {PACKAGE_COUNT} packages · Enterprise</span>
          </div>
          <ChevronRight size={14} className="set-row-chev" />
        </button>
      </div>
    </div>
  );
}
