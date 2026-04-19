import { Plus, Download, ChevronRight } from "lucide-react";
import { useNavigation } from "../../router";
import "../../../styles/legacy/onboarding.css";

/* ─── Welcome (Step 0 — landing) ────────────────────────────────── *
 * First screen a fresh user sees. Two decisions, one brand moment.
 * Logo strip at the top, two action cards in the middle, a small
 * terms footer at the bottom. Uses the shared `.onb-*` class system
 * defined in ../../../styles/legacy/onboarding.css. */
export function WelcomeView() {
  const { navigate } = useNavigation();

  return (
    <div className="onb-screen">
      {/* Brand strip — real logo from /public/logo.png */}
      <div className="onb-brand">
        <img src="/logo.png" alt="Aethelred" className="onb-brand-logo" />
        <span className="onb-brand-wordmark">Aethelred</span>
      </div>

      {/* Headline */}
      <h1 className="onb-headline">Welcome to Aethelred</h1>
      <p className="onb-subtitle">Trust platform for the sovereign internet</p>

      {/* Two large action cards */}
      <div className="onb-body" style={{ gap: 12 }}>
        <button
          className="onb-choice"
          onClick={() => navigate("onboarding-create")}
          type="button"
        >
          <div className="onb-choice-icon">
            <Plus size={20} strokeWidth={2.4} />
          </div>
          <div className="onb-choice-body">
            <strong>Create new wallet</strong>
            <span>Generate a fresh recovery phrase on this device</span>
          </div>
          <ChevronRight size={16} className="onb-choice-chev" />
        </button>

        <button
          className="onb-choice ghost"
          onClick={() => navigate("onboarding-import")}
          type="button"
        >
          <div className="onb-choice-icon">
            <Download size={20} strokeWidth={2.4} />
          </div>
          <div className="onb-choice-body">
            <strong>Import existing</strong>
            <span>Restore from a 12 or 24-word recovery phrase</span>
          </div>
          <ChevronRight size={16} className="onb-choice-chev" />
        </button>
      </div>

      {/* Terms footer */}
      <div className="onb-foot">
        By continuing you agree to the{" "}
        <a href="https://aethelred.org/terms" target="_blank" rel="noopener noreferrer">
          Terms
        </a>{" "}
        and{" "}
        <a href="https://aethelred.org/privacy" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        .
      </div>
    </div>
  );
}
