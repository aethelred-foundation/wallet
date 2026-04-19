import { useState } from "react";
import {
  Eye, EyeOff, AlertTriangle, Copy, Check, ArrowRight,
} from "lucide-react";
import { useNavigation } from "../../router";
import "../../../styles/legacy/onboarding.css";

/* ─── Recovery Phrase (Step 2/4) ────────────────────────────────── *
 * Shows the freshly-generated 12-word mnemonic stored in sessionStorage
 * by create-wallet.tsx. The user must check the acknowledgement box
 * AND press "I've written it down" to continue. The phrase is blurred
 * by default and revealed by the show/hide toggle so a casual observer
 * can't read it over the shoulder. */
export function RecoveryPhraseView() {
  const { navigate } = useNavigation();
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const raw = sessionStorage.getItem("onboarding-mnemonic");
  const mnemonic: string[] = raw ? JSON.parse(raw) : [];

  const copyPhrase = () => {
    navigator.clipboard.writeText(mnemonic.join(" "));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContinue = () => {
    sessionStorage.removeItem("onboarding-mnemonic");
    navigate("onboarding-complete");
  };

  return (
    <div className="onb-screen">
      <div className="onb-steps">
        <span className="onb-step-label">Step 2 of 4</span>
        <span className="onb-step-dot done" />
        <span className="onb-step-dot active" />
        <span className="onb-step-dot" />
        <span className="onb-step-dot" />
      </div>

      <div className="onb-illo">
        {revealed ? <Eye size={40} strokeWidth={2.2} /> : <EyeOff size={40} strokeWidth={2.2} />}
      </div>

      <h1 className="onb-headline">Your recovery phrase</h1>
      <p className="onb-subtitle">
        These 12 words are the only backup for your wallet
      </p>

      <div className="onb-body">
        {/* Danger warning banner */}
        <div className="onb-warn">
          <AlertTriangle size={16} strokeWidth={2.4} />
          <div className="onb-warn-body">
            <strong>Write these down</strong>
            Store these 12 words safely. Anyone with these words controls
            your wallet. Never share them.
          </div>
        </div>

        {/* Mnemonic grid + blur veil */}
        <div className={`onb-phrase-wrap${revealed ? "" : " hidden"}`}>
          <div className="onb-phrase-grid">
            {mnemonic.map((word, index) => (
              <div className="onb-phrase-word" key={index}>
                <span className="onb-phrase-idx">{index + 1}</span>
                <span className="onb-phrase-text">{word}</span>
              </div>
            ))}
          </div>
          {!revealed && (
            <button
              type="button"
              className="onb-phrase-veil"
              onClick={() => setRevealed(true)}
            >
              <Eye size={14} strokeWidth={2.4} />
              Tap to reveal phrase
            </button>
          )}
        </div>

        {/* Tool row: reveal/hide + copy */}
        <div className="onb-tool-row">
          <button
            className={`onb-tool-btn${revealed ? " active" : ""}`}
            onClick={() => setRevealed(!revealed)}
            type="button"
          >
            {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
            {revealed ? "Hide" : "Reveal"}
          </button>
          <button
            className={`onb-tool-btn${copied ? " active" : ""}`}
            onClick={copyPhrase}
            type="button"
            disabled={!revealed}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Acknowledgement checkbox */}
        <label className={`onb-ack${confirmed ? " onb-ack-checked" : ""}`}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>
            I have written down my recovery phrase and stored it in a safe
            place where only I can access it.
          </span>
        </label>
      </div>

      <div className="onb-cta">
        <button
          className="onb-primary"
          onClick={handleContinue}
          type="button"
          disabled={!confirmed}
        >
          I've written it down
          <ArrowRight size={16} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
