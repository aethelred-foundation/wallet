/**
 * ───────────────────────────────────────────────────────────────
 *  onboarding/passkey.tsx — "Set up a passkey" step
 * ───────────────────────────────────────────────────────────────
 *
 * Inserted into the onboarding ladder between the recovery phrase
 * reveal and the final "complete" screen. The step is strictly
 * optional: the "Skip for now" affordance always advances to the
 * completion screen so users without a compatible authenticator
 * (older desktops, restricted managed devices) are never blocked.
 *
 * On enrollment success the step advances automatically; on failure
 * we surface a short message and keep the user on the screen so
 * they can retry or skip. The subject id used for `user.id` comes
 * from sessionStorage (populated by create-wallet) when available
 * and falls back to a short ephemeral identifier otherwise — the
 * identifier is opaque to the authenticator.
 */

import { useEffect, useState } from "react";
import {
  Fingerprint, Scan, ShieldCheck, ArrowRight, ArrowLeft, AlertTriangle, Check,
} from "lucide-react";
import { useNavigation } from "../../router";
import { usePasskeyEnrollment } from "../../hooks/use-passkey-enrollment";
import "../../../styles/legacy/onboarding.css";

export function OnboardingPasskeyView() {
  const { navigate } = useNavigation();
  const { enroll, verifySupport, enrolling } = usePasskeyEnrollment();
  const [support, setSupport] = useState<{ supported: boolean; reason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /* Probe the UA on mount so we can fail fast when there is no
     platform authenticator — the button still renders, but in a
     disabled/explanatory state rather than a hard "Try again". */
  useEffect(() => {
    let cancelled = false;
    verifySupport().then((r) => {
      if (!cancelled) setSupport(r);
    });
    return () => {
      cancelled = true;
    };
  }, [verifySupport]);

  const handleEnroll = async () => {
    setError(null);
    const userId =
      sessionStorage.getItem("onboarding-subject-id") ??
      `aethelred-${Date.now().toString(36)}`;
    const userName =
      sessionStorage.getItem("onboarding-subject-name") ?? "aethelred-user";
    const result = await enroll({
      userId,
      userName,
      userDisplayName: "Aethelred Wallet",
      rpName: "Aethelred Wallet",
      label: "Primary passkey",
    });
    if (!result.ok) {
      setError(result.error ?? "Enrollment failed");
      return;
    }
    setDone(true);
    // Hold on the success state briefly so the user sees the badge
    // before the router swaps the view out.
    setTimeout(() => navigate("onboarding-complete"), 900);
  };

  return (
    <div className="onb-screen">
      <div className="onb-steps">
        <span className="onb-step-label">Step 3 of 4</span>
        <span className="onb-step-dot done" />
        <span className="onb-step-dot done" />
        <span className="onb-step-dot active" />
        <span className="onb-step-dot" />
      </div>

      <div className="onb-illo">
        {done ? <Check size={40} strokeWidth={2.4} /> : <Fingerprint size={40} strokeWidth={2.2} />}
      </div>

      <h1 className="onb-headline">Add a passkey</h1>
      <p className="onb-subtitle">
        Use Touch ID, Windows Hello, or your device screen-lock for a second
        factor on unlock.
      </p>

      <div className="onb-body">
        <div className="onb-card">
          <div className="onb-card-row">
            <div className="onb-card-row-icon">
              <ShieldCheck size={16} strokeWidth={2.4} />
            </div>
            <div>
              <strong>Phishing-resistant</strong>
              <span>Passkeys cannot be copy-pasted into a fake site.</span>
            </div>
          </div>
          <div className="onb-card-row">
            <div className="onb-card-row-icon">
              <Scan size={16} strokeWidth={2.4} />
            </div>
            <div>
              <strong>Device-bound</strong>
              <span>The private key never leaves your secure enclave.</span>
            </div>
          </div>
        </div>

        {support && !support.supported && (
          <div className="onb-warn" role="note">
            <AlertTriangle size={16} strokeWidth={2.4} />
            <div className="onb-warn-body">
              <strong>This device cannot enrol a passkey</strong>
              {support.reason ?? "Your browser does not support platform authenticators."}
              {" "}You can add one later from Security settings.
            </div>
          </div>
        )}

        {error && (
          <div className="onb-warn" role="alert">
            <AlertTriangle size={16} strokeWidth={2.4} />
            <div className="onb-warn-body">
              <strong>Enrollment failed</strong>
              {error}
            </div>
          </div>
        )}
      </div>

      <div className="onb-cta">
        <button
          className="onb-primary"
          onClick={handleEnroll}
          type="button"
          disabled={enrolling || done || (support !== null && !support.supported)}
        >
          {done ? (
            <>
              <Check size={16} strokeWidth={2.4} /> Passkey enrolled
            </>
          ) : enrolling ? (
            <>Creating passkey…</>
          ) : (
            <>
              <Fingerprint size={16} strokeWidth={2.4} />
              Enrol passkey
            </>
          )}
        </button>
        <button
          className="onb-link"
          onClick={() => navigate("onboarding-complete")}
          type="button"
          disabled={enrolling}
        >
          Skip for now
          <ArrowRight size={12} strokeWidth={2.4} />
        </button>
        <button
          className="onb-link"
          onClick={() => navigate("onboarding-recovery")}
          type="button"
          disabled={enrolling}
        >
          <ArrowLeft size={12} strokeWidth={2.4} />
          Back
        </button>
      </div>
    </div>
  );
}
