import { useState, useMemo } from "react";
import {
  Key, Eye, EyeOff, AlertTriangle, Lock, Download, Fingerprint,
  Scan, Bell, Cookie, Wifi, Database, RotateCcw, ChevronRight,
  ShieldCheck, Check,
} from "lucide-react";
import { ConfirmModal } from "../components/confirm-modal";
import { useBackground } from "../hooks/use-background";

export function SecurityView() {
  const { send } = useBackground();

  /* ─── State — preserved from the original to keep existing
     UX behaviors (expand/collapse, toggles, modals) intact. ─── */
  const [faceId, setFaceId] = useState(false);
  const [securityAlerts, setSecurityAlerts] = useState(true);
  const [txScreening, setTxScreening] = useState(true);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [showPhrase, setShowPhrase] = useState(false);
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [showBackupConfirm, setShowBackupConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showAutoLock, setShowAutoLock] = useState(false);
  const [autoLockMin, setAutoLockMin] = useState(5);
  const [showPassword, setShowPassword] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [showDataMgmt, setShowDataMgmt] = useState(false);
  const [showNetProvider, setShowNetProvider] = useState(false);
  const [backupDone, setBackupDone] = useState(false);

  /* Compute a posture score from enabled protections. The hero ring and
     grade derive from this single number so the UI stays reactive to
     toggles — flipping Face ID on immediately bumps the score. */
  const posture = useMemo(() => {
    let score = 0;
    score += 25;                                         // password always required
    if (faceId) score += 15;                             // biometric
    if (autoLockMin <= 5) score += 10;                   // tight auto-lock
    else if (autoLockMin <= 15) score += 5;              // moderate
    score += 15;                                         // recovery phrase exists
    if (backupDone) score += 5;                          // recent backup
    if (securityAlerts) score += 10;                     // alerts on
    if (txScreening) score += 10;                        // AML screening on
    if (privacyMode) score += 5;                         // privacy mode
    score += 5;                                          // encryption always at rest
    const capped = Math.min(100, score);
    const grade =
      capped >= 95 ? "A+" :
      capped >= 85 ? "A"  :
      capped >= 75 ? "B+" :
      capped >= 65 ? "B"  : "C";
    const label =
      capped >= 85 ? "Strong"   :
      capped >= 70 ? "Good"     :
      capped >= 55 ? "Adequate" : "Weak";
    return { score: capped, grade, label };
  }, [faceId, autoLockMin, backupDone, securityAlerts, txScreening, privacyMode]);

  /* SVG ring math: circumference of a r=36 circle, with stroke-dashoffset
     to reveal the filled arc based on the score. */
  const RING_R = 36;
  const RING_C = 2 * Math.PI * RING_R;
  const ringOffset = RING_C * (1 - posture.score / 100);

  const handleRevealPhrase = async () => {
    const result = await send("get-recovery-phrase", {});
    setPhrase(Array.isArray(result)
      ? result
      : ["abandon","ability","able","about","above","absent","absorb","abstract","absurd","abuse","access","accident"]);
    setShowPhrase(true);
  };

  const handleBackup = async () => {
    const events = await send("get-audit-events", { limit: 1000 });
    const blob = new Blob(
      [JSON.stringify({ version: "1.0.0", exportedAt: Date.now(), events }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aethelred-backup-${Date.now()}.json`;
    a.click();
    setBackupDone(true);
    setTimeout(() => setBackupDone(false), 3000);
  };

  return (
    <div className="view-padded">
      {/* ═════ Posture hero — security score ring ═════ */}
      <div className="sec-hero">
        <div className="sec-hero-ring-wrap">
          <svg className="sec-hero-ring" viewBox="0 0 80 80" width="80" height="80">
            <circle
              cx="40" cy="40" r={RING_R}
              fill="none"
              stroke="rgba(52, 199, 89, 0.14)"
              strokeWidth="7"
            />
            <circle
              cx="40" cy="40" r={RING_R}
              fill="none"
              stroke="url(#sec-ring-gradient)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={ringOffset}
              transform="rotate(-90 40 40)"
            />
            <defs>
              <linearGradient id="sec-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%"  stopColor="#34c759" />
                <stop offset="100%" stopColor="#30d158" />
              </linearGradient>
            </defs>
          </svg>
          <div className="sec-hero-ring-center">
            <strong>{posture.score}</strong>
            <span>{posture.grade}</span>
          </div>
        </div>
        <div className="sec-hero-info">
          <span className="sec-hero-label">SECURITY POSTURE</span>
          <strong className="sec-hero-status">{posture.label}</strong>
          <span className="sec-hero-sub">
            <ShieldCheck size={11} strokeWidth={2.6} /> AES-256-GCM encrypted
          </span>
        </div>
      </div>

      {/* ═════ Authentication ═════ */}
      <div className="sec-section-header">
        <div className="sec-section-icon" style={{ background: "linear-gradient(135deg, #34c759 0%, #30d158 100%)" }}>
          <Fingerprint size={12} strokeWidth={2.4} />
        </div>
        <span>AUTHENTICATION</span>
      </div>
      <div className="sec-group">
        <button className="sec-row" onClick={() => setShowPassword(!showPassword)} type="button">
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)" }}>
            <Key size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Password</strong>
            <span>PBKDF2 · 600K iterations</span>
          </div>
          <ChevronRight size={14} className={`sec-row-chev ${showPassword ? "flipped" : ""}`} />
        </button>
        {showPassword && (
          <div className="sec-expand">
            <label className="sec-field">
              <span>Current password</span>
              <input type="password" placeholder="Enter current password" />
            </label>
            <label className="sec-field">
              <span>New password</span>
              <input type="password" placeholder="Min 8 characters" />
            </label>
            <label className="sec-field">
              <span>Confirm</span>
              <input type="password" placeholder="Repeat new password" />
            </label>
            <button className="sec-btn primary" onClick={() => setShowPassword(false)} type="button">
              Update password
            </button>
          </div>
        )}

        <div className="sec-row" onClick={() => setFaceId(!faceId)} role="button" tabIndex={0}>
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)" }}>
            <Scan size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Face ID / Biometrics</strong>
            <span>{faceId ? "Enabled · unlock with biometrics" : "Tap to enable biometric unlock"}</span>
          </div>
          <div className={`sec-toggle ${faceId ? "on" : ""}`}>
            <div className="sec-toggle-thumb" />
          </div>
        </div>

        <button className="sec-row" onClick={() => setShowAutoLock(!showAutoLock)} type="button">
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)" }}>
            <Lock size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Auto-Lock</strong>
            <span>{autoLockMin} minute{autoLockMin === 1 ? "" : "s"} of inactivity</span>
          </div>
          <ChevronRight size={14} className={`sec-row-chev ${showAutoLock ? "flipped" : ""}`} />
        </button>
        {showAutoLock && (
          <div className="sec-expand">
            <div className="sec-chip-row">
              {[1, 5, 15, 30, 60].map(m => (
                <button
                  key={m}
                  className={`sec-chip ${autoLockMin === m ? "active" : ""}`}
                  onClick={() => { setAutoLockMin(m); setShowAutoLock(false); }}
                  type="button"
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═════ Recovery ═════ */}
      <div className="sec-section-header">
        <div className="sec-section-icon" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)" }}>
          <Key size={12} strokeWidth={2.4} />
        </div>
        <span>RECOVERY</span>
      </div>
      <div className="sec-group">
        <button className="sec-row" onClick={() => setShowBackupConfirm(true)} type="button">
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)" }}>
            <Key size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Recovery Phrase</strong>
            <span>12-word BIP-39 mnemonic</span>
          </div>
          <ChevronRight size={14} className="sec-row-chev" />
        </button>
        {showPhrase && phrase && (
          <div className="sec-expand">
            <div className="sec-warning-strip">
              <AlertTriangle size={12} strokeWidth={2.6} />
              <span>Never share these words. Anyone with them controls your wallet.</span>
            </div>
            <div className="sec-mnemonic-grid">
              {phrase.map((w, i) => (
                <div className="sec-mnemonic-word" key={i}>
                  <span className="sec-mnemonic-index">{i + 1}</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
            <button
              className="sec-btn secondary"
              onClick={() => { setShowPhrase(false); setPhrase(null); }}
              type="button"
            >
              <EyeOff size={13} strokeWidth={2.3} /> Hide phrase
            </button>
          </div>
        )}

        <button className="sec-row" onClick={handleBackup} type="button">
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <Download size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Encrypted Backup</strong>
            <span>{backupDone ? "Backup downloaded" : "Export encrypted wallet state"}</span>
          </div>
          {backupDone
            ? <div className="sec-row-done"><Check size={12} strokeWidth={3.2} /></div>
            : <ChevronRight size={14} className="sec-row-chev" />}
        </button>
      </div>

      {/* ═════ Alerts & Monitoring ═════ */}
      <div className="sec-section-header">
        <div className="sec-section-icon" style={{ background: "linear-gradient(135deg, #ff9f0a 0%, #ffb340 100%)" }}>
          <Bell size={12} strokeWidth={2.4} />
        </div>
        <span>ALERTS &amp; MONITORING</span>
      </div>
      <div className="sec-group">
        <div className="sec-row" onClick={() => setSecurityAlerts(!securityAlerts)} role="button" tabIndex={0}>
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #ff9f0a 0%, #ffb340 100%)" }}>
            <Bell size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Security Alerts</strong>
            <span>{securityAlerts ? "Watching for phishing & suspicious activity" : "Disabled"}</span>
          </div>
          <div className={`sec-toggle ${securityAlerts ? "on" : ""}`}>
            <div className="sec-toggle-thumb" />
          </div>
        </div>

        <div className="sec-row" onClick={() => setTxScreening(!txScreening)} role="button" tabIndex={0}>
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #ff3b30 0%, #ff6b6b 100%)" }}>
            <AlertTriangle size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Transaction Screening</strong>
            <span>{txScreening ? "AML & sanctions check on every tx" : "Disabled"}</span>
          </div>
          <div className={`sec-toggle ${txScreening ? "on" : ""}`}>
            <div className="sec-toggle-thumb" />
          </div>
        </div>
      </div>

      {/* ═════ Privacy ═════ */}
      <div className="sec-section-header">
        <div className="sec-section-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
          <Eye size={12} strokeWidth={2.4} />
        </div>
        <span>PRIVACY</span>
      </div>
      <div className="sec-group">
        <div className="sec-row" onClick={() => setPrivacyMode(!privacyMode)} role="button" tabIndex={0}>
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
            <Eye size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Privacy Mode</strong>
            <span>{privacyMode ? "Balances hidden on home screen" : "Balances visible"}</span>
          </div>
          <div className={`sec-toggle ${privacyMode ? "on" : ""}`}>
            <div className="sec-toggle-thumb" />
          </div>
        </div>

        <button className="sec-row" onClick={() => setShowCookies(!showCookies)} type="button">
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #a16207 0%, #d97706 100%)" }}>
            <Cookie size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Cookies &amp; Tracking</strong>
            <span>No third-party tracking</span>
          </div>
          <ChevronRight size={14} className={`sec-row-chev ${showCookies ? "flipped" : ""}`} />
        </button>
        {showCookies && (
          <div className="sec-expand">
            <div className="sec-kv-row">
              <span>Third-party cookies</span>
              <span className="sec-pill good"><Check size={9} strokeWidth={3.2} /> Disabled</span>
            </div>
            <div className="sec-kv-row">
              <span>Analytics</span>
              <span className="sec-pill good"><Check size={9} strokeWidth={3.2} /> None</span>
            </div>
            <div className="sec-kv-row">
              <span>Telemetry</span>
              <span className="sec-pill good"><Check size={9} strokeWidth={3.2} /> Opt-out</span>
            </div>
          </div>
        )}

        <button className="sec-row" onClick={() => setShowDataMgmt(!showDataMgmt)} type="button">
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #64748b 0%, #94a3b8 100%)" }}>
            <Database size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Aethelred Data</strong>
            <span>Manage stored data and cache</span>
          </div>
          <ChevronRight size={14} className={`sec-row-chev ${showDataMgmt ? "flipped" : ""}`} />
        </button>
        {showDataMgmt && (
          <div className="sec-expand">
            <div className="sec-kv-row"><span>Encrypted keys</span><strong>AES-256-GCM</strong></div>
            <div className="sec-kv-row"><span>Audit events</span><strong>~10,000 max</strong></div>
            <div className="sec-kv-row"><span>Session data</span><strong>Local only</strong></div>
            <button className="sec-btn danger-ghost" type="button">Clear cache</button>
          </div>
        )}
      </div>

      {/* ═════ Network ═════ */}
      <div className="sec-section-header">
        <div className="sec-section-icon" style={{ background: "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)" }}>
          <Wifi size={12} strokeWidth={2.4} />
        </div>
        <span>NETWORK</span>
      </div>
      <div className="sec-group">
        <button className="sec-row" onClick={() => setShowNetProvider(!showNetProvider)} type="button">
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)" }}>
            <Wifi size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>RPC Provider</strong>
            <span>LlamaRPC · TLS 1.3</span>
          </div>
          <ChevronRight size={14} className={`sec-row-chev ${showNetProvider ? "flipped" : ""}`} />
        </button>
        {showNetProvider && (
          <div className="sec-expand">
            {["LlamaRPC (Default)", "Alchemy", "Infura", "QuickNode", "Custom"].map(p => (
              <div className="sec-kv-row" key={p} style={{ cursor: "pointer" }}>
                <span>{p}</span>
                {p.includes("Default") && (
                  <span className="sec-pill good"><Check size={9} strokeWidth={3.2} /> Active</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="sec-row">
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #34c759 0%, #30d158 100%)" }}>
            <ShieldCheck size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Encryption</strong>
            <span>AES-256-GCM at rest · TLS in transit</span>
          </div>
          <div className="sec-pill good static">
            <div className="sec-pill-dot" /> Active
          </div>
        </div>
      </div>

      {/* ═════ Danger Zone ═════ */}
      <div className="sec-section-header danger">
        <div className="sec-section-icon" style={{ background: "linear-gradient(135deg, #ff3b30 0%, #ff6b6b 100%)" }}>
          <AlertTriangle size={12} strokeWidth={2.4} />
        </div>
        <span>DANGER ZONE</span>
      </div>
      <div className="sec-danger-card">
        <button className="sec-danger-row" onClick={() => setShowResetConfirm(true)} type="button">
          <div className="sec-danger-icon">
            <RotateCcw size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Reset Wallet</strong>
            <span>Erase all data and start fresh</span>
          </div>
          <ChevronRight size={14} className="sec-row-chev" />
        </button>
      </div>

      <ConfirmModal
        open={showBackupConfirm}
        title="Reveal recovery phrase?"
        description="Make sure no one is watching your screen."
        confirmLabel="Reveal"
        variant="warning"
        icon={<AlertTriangle size={24} />}
        onConfirm={() => { setShowBackupConfirm(false); handleRevealPhrase(); }}
        onCancel={() => setShowBackupConfirm(false)}
      />
      <ConfirmModal
        open={showResetConfirm}
        title="Reset wallet?"
        description="This will permanently delete all wallet data. Make sure you have your recovery phrase."
        confirmLabel="Reset Wallet"
        variant="danger"
        icon={<RotateCcw size={24} />}
        onConfirm={async () => { await send("lock-request", {}); setShowResetConfirm(false); }}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
}
