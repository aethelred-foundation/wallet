import { useState, useEffect, useMemo, useRef } from "react";
import { Eye, EyeOff, ScanFace, AlertTriangle, Unlock } from "lucide-react";
import { useBackground } from "../hooks/use-background";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

/* Styles co-located with this component so they only hydrate when the
   lock view mounts. All classes are prefixed `lock2-*` to avoid
   collisions with the still-extant legacy `.lock-*` styles. */
import "../../styles/legacy/lock.css";

/* localStorage keys — namespaced under the aethelred-* prefix that the
   rest of the app already uses (e.g. aethelred-theme, aethelred-tab). */
const LAST_UNLOCK_KEY = "aethelred-last-unlock";
const BIOMETRIC_KEY = "aethelred-biometric";

/* Relative time formatter used in the footer. Keeps output short
   (e.g. "2h ago", "3d ago") so the footer stays balanced. */
function formatRelative(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 0 || !Number.isFinite(delta)) return "just now";

  const sec = Math.floor(delta / 1000);
  if (sec < 10) return "just now";
  if (sec < 60) return `${sec}s ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;

  return new Date(ms).toLocaleDateString();
}

export function LockScreenView({ onUnlock }: { onUnlock: () => void }) {
  const { send } = useBackground();

  /* ─── State — preserves the original contract: password,
     show/hide toggle, error message, loading spinner. ─── */
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shaking, setShaking] = useState(false);

  /* Refs */
  const inputRef = useRef<HTMLInputElement>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ─── Biometric availability is checked once on mount via
     localStorage. In production this would also probe the platform
     WebAuthn API. Until that exists, production must not expose a
     pretend biometric unlock path. */
  const biometricEnabled = useMemo(() => {
    if (IS_PRODUCTION_BUILD) {
      return false;
    }
    try {
      return localStorage.getItem(BIOMETRIC_KEY) === "1";
    } catch {
      return false;
    }
  }, []);

  /* ─── Last unlock timestamp — read once on mount so the footer
     doesn't jitter. Stored as a millisecond epoch. Re-rendered
     every 30s via a ticker so "2m ago" rolls over correctly. */
  const [lastUnlock, setLastUnlock] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(LAST_UNLOCK_KEY);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  /* Cleanup the shake timer on unmount. */
  useEffect(() => {
    return () => {
      if (shakeTimer.current) clearTimeout(shakeTimer.current);
    };
  }, []);

  /* Autofocus the password input on mount. We don't use the native
     `autoFocus` attribute because React sometimes debounces it in
     StrictMode, and we want the field focused even after a soft
     remount from a failed unlock. */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* ─── Shared success path — writes the last-unlock timestamp
     and invokes the onUnlock callback. Used by both the password
     flow and the biometric flow. */
  const finishUnlock = () => {
    try {
      const now = Date.now();
      localStorage.setItem(LAST_UNLOCK_KEY, now.toString());
      setLastUnlock(now);
    } catch {
      /* storage can fail in incognito — not fatal, continue */
    }
    onUnlock();
  };

  /* ─── Error handler — shared between password and biometric
     failures. Triggers the shake animation via a transient class
     that auto-clears after the 400ms keyframe finishes. */
  const triggerError = (message: string) => {
    setError(message);
    setShaking(true);
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShaking(false), 450);
    /* Re-focus and select the password so the user can re-type
       immediately without clicking back into the input. */
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const handleUnlock = async () => {
    if (!password || loading) return;
    setLoading(true);
    setError("");

    try {
      await send("unlock-request", { password });
      finishUnlock();
    } catch (err) {
      triggerError(err instanceof Error ? err.message : "Failed to unlock");
    } finally {
      setLoading(false);
    }
  };

  /* Biometric unlock — currently a mock success path as described in
     the spec. Real WebAuthn / platform authenticator probing lives
     in a later milestone. */
  const handleBiometric = () => {
    if (loading || IS_PRODUCTION_BUILD) return;
    finishUnlock();
  };

  const handleForgot = () => {
    alert("Password recovery requires your 12-word recovery phrase");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleUnlock();
  };

  const footerLabel = lastUnlock
    ? `Last unlocked ${formatRelative(lastUnlock)}`
    : "First launch";

  return (
    <div className="lock2-root">
      {/* ═════ Hero — logo, title, tagline ═════ */}
      <div className="lock2-hero">
        <div className="lock2-logo-wrap">
          <img
            src="/logo.png"
            alt="Aethelred"
            className="lock2-logo-img"
            draggable={false}
          />
        </div>
        <h1 className="lock2-title">Aethelred Wallet</h1>
        <p className="lock2-tagline">Trust platform for the sovereign internet</p>
      </div>

      {/* ═════ Form ═════ */}
      <div className={`lock2-form ${shaking ? "shake" : ""}`}>
        <div className="lock2-input-wrap">
          <input
            ref={inputRef}
            className={`lock2-input ${error ? "error" : ""}`}
            type={showPassword ? "text" : "password"}
            placeholder="Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={handleKeyDown}
            disabled={loading}
            autoComplete="current-password"
            aria-label="Password"
            aria-invalid={!!error}
          />
          <button
            className="lock2-eye"
            onClick={() => setShowPassword(!showPassword)}
            type="button"
            tabIndex={-1}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && (
          <p className="lock2-error" role="alert">
            <AlertTriangle size={12} strokeWidth={2.6} />
            <span>{error}</span>
          </p>
        )}

        <button
          className="lock2-unlock"
          onClick={handleUnlock}
          type="button"
          disabled={loading || !password}
        >
          {loading ? (
            <>
              <span className="lock2-spin" aria-hidden="true" />
              <span>Unlocking...</span>
            </>
          ) : (
            <>
              <Unlock size={15} strokeWidth={2.6} />
              <span>Unlock</span>
            </>
          )}
        </button>

        {biometricEnabled ? (
          <div className="lock2-bio-row">
            <button
              className="lock2-bio"
              onClick={handleBiometric}
              type="button"
              aria-label="Unlock with biometrics"
              disabled={loading}
            >
              <ScanFace size={20} strokeWidth={2.2} />
            </button>
          </div>
        ) : IS_PRODUCTION_BUILD ? (
          <div className="lock2-bio-row">
            <button
              className="lock2-bio"
              type="button"
              disabled
              aria-disabled="true"
              aria-label="Biometric unlock unavailable in this release"
            >
              <ScanFace size={20} strokeWidth={2.2} />
            </button>
            <span>Biometric unlock unavailable in this release</span>
          </div>
        ) : null}

        <button
          className="lock2-forgot"
          onClick={handleForgot}
          type="button"
        >
          Forgot password?
        </button>
      </div>

      {/* ═════ Footer — last unlocked ═════ */}
      <div className="lock2-footer">
        <span className="lock2-footer-dot" />
        <span>{footerLabel}</span>
      </div>
    </div>
  );
}
