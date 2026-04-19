import { useMemo, useState } from "react";
import { Eye, EyeOff, KeyRound, ArrowLeft, Download } from "lucide-react";
import { useNavigation } from "../../router";
import { useBackground } from "../../hooks/use-background";
import "../../../styles/legacy/onboarding.css";

/* ─── Import Wallet (Step 1/4) ──────────────────────────────────── *
 * Alternate entry point for users who already have a recovery phrase.
 * KeyRound illustration, mono-spaced textarea for the seed phrase,
 * and a password block (import flow still needs a local encryption
 * password). Enabled when mnemonic has at least 12 space-separated
 * words AND both password fields match and are ≥ 8 chars long. */
export function ImportWalletView() {
  const { navigate } = useNavigation();
  const { send } = useBackground();
  const [mnemonic, setMnemonic] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const wordCount = useMemo(
    () => mnemonic.trim().split(/\s+/).filter(Boolean).length,
    [mnemonic],
  );

  const canSubmit =
    !loading &&
    wordCount >= 12 &&
    password.length >= 8 &&
    confirm.length >= 8 &&
    password === confirm;

  const handleImport = async () => {
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      setError("Seed phrase must be 12 or 24 words");
      return;
    }
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
      await send("import-wallet", { password, mnemonic: words });
      navigate("onboarding-complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import wallet");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="onb-screen">
      <div className="onb-steps">
        <span className="onb-step-label">Step 1 of 4</span>
        <span className="onb-step-dot active" />
        <span className="onb-step-dot" />
        <span className="onb-step-dot" />
        <span className="onb-step-dot" />
      </div>

      <div className="onb-illo">
        <KeyRound size={40} strokeWidth={2.2} />
      </div>

      <h1 className="onb-headline">Import your wallet</h1>
      <p className="onb-subtitle">
        Enter your 12 or 24-word recovery phrase
      </p>

      <div className="onb-body">
        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-mnemonic">
            Recovery phrase · {wordCount} {wordCount === 1 ? "word" : "words"}
          </label>
          <textarea
            id="onb-mnemonic"
            className="onb-textarea"
            placeholder="paddle shoot arrow lobster moral bench..."
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            rows={3}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoFocus
          />
        </div>

        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-import-password">
            New password
          </label>
          <div className="onb-input-wrap">
            <input
              id="onb-import-password"
              className="onb-input"
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
        </div>

        <div className="onb-field">
          <label className="onb-field-label" htmlFor="onb-import-confirm">
            Confirm password
          </label>
          <div className="onb-input-wrap">
            <input
              id="onb-import-confirm"
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
          onClick={handleImport}
          type="button"
          disabled={!canSubmit}
        >
          <Download size={17} strokeWidth={2.4} />
          {loading ? "Importing..." : "Import wallet"}
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
