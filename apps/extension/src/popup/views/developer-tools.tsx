import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Code, Cpu, Database, Terminal, Flag, Activity,
  Copy, Check, RefreshCw, Trash2, Play, Pause,
  ChevronRight, ArrowLeft, AlertTriangle, Send, Clock,
  Zap, FileJson, ScrollText,
} from "lucide-react";
import { useNavigation } from "../router";
import { useWalletState } from "../hooks/use-wallet-state";
import { useBackground } from "../hooks/use-background";
import { DISPLAY_VERSION, BUILD_NUMBER, CODENAME, SEMVER, BUILD_DATE } from "../constants/version";

/* ─── Section FSM ──────────────────────────────────────────────────── */
type DevSection = "system" | "state" | "audit" | "shell" | "storage" | "flags" | "perf";

const SECTIONS: Array<{ id: DevSection; label: string; icon: typeof Cpu; color: string }> = [
  { id: "system",  label: "System",  icon: Cpu,       color: "#0ea5e9" },
  { id: "state",   label: "State",   icon: FileJson,  color: "#8b5cf6" },
  { id: "audit",   label: "Audit",   icon: ScrollText,color: "#14b8a6" },
  { id: "shell",   label: "Shell",   icon: Terminal,  color: "#34c759" },
  { id: "storage", label: "Storage", icon: Database,  color: "#f59e0b" },
  { id: "flags",   label: "Flags",   icon: Flag,      color: "#ff3b30" },
  { id: "perf",    label: "Perf",    icon: Activity,  color: "#ec4899" },
];

/* ─── Background commands catalog — pre-filled for Shell playground ─ */
const COMMAND_CATALOG = [
  { kind: "get-audit-events",    label: "Get Audit Events",    defaultParams: '{"limit": 10}' },
  { kind: "get-recovery-phrase", label: "Get Recovery Phrase", defaultParams: '{}' },
  { kind: "lock-request",        label: "Lock Wallet",         defaultParams: '{}' },
  { kind: "unlock-request",      label: "Unlock Wallet",       defaultParams: '{"password": ""}' },
];

/* ─── Feature flags — real flags stored in localStorage ──────────── */
interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  requiresReload: boolean;
  values?: Array<{ value: string; label: string }>;  // for enum flags
}
const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: "aethelred-ui-version",
    label: "Wallet UI Version",
    description: "Switch between v1 (classic) and v2 (Apple-grade) home screen",
    requiresReload: true,
    values: [
      { value: "2", label: "v2 (Apple-grade)" },
      { value: "1", label: "v1 (classic)" },
    ],
  },
  {
    key: "aethelred-debug-overlay",
    label: "Debug Overlay",
    description: "Show a persistent overlay with render counts",
    requiresReload: false,
  },
  {
    key: "aethelred-verbose-logging",
    label: "Verbose Logging",
    description: "Emit every background command to the console",
    requiresReload: false,
  },
  {
    key: "aethelred-mock-biometrics",
    label: "Mock Biometrics",
    description: "Simulate Face ID success without real hardware",
    requiresReload: false,
  },
  {
    key: "aethelred-skip-confirm",
    label: "Skip Confirmations",
    description: "Auto-accept confirmation modals (dangerous)",
    requiresReload: false,
  },
];

/* ─── Main component ──────────────────────────────────────────────── */
export function DeveloperToolsView() {
  const { navigate } = useNavigation();
  const { state, lockState, loading, isDevMode } = useWalletState();
  const { send } = useBackground();

  /**
   * The developer tool lets the user type arbitrary bridge-message
   * kinds (not just those in the typed `BridgeMessageKind` union) so
   * they can exercise experimental handlers. Widen the signature here
   * rather than expose a string-typed `send` across the rest of the
   * popup.
   */
  const sendAny = send as unknown as (kind: string, payload: unknown) => Promise<unknown>;

  const [section, setSection] = useState<DevSection>("system");

  return (
    <div className="view-padded">
      {/* ═════ Back + hero ═════ */}
      <button className="dev-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      <div className="dev-hero">
        <div className="dev-hero-icon">
          <Code size={20} strokeWidth={2.3} />
        </div>
        <div className="dev-hero-info">
          <span className="dev-hero-label">DEVELOPER TOOLS</span>
          <strong className="dev-hero-title">Power User Mode</strong>
          <span className="dev-hero-sub">{SECTIONS.length} diagnostic tools available</span>
        </div>
        <div className="dev-hero-warning" title="Use with care">
          <AlertTriangle size={14} strokeWidth={2.6} />
        </div>
      </div>

      {/* ═════ Section tabs (horizontal scroll) ═════ */}
      <div className="dev-tabs">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          const isActive = section === s.id;
          return (
            <button
              key={s.id}
              className={`dev-tab ${isActive ? "active" : ""}`}
              onClick={() => setSection(s.id)}
              type="button"
              style={isActive ? { borderColor: s.color, color: s.color } : undefined}
            >
              <Icon size={12} strokeWidth={2.6} />
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>

      {/* ═════ Section content ═════ */}
      {section === "system"  && <SystemSection state={state} lockState={lockState} loading={loading} isDevMode={isDevMode} />}
      {section === "state"   && <StateSection state={state} lockState={lockState} />}
      {section === "audit"   && <AuditSection send={sendAny} />}
      {section === "shell"   && <ShellSection send={sendAny} />}
      {section === "storage" && <StorageSection />}
      {section === "flags"   && <FlagsSection />}
      {section === "perf"    && <PerfSection />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ *
 * SYSTEM — live environment info
 * ═══════════════════════════════════════════════════════════════════ */
function SystemSection({
  state,
  lockState,
  loading,
  isDevMode,
}: {
  state: unknown;
  lockState: { locked: boolean; initialized: boolean } | null;
  loading: boolean;
  isDevMode: boolean;
}) {
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [online, setOnline] = useState(navigator.onLine);
  const sessionStart = useRef(Date.now());
  const [uptime, setUptime] = useState("0s");

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    const onNet = () => setOnline(navigator.onLine);
    window.addEventListener("resize", onResize);
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - sessionStart.current) / 1000);
      setUptime(s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
    }, 1000);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", onNet);
      clearInterval(tick);
    };
  }, []);

  const browser = useMemo(() => {
    const ua = navigator.userAgent;
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Edg/")) return "Edge";
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Safari")) return "Safari";
    return "Unknown";
  }, []);

  const os = useMemo(() => {
    const ua = navigator.userAgent;
    if (ua.includes("Mac")) return "macOS";
    if (ua.includes("Windows")) return "Windows";
    if (ua.includes("Linux")) return "Linux";
    if (ua.includes("Android")) return "Android";
    if (ua.includes("iOS")) return "iOS";
    return "Unknown";
  }, []);

  const rows: Array<{ k: string; v: string; ok?: boolean }> = [
    { k: "App Version",   v: DISPLAY_VERSION },
    { k: "SemVer",        v: SEMVER },
    { k: "Build",         v: `#${BUILD_NUMBER} (${BUILD_DATE})` },
    { k: "Codename",      v: CODENAME },
    { k: "UI Version",    v: "v2 (Apple-grade)" },
    { k: "Wallet State",  v: loading ? "Loading…" : state ? "Loaded" : "None", ok: !!state },
    { k: "Lock State",    v: lockState ? (lockState.locked ? "Locked" : "Unlocked") : "Unknown", ok: lockState ? !lockState.locked : false },
    { k: "Initialized",   v: lockState?.initialized ? "Yes" : "No", ok: lockState?.initialized },
    { k: "Context",       v: isDevMode ? "Dev Server" : "Extension" },
    { k: "Browser",       v: browser },
    { k: "OS",            v: os },
    { k: "Viewport",      v: `${viewport.w} × ${viewport.h}` },
    { k: "Device Pixel",  v: String(window.devicePixelRatio) },
    { k: "Color Depth",   v: `${window.screen.colorDepth}-bit` },
    { k: "Language",      v: navigator.language },
    { k: "Timezone",      v: Intl.DateTimeFormat().resolvedOptions().timeZone },
    { k: "Online",        v: online ? "Connected" : "Offline", ok: online },
    { k: "Session",       v: uptime },
  ];

  return (
    <div className="dev-panel">
      <div className="dev-kv-list">
        {rows.map(row => (
          <div className="dev-kv" key={row.k}>
            <span className="dev-kv-k">{row.k}</span>
            <span className={`dev-kv-v ${row.ok === true ? "ok" : row.ok === false ? "err" : ""}`}>
              {row.v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ *
 * STATE — live wallet state inspector
 * ═══════════════════════════════════════════════════════════════════ */
function StateSection({
  state,
  lockState,
}: {
  state: unknown;
  lockState: { locked: boolean; initialized: boolean } | null;
}) {
  const [copied, setCopied] = useState(false);

  const fullState = useMemo(
    () => JSON.stringify({ state, lockState }, null, 2),
    [state, lockState],
  );
  const size = useMemo(() => {
    const bytes = new Blob([fullState]).size;
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  }, [fullState]);

  const handleCopy = () => {
    navigator.clipboard.writeText(fullState);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="dev-panel">
      <div className="dev-panel-toolbar">
        <div className="dev-badge">
          <div className="dev-badge-dot pulse" />
          Live
        </div>
        <span className="dev-panel-meta">{size}</span>
        <button className="dev-icon-btn" onClick={handleCopy} type="button" title="Copy JSON">
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre className="dev-code-block">{fullState}</pre>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ *
 * AUDIT — live event stream
 * ═══════════════════════════════════════════════════════════════════ */
function AuditSection({ send }: { send: (kind: string, payload: unknown) => Promise<unknown> }) {
  const [events, setEvents] = useState<Array<{ id: string; kind: string; timestamp: number; sequenceNumber?: number }>>([]);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    if (paused) return;
    setLoading(true);
    try {
      const result = await send("get-audit-events", { limit: 50 });
      if (Array.isArray(result)) {
        setEvents(result as typeof events);
      }
    } catch {
      // swallow
    } finally {
      setLoading(false);
    }
  }, [paused, send]);

  useEffect(() => {
    refresh();
    const tick = setInterval(refresh, 3000);
    return () => clearInterval(tick);
  }, [refresh]);

  const kinds = useMemo(() => Array.from(new Set(events.map(e => e.kind))).sort(), [events]);
  const filtered = useMemo(
    () => filter === "all" ? events : events.filter(e => e.kind === filter),
    [events, filter],
  );

  return (
    <div className="dev-panel">
      <div className="dev-panel-toolbar">
        <div className={`dev-badge ${paused ? "paused" : ""}`}>
          <div className={`dev-badge-dot ${!paused ? "pulse" : ""}`} />
          {paused ? "Paused" : "Streaming"}
        </div>
        <select
          className="dev-select"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        >
          <option value="all">All kinds</option>
          {kinds.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <button
          className="dev-icon-btn"
          onClick={() => setPaused(!paused)}
          type="button"
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
        </button>
        <button
          className="dev-icon-btn"
          onClick={refresh}
          type="button"
          title="Refresh now"
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "spin" : ""} />
        </button>
      </div>
      <div className="dev-event-list">
        {filtered.length === 0 ? (
          <div className="dev-empty">No events match this filter</div>
        ) : (
          filtered.slice().reverse().map(e => (
            <div className="dev-event" key={e.id}>
              <span className="dev-event-seq">#{e.sequenceNumber ?? "?"}</span>
              <span className="dev-event-kind">{e.kind}</span>
              <span className="dev-event-time">
                {new Date(e.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ *
 * SHELL — background command playground
 * ═══════════════════════════════════════════════════════════════════ */
interface ShellHistoryEntry {
  id: number;
  kind: string;
  params: string;
  response: string;
  durationMs: number;
  error: boolean;
  at: number;
}

function ShellSection({ send }: { send: (kind: string, payload: unknown) => Promise<unknown> }) {
  const [kind, setKind] = useState(COMMAND_CATALOG[0].kind);
  const [params, setParams] = useState(COMMAND_CATALOG[0].defaultParams);
  const [history, setHistory] = useState<ShellHistoryEntry[]>([]);
  const [running, setRunning] = useState(false);
  const nextId = useRef(0);

  const handleKindChange = (newKind: string) => {
    setKind(newKind);
    const cmd = COMMAND_CATALOG.find(c => c.kind === newKind);
    if (cmd) setParams(cmd.defaultParams);
  };

  const handleSend = async () => {
    setRunning(true);
    const start = performance.now();
    let response = "";
    let error = false;
    try {
      const parsed = params.trim() ? JSON.parse(params) : {};
      const result = await send(kind, parsed);
      response = JSON.stringify(result, null, 2);
    } catch (err) {
      error = true;
      response = err instanceof Error ? err.message : String(err);
    }
    const durationMs = Math.round(performance.now() - start);
    setHistory(h => [
      { id: ++nextId.current, kind, params, response, durationMs, error, at: Date.now() },
      ...h,
    ].slice(0, 8));
    setRunning(false);
  };

  return (
    <div className="dev-panel">
      <div className="dev-shell-form">
        <label className="dev-field">
          <span>Command</span>
          <select
            className="dev-select dev-select-wide"
            value={kind}
            onChange={e => handleKindChange(e.target.value)}
          >
            {COMMAND_CATALOG.map(c => (
              <option key={c.kind} value={c.kind}>{c.label}</option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
        </label>
        {kind === "__custom__" && (
          <label className="dev-field">
            <span>Kind</span>
            <input
              className="dev-input"
              type="text"
              placeholder="custom-command-kind"
              onChange={e => setKind(e.target.value)}
            />
          </label>
        )}
        <label className="dev-field">
          <span>Params (JSON)</span>
          <textarea
            className="dev-textarea"
            value={params}
            onChange={e => setParams(e.target.value)}
            rows={3}
            spellCheck={false}
          />
        </label>
        <button
          className="dev-btn primary"
          onClick={handleSend}
          disabled={running}
          type="button"
        >
          {running ? <RefreshCw size={12} className="spin" /> : <Send size={12} />}
          {running ? "Running…" : "Send command"}
        </button>
      </div>

      {history.length > 0 && (
        <>
          <div className="dev-section-label">RECENT</div>
          <div className="dev-history">
            {history.map(h => (
              <div className={`dev-history-item ${h.error ? "error" : ""}`} key={h.id}>
                <div className="dev-history-head">
                  <strong>{h.kind}</strong>
                  <span className="dev-history-time">
                    <Clock size={9} />
                    {h.durationMs}ms
                  </span>
                </div>
                <pre className="dev-code-block small">{h.response.slice(0, 300)}{h.response.length > 300 ? "…" : ""}</pre>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ *
 * STORAGE — localStorage inspector + editor
 * ═══════════════════════════════════════════════════════════════════ */
function StorageSection() {
  const [items, setItems] = useState<Array<{ key: string; value: string; size: number }>>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const refresh = useCallback(() => {
    try {
      const keys: Array<{ key: string; value: string; size: number }> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key) ?? "";
          keys.push({ key, value, size: new Blob([value]).size });
        }
      }
      setItems(keys.sort((a, b) => a.key.localeCompare(b.key)));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const totalSize = items.reduce((sum, i) => sum + i.size, 0);
  const sizeLabel = totalSize < 1024 ? `${totalSize} B` : `${(totalSize / 1024).toFixed(1)} KB`;

  const handleDelete = (key: string) => {
    try { localStorage.removeItem(key); } catch {}
    refresh();
    setExpanded(null);
  };

  const handleSaveEdit = (key: string) => {
    try { localStorage.setItem(key, editValue); } catch {}
    refresh();
    setExpanded(null);
  };

  const handleExpand = (key: string, value: string) => {
    if (expanded === key) {
      setExpanded(null);
    } else {
      setExpanded(key);
      setEditValue(value);
    }
  };

  return (
    <div className="dev-panel">
      <div className="dev-panel-toolbar">
        <div className="dev-badge">
          <Database size={9} />
          localStorage
        </div>
        <span className="dev-panel-meta">{items.length} keys · {sizeLabel}</span>
        <button className="dev-icon-btn" onClick={refresh} type="button" title="Refresh">
          <RefreshCw size={12} />
        </button>
      </div>
      {items.length === 0 ? (
        <div className="dev-empty">localStorage is empty</div>
      ) : (
        <div className="dev-storage-list">
          {items.map(item => (
            <div key={item.key}>
              <button
                className={`dev-storage-row ${expanded === item.key ? "open" : ""}`}
                onClick={() => handleExpand(item.key, item.value)}
                type="button"
              >
                <div className="dev-storage-row-body">
                  <strong>{item.key}</strong>
                  <span>{item.value.length > 40 ? item.value.slice(0, 40) + "…" : item.value}</span>
                </div>
                <span className="dev-storage-size">{item.size < 1024 ? `${item.size}B` : `${(item.size / 1024).toFixed(1)}K`}</span>
                <ChevronRight size={12} className={`dev-storage-chev ${expanded === item.key ? "flipped" : ""}`} />
              </button>
              {expanded === item.key && (
                <div className="dev-storage-edit">
                  <textarea
                    className="dev-textarea"
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    rows={3}
                  />
                  <div className="dev-storage-actions">
                    <button
                      className="dev-btn primary"
                      onClick={() => handleSaveEdit(item.key)}
                      type="button"
                    >
                      Save
                    </button>
                    <button
                      className="dev-btn danger"
                      onClick={() => handleDelete(item.key)}
                      type="button"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ *
 * FLAGS — feature flag toggles (real localStorage writes)
 * ═══════════════════════════════════════════════════════════════════ */
function FlagsSection() {
  const [flags, setFlags] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of FEATURE_FLAGS) {
      try { initial[f.key] = localStorage.getItem(f.key) ?? ""; } catch {}
    }
    return initial;
  });
  const [toast, setToast] = useState<string | null>(null);

  const setFlag = (key: string, value: string, requiresReload: boolean) => {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {}
    setFlags(f => ({ ...f, [key]: value }));
    if (requiresReload) {
      setToast("Reload required — reloading in 1s…");
      setTimeout(() => window.location.reload(), 1000);
    } else {
      setToast("Saved");
      setTimeout(() => setToast(null), 1500);
    }
  };

  const handleReset = () => {
    for (const f of FEATURE_FLAGS) {
      try { localStorage.removeItem(f.key); } catch {}
    }
    setFlags({});
    setToast("All flags reset — reloading…");
    setTimeout(() => window.location.reload(), 1000);
  };

  return (
    <div className="dev-panel">
      {toast && <div className="dev-toast">{toast}</div>}
      <div className="dev-flag-list">
        {FEATURE_FLAGS.map(f => {
          const current = flags[f.key] ?? "";
          if (f.values) {
            return (
              <div className="dev-flag" key={f.key}>
                <div className="dev-flag-body">
                  <strong>{f.label}</strong>
                  <span>{f.description}</span>
                </div>
                <div className="dev-flag-select-row">
                  {f.values.map(opt => (
                    <button
                      key={opt.value}
                      className={`dev-flag-opt ${current === opt.value ? "active" : ""}`}
                      onClick={() => setFlag(f.key, opt.value, f.requiresReload)}
                      type="button"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          const isOn = current === "1";
          return (
            <div className="dev-flag" key={f.key} onClick={() => setFlag(f.key, isOn ? "" : "1", f.requiresReload)} role="button" tabIndex={0}>
              <div className="dev-flag-body">
                <strong>{f.label}</strong>
                <span>{f.description}</span>
              </div>
              <div className={`set-toggle ${isOn ? "on" : ""}`}>
                <div className="set-toggle-thumb" />
              </div>
            </div>
          );
        })}
      </div>
      <button className="dev-btn danger-ghost" onClick={handleReset} type="button">
        <Trash2 size={11} /> Reset all flags
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ *
 * PERF — live FPS / memory / DOM counter
 * ═══════════════════════════════════════════════════════════════════ */
function PerfSection() {
  const [fps, setFps] = useState(0);
  const [memory, setMemory] = useState<{ used: number; total: number; limit: number } | null>(null);
  const [domNodes, setDomNodes] = useState(0);
  const [renderCount, setRenderCount] = useState(0);
  const renderRef = useRef(0);

  /* Increment on every render via ref (no state write → no feedback loop).
     The displayed count is polled from the ref once per second below. */
  renderRef.current++;

  /* FPS counter via requestAnimationFrame loop, sampled every 500ms. */
  useEffect(() => {
    let frames = 0;
    let running = true;
    let last = performance.now();
    const loop = () => {
      if (!running) return;
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { running = false; };
  }, []);

  /* Memory + DOM + render count polled every second. */
  useEffect(() => {
    const poll = () => {
      /* @ts-expect-error — performance.memory is Chrome-only and not in TS types. */
      const mem = performance.memory;
      if (mem) {
        setMemory({
          used: mem.usedJSHeapSize,
          total: mem.totalJSHeapSize,
          limit: mem.jsHeapSizeLimit,
        });
      }
      setDomNodes(document.querySelectorAll("*").length);
      setRenderCount(renderRef.current);
    };
    poll();
    const tick = setInterval(poll, 1000);
    return () => clearInterval(tick);
  }, []);

  const formatBytes = (b: number): string => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  };

  const fpsHealth = fps >= 55 ? "ok" : fps >= 30 ? "warn" : "err";

  return (
    <div className="dev-panel">
      <div className="dev-metric-grid">
        <div className="dev-metric">
          <span>FPS</span>
          <strong className={`dev-metric-val ${fpsHealth}`}>{fps}</strong>
        </div>
        {memory && (
          <>
            <div className="dev-metric">
              <span>Heap Used</span>
              <strong className="dev-metric-val">{formatBytes(memory.used)}</strong>
            </div>
            <div className="dev-metric">
              <span>Heap Total</span>
              <strong className="dev-metric-val">{formatBytes(memory.total)}</strong>
            </div>
          </>
        )}
        <div className="dev-metric">
          <span>DOM Nodes</span>
          <strong className="dev-metric-val">{domNodes.toLocaleString()}</strong>
        </div>
        <div className="dev-metric">
          <span>Renders</span>
          <strong className="dev-metric-val">{renderCount}</strong>
        </div>
      </div>

      {memory && (
        <div className="dev-memory-bar">
          <div className="dev-memory-label">
            <span>Heap usage</span>
            <strong>{Math.round((memory.used / memory.limit) * 100)}%</strong>
          </div>
          <div className="dev-memory-track">
            <div
              className="dev-memory-fill"
              style={{ width: `${(memory.used / memory.limit) * 100}%` }}
            />
          </div>
          <div className="dev-memory-limit">
            Limit: {formatBytes(memory.limit)}
          </div>
        </div>
      )}

      {!memory && (
        <div className="dev-empty">
          <Zap size={14} />
          <span>Memory profiling not available in this browser</span>
        </div>
      )}
    </div>
  );
}
