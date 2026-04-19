import { useMemo, useState } from "react";
import { Eye, EyeOff, ShieldCheck, ArrowLeft } from "lucide-react";
import { useNavigation } from "../../router";
import { useBackground } from "../../hooks/use-background";
import "../../../styles/legacy/onboarding.css";

/* ─── Create Wallet (Step 1/4) ──────────────────────────────────── *
 * First of the four ladder steps when a user creates a new wallet.
 * Shield illustration, password + confirm, 3-bar strength meter,
 * and a primary "Create wallet" button. The meter reads strength
 * from three heuristics: length ≥ 8, mixed case, and at least one
 * non-alphanumeric character — giving 0-3 bars. */
export function CreateWalletView() {
  const { navigate } = useNavigation();
  const { send } = useBackground();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  /* Strength heuristic — deliberately simple so it's legible. */
  const strength = useMemo(() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password) || password.length >= 12) score += 1;
    return score;
  }, [password]);

  const strengthLabel =
    strength === 0 ? "" :
    strength === 1 ? "Weak" :
    strength === 2 ? "Good" : "Strong";

  const canSubmit =
    !loading &&
    password.length >= 8 &&
    confirm.length >= 8 &&
    password === confirm;

  const handleCreate = async () => {
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await send("init-wallet", { password }) as {
        mnemonic: string[];
        address: string;
      };
      // Store mnemonic temporarily for the recovery phrase view
      sessionStorage.setItem("onboarding-mnemonic", JSON.stringify(result.mnemonic));
      navigate("onboarding-recovery");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create wallet");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="onb-screen">
      {/* Step ladder: 1 of 4 active */}
      <div className="onb-steps">
        <span className="onb-step-label">Step 1 of 4</span>
        <span className="onb-step-dot active" />
        <span className="onb-step-dot" />
        <span className="onb-step-dot" />
        <span className="onb-step-dot" />
      </div>

      {/* Hero illustration */}
      <div className="onb-illo">
        <ShieldCheck size={40} strokeWidth={2.2} />
      </div>

      <h1 className="onb-headline">Secure your wallet</h1>
      <p className="onb-subtitle">
        Create a strong password to encrypt your keys on this device
      </p>

      <div className="onb-body">
        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-password">Password</label>
          <div className="onb-input-wrap">
            <input
              id="onb-password"
              className="onb-input"
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <button
              className="onb-input-toggle"
              onClick={() => setShowPassword(!showPassword)}
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* 3-bar strength meter */}
          <div className="onb-strength" data-level={strength}>
            <div className="onb-strength-bars">
              <span className="onb-strength-bar b1" />
              <span className="onb-strength-bar b2" />
              <span className="onb-strength-bar b3" />
            </div>
            <span className="onb-strength-label">{strengthLabel || "—"}</span>
          </div>
        </div>

        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-confirm">Confirm password</label>
          <div className="onb-input-wrap">
            <input
              id="onb-confirm"
              className="onb-input"
              type={showPassword ? "text" : "password"}
              placeholder="Repeat your password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="onb-cta">
        {error && <p className="onb-error">{error}</p>}
        <button
          className="onb-primary"
          onClick={handleCreate}
          type="button"
          disabled={!canSubmit}
        >
          <ShieldCheck size={17} strokeWidth={2.4} />
          {loading ? "Creating wallet..." : "Create wallet"}
        </button>
        <button
          className="onb-link"
          onClick={() => navigate("onboarding-welcome")}
          type="button"
        >
          <ArrowLeft size={12} strokeWidth={2.4} />
          Back
        </button>
      </div>
    </div>
  );
}
