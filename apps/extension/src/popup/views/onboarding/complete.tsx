import { CheckCircle2, ArrowRight } from "lucide-react";
import { useNavigation } from "../../router";
import "../../../styles/legacy/onboarding.css";

/* ─── Complete (Step 4/4) ───────────────────────────────────────── *
 * Final onboarding screen. Large animated green check circle,
 * confirmation message, and a single "Open wallet" CTA that hands
 * control over to the main home view. The success pop animation is
 * defined in ../../../styles/legacy/onboarding.css via .onb-illo.success. */
export function OnboardingCompleteView() {
  const { navigate } = useNavigation();

  return (
    <div className="onb-screen">
      <div className="onb-steps">
        <span className="onb-step-label">Step 4 of 4</span>
        <span className="onb-step-dot done" />
        <span className="onb-step-dot done" />
        <span className="onb-step-dot done" />
        <span className="onb-step-dot done" />
      </div>

      {/* Animated success illustration */}
      <div className="onb-illo success">
        <CheckCircle2 size={44} strokeWidth={2.4} />
      </div>

      <h1 className="onb-headline">Wallet created</h1>
      <p className="onb-subtitle">
        Your Aethelred wallet is ready to use
      </p>

      <div className="onb-body" style={{ justifyContent: "center" }}>
        <div className="onb-card" style={{ textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--ink-soft)",
            }}
          >
            Keys are encrypted and stored locally on this device. The trust
            platform is operational.
          </p>
        </div>
      </div>

      <div className="onb-cta">
        <button
          className="onb-primary"
          onClick={() => navigate("home")}
          type="button"
        >
          Open wallet
          <ArrowRight size={16} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
