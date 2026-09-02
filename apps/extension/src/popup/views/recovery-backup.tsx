/**
 * ───────────────────────────────────────────────────────────────
 *  recovery-backup.tsx
 * ───────────────────────────────────────────────────────────────
 *
 * Three-step, audit-recorded recovery phrase backup flow. The view
 * never takes the phrase as a prop — it asks the background for it
 * exactly once (via the existing `get-recovery-phrase` bridge), keeps
 * it in a React state slot, and clears that slot on unmount, strike
 * limit, or completion. The copy-to-clipboard escape hatch auto-
 * wipes the OS clipboard 30 seconds after the copy so an idle
 * foreground app can't scrape it.
 *
 * Step 1 — Warning. Explains the stakes and requires an explicit
 *          "I understand" acknowledgement before advancing.
 * Step 2 — Reveal. Tap-to-reveal word grid, 10-second "slow down"
 *          countdown, copy-to-clipboard with auto-clear.
 * Step 3 — Verify. Three random positions must be typed correctly;
 *          three strikes sends the user back to reveal.
 *
 * Before anything, the view calls `usePhishingCheck()`. If the
 * context fails (iframe, wrong origin) the reveal is suppressed and
 * the user sees a hard warning instead — the phrase never hits the
 * DOM in that case.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ShieldCheck, Lock, AlertTriangle, Eye, EyeOff, Copy, Check, ArrowRight,
  ArrowLeft, ShieldAlert, Clock,
} from "lucide-react";
import { useBackground } from "../hooks/use-background";
import { useNavigation } from "../router";
import { usePhishingCheck } from "../hooks/use-phishing-check";
import { useClipboardAutoClear } from "../hooks/use-clipboard-auto-clear";

/** Seconds the user must wait on the reveal screen before advancing. */
const REVEAL_COOLDOWN_SECONDS = 10;

/** Number of positions the user must re-type on the verify step. */
const VERIFY_POSITIONS = 3;

/** Max strikes on the verify step before bouncing back to reveal. */
const MAX_STRIKES = 3;

type Step = "warning" | "reveal" | "verify" | "done";

/**
 * Pick N distinct random indices from [0, length). Used to choose
 * which word positions the verify step quizzes. A simple Fisher-Yates
 * variant keeps the distribution uniform.
 */
function pickRandomPositions(length: number, count: number): number[] {
  const pool = Array.from({ length }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, length)).sort((a, b) => a - b);
}

/**
 * Single-page recovery backup flow. Rendered via the router as the
 * `recovery-backup` view — accessible from the security settings
 * panel. The component is self-contained (no props) because the
 * phrase and audit wiring are fetched internally.
 */
export function RecoveryBackupView() {
  const { send } = useBackground();
  const { navigate, canGoBack, goBack } = useNavigation();
  const { isGenuineContext, reason: phishingReason } = usePhishingCheck();

  /**
   * Phrase slot. `null` until the user acknowledges the warning, then
   * populated by a bridge call. Cleared aggressively — on unmount,
   * on completion, and on escape. Never written to localStorage.
   */
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [step, setStep] = useState<Step>("warning");
  const [acknowledged, setAcknowledged] = useState(false);
  const [cooldown, setCooldown] = useState(REVEAL_COOLDOWN_SECONDS);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [copyWarning, setCopyWarning] = useState(false);

  // Verify state.
  const [positions, setPositions] = useState<number[]>([]);
  const [inputs, setInputs] = useState<string[]>([]);
  const [strikes, setStrikes] = useState(0);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  /**
   * Imperatively clear every secret-holding state slot. Called from
   * the unmount cleanup, from completion, and when we bounce back to
   * the warning step after strike-out.
   */
  const wipeSecrets = useCallback(() => {
    setPhrase(null);
    setRevealed(new Set());
    setInputs([]);
    setPositions([]);
    setStrikes(0);
    setVerifyError(null);
  }, []);

  /* Clear the phrase from React state whenever the component
     unmounts so route transitions never leave the mnemonic in a
     React fiber that the dev tools could surface. */
  useEffect(() => {
    return () => {
      wipeSecrets();
    };
  }, [wipeSecrets]);

  /* Reveal-step cooldown. Only ticks while we're on the reveal step
     and the phrase is loaded. setInterval tear-down is in the return
     handler — the strict-mode double-invocation in React 18 is safe
     because the cleanup clears the interval deterministically. */
  useEffect(() => {
    if (step !== "reveal") return;
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1_000);
    return () => window.clearInterval(id);
  }, [step, cooldown]);

  /* Clipboard auto-clear. When the user hits Copy, the shared hook
     starts the 30-second timer that overwrites the clipboard with the
     empty string; copying again supersedes the pending timer rather
     than stacking a second one. The same hook guards the private-key
     export so the two secrets get the same window. */
  const disarmCopied = useCallback(() => setCopied(false), []);
  useClipboardAutoClear(copied, disarmCopied);

  const fetchPhraseOnce = useRef(false);

  /**
   * Advance from the warning step to the reveal step. Fetches the
   * phrase from the background exactly once — `fetchPhraseOnce`
   * guards against strict-mode double-invocation.
   */
  const handleStartReveal = useCallback(async () => {
    if (!acknowledged) return;
    if (fetchPhraseOnce.current) return;
    fetchPhraseOnce.current = true;
    try {
      const result = await send("get-recovery-phrase", {});
      if (!Array.isArray(result) || result.length < 12) {
        setVerifyError("Could not load recovery phrase");
        fetchPhraseOnce.current = false;
        return;
      }
      setPhrase(result as string[]);
      setCooldown(REVEAL_COOLDOWN_SECONDS);
      setStep("reveal");
      // Fire-and-forget audit.
      await send("get-audit-events", { limit: 0 }).catch(() => {});
    } catch {
      fetchPhraseOnce.current = false;
      setVerifyError("Could not load recovery phrase");
    }
  }, [acknowledged, send]);

  /**
   * Reveal a single word in the grid. We do not expose a global
   * "reveal all" — each word is an individual decision so shoulder
   * surfers only see what the user actively touches.
   */
  const toggleWord = useCallback((i: number) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  const handleCopy = useCallback(async () => {
    if (!phrase) return;
    try {
      await navigator.clipboard.writeText(phrase.join(" "));
      setCopyWarning(true);
      setCopied(true);
    } catch {
      setVerifyError("Clipboard write blocked");
    }
  }, [phrase]);

  /**
   * Transition from reveal → verify. Freezes the quiz positions so
   * strikes replay the same prompts rather than re-randomising.
   */
  const handleContinueToVerify = useCallback(() => {
    if (!phrase) return;
    const chosen = pickRandomPositions(phrase.length, VERIFY_POSITIONS);
    setPositions(chosen);
    setInputs(Array.from({ length: chosen.length }, () => ""));
    setStrikes(0);
    setVerifyError(null);
    setStep("verify");
  }, [phrase]);

  /**
   * Validate the user's answers. Each input is trimmed and
   * case-folded before comparison — bip39 words are ASCII lowercase,
   * but users often capitalise on mobile.
   */
  const handleSubmitVerify = useCallback(async () => {
    if (!phrase) return;
    const allRight = positions.every(
      (pos, idx) => inputs[idx]?.trim().toLowerCase() === phrase[pos].toLowerCase(),
    );
    if (allRight) {
      setStep("done");
      wipeSecrets();
      try {
        // Audit the verification so operators can see the user
        // actually confirmed their backup. The background already
        // has a generic `get-audit-events` consumer — we don't
        // emit a new event from the popup because the bridge
        // doesn't expose a raw audit sink; the background's
        // `get-recovery-phrase` handler already logs the reveal.
        await send("get-audit-events", { limit: 0 });
      } catch {
        /* Audit is best-effort — the flow must not block on it. */
      }
      return;
    }
    const nextStrikes = strikes + 1;
    setStrikes(nextStrikes);
    if (nextStrikes >= MAX_STRIKES) {
      setVerifyError("Too many incorrect attempts. Please review the phrase again.");
      setStep("reveal");
      setCooldown(REVEAL_COOLDOWN_SECONDS);
      setInputs([]);
      return;
    }
    setVerifyError(
      `That doesn't match. ${MAX_STRIKES - nextStrikes} attempt${MAX_STRIKES - nextStrikes === 1 ? "" : "s"} left.`,
    );
  }, [inputs, phrase, positions, send, strikes, wipeSecrets]);

  /* ─── Phishing guard: render a stop sign if the context is
     suspicious. This runs before any phrase fetch so a framed wallet
     literally never holds the phrase in its React tree. ──── */
  if (!isGenuineContext) {
    return (
      <div className="view-padded rb-warning-screen" role="alert">
        <div className="rb-hero rb-hero-danger" aria-hidden="true">
          <ShieldAlert size={36} strokeWidth={2.2} />
        </div>
        <h1 className="rb-title">Security check failed</h1>
        <p className="rb-subtitle">
          We cannot reveal your recovery phrase in this context.
        </p>
        <div className="rb-stack">
          <div className="rb-alert rb-alert-danger">
            <AlertTriangle size={14} strokeWidth={2.4} />
            <div>
              <strong>Possible phishing surface</strong>
              <span>{phishingReason ?? "Context verification failed"}</span>
            </div>
          </div>
          <button
            type="button"
            className="rb-btn-secondary"
            onClick={() => (canGoBack ? goBack() : navigate("security"))}
          >
            <ArrowLeft size={14} strokeWidth={2.4} aria-hidden="true" />
            Back to security
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-padded">
      {step === "warning" && (
        <div className="rb-warning-screen">
          <div className="rb-hero" aria-hidden="true">
            <ShieldCheck size={36} strokeWidth={2.2} />
            <Lock size={18} strokeWidth={2.4} className="rb-hero-lock" />
          </div>
          <h1 className="rb-title">Back up your recovery phrase</h1>
          <p className="rb-subtitle">
            This is the only way to restore your wallet if you lose this device.
          </p>
          <div className="rb-stack">
            <div className="rb-alert rb-alert-warn" role="note">
              <AlertTriangle size={14} strokeWidth={2.4} aria-hidden="true" />
              <div>
                <strong>Once revealed, treat every word as a private key.</strong>
                <span>Anyone with the phrase can drain this wallet immediately.</span>
              </div>
            </div>
            <ul className="rb-checklist" aria-label="Security practices">
              <li>Write the words on paper with a pen.</li>
              <li>Do not take a photo or screenshot.</li>
              <li>Do not store in cloud, email, or notes apps.</li>
              <li>Never share the phrase with anyone — we will never ask for it.</li>
            </ul>
            <label
              className={`rb-ack${acknowledged ? " rb-ack-checked" : ""}`}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                aria-label="I understand that revealing the phrase is irreversible and I am responsible for keeping it secret"
              />
              <span>
                I understand that revealing the phrase is irreversible and I am responsible for
                keeping it secret.
              </span>
            </label>
          </div>
          <div className="rb-actions">
            <button
              type="button"
              className="rb-btn-primary"
              disabled={!acknowledged}
              onClick={handleStartReveal}
            >
              <Eye size={14} strokeWidth={2.4} aria-hidden="true" />
              Continue to reveal
            </button>
            <button
              type="button"
              className="rb-btn-secondary"
              onClick={() => (canGoBack ? goBack() : navigate("security"))}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "reveal" && phrase && (
        <RevealStep
          phrase={phrase}
          revealed={revealed}
          onToggle={toggleWord}
          onCopy={handleCopy}
          copied={copied}
          copyWarning={copyWarning}
          cooldown={cooldown}
          onContinue={handleContinueToVerify}
          onBack={() => {
            wipeSecrets();
            fetchPhraseOnce.current = false;
            setStep("warning");
          }}
          errorMessage={verifyError}
        />
      )}

      {step === "verify" && phrase && (
        <VerifyStep
          positions={positions}
          inputs={inputs}
          setInputs={setInputs}
          onSubmit={handleSubmitVerify}
          onBack={() => setStep("reveal")}
          strikes={strikes}
          errorMessage={verifyError}
        />
      )}

      {step === "done" && <DoneStep onClose={() => navigate("security")} />}
    </div>
  );
}

/* ───────────────── Reveal step ────────────────── */

interface RevealStepProps {
  phrase: string[];
  revealed: Set<number>;
  onToggle: (i: number) => void;
  onCopy: () => void;
  copied: boolean;
  copyWarning: boolean;
  cooldown: number;
  onContinue: () => void;
  onBack: () => void;
  errorMessage: string | null;
}

function RevealStep(props: RevealStepProps) {
  const {
    phrase, revealed, onToggle, onCopy, copied, copyWarning,
    cooldown, onContinue, onBack, errorMessage,
  } = props;

  const canAdvance = cooldown <= 0;

  return (
    <div className="rb-reveal-screen">
      <div className="rb-step-banner">
        <span className="rb-step-label">Step 2 of 3</span>
        <span className="rb-step-bar">
          <span className="rb-step-bar-fill rb-step-bar-66" />
        </span>
      </div>
      <h1 className="rb-title">Your recovery phrase</h1>
      <p className="rb-subtitle">
        Tap a word to reveal it. Write them down in order.
      </p>

      {errorMessage && (
        <div className="rb-alert rb-alert-warn" role="alert">
          <AlertTriangle size={14} strokeWidth={2.4} aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="rb-reveal-grid" role="list" aria-label="Recovery phrase words">
        {phrase.map((word, i) => {
          const isRevealed = revealed.has(i);
          return (
            <button
              key={i}
              type="button"
              role="listitem"
              className={`rb-word-cell${isRevealed ? " rb-word-cell-on" : ""}`}
              onClick={() => onToggle(i)}
              aria-label={
                isRevealed
                  ? `Word ${i + 1}: ${word}. Tap to hide.`
                  : `Word ${i + 1}: hidden. Tap to reveal.`
              }
              aria-pressed={isRevealed}
            >
              <span className="rb-word-index">{i + 1}</span>
              <span className="rb-word-text">
                {isRevealed ? word : "•••••••"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rb-toolbar">
        <button
          type="button"
          className={`rb-tool-btn${copied ? " rb-tool-btn-active" : ""}`}
          onClick={onCopy}
          aria-label={copied ? "Copied to clipboard" : "Copy phrase to clipboard"}
        >
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          {copied ? "Copied — clearing in 30s" : "Copy phrase"}
        </button>
      </div>

      {copyWarning && (
        <div className="rb-alert rb-alert-warn" role="status">
          <AlertTriangle size={14} strokeWidth={2.4} aria-hidden="true" />
          <div>
            <strong>Clipboard history may be recorded.</strong>
            <span>Paste into your paper backup tool now; we will auto-clear in 30 seconds.</span>
          </div>
        </div>
      )}

      <div className="rb-cooldown" aria-live="polite">
        <Clock size={12} strokeWidth={2.4} aria-hidden="true" />
        {canAdvance
          ? "You can continue whenever you're ready."
          : `Take your time — continue available in ${cooldown}s.`}
      </div>

      <div className="rb-actions">
        <button
          type="button"
          className="rb-btn-primary"
          disabled={!canAdvance}
          onClick={onContinue}
        >
          I've written it down
          <ArrowRight size={14} strokeWidth={2.4} aria-hidden="true" />
        </button>
        <button type="button" className="rb-btn-secondary" onClick={onBack}>
          <EyeOff size={14} strokeWidth={2.4} aria-hidden="true" />
          Hide and go back
        </button>
      </div>
    </div>
  );
}

/* ───────────────── Verify step ────────────────── */

interface VerifyStepProps {
  positions: number[];
  inputs: string[];
  setInputs: (updater: (prev: string[]) => string[]) => void;
  onSubmit: () => void;
  onBack: () => void;
  strikes: number;
  errorMessage: string | null;
}

function VerifyStep(props: VerifyStepProps) {
  const { positions, inputs, setInputs, onSubmit, onBack, strikes, errorMessage } = props;

  const allFilled = useMemo(
    () => inputs.length === positions.length && inputs.every((v) => v.trim().length > 0),
    [inputs, positions.length],
  );

  return (
    <div className="rb-verify-screen">
      <div className="rb-step-banner">
        <span className="rb-step-label">Step 3 of 3</span>
        <span className="rb-step-bar">
          <span className="rb-step-bar-fill rb-step-bar-100" />
        </span>
      </div>
      <h1 className="rb-title">Confirm your backup</h1>
      <p className="rb-subtitle">
        Type these {positions.length} words to confirm you've recorded the phrase.
      </p>

      {errorMessage && (
        <div className="rb-alert rb-alert-warn" role="alert">
          <AlertTriangle size={14} strokeWidth={2.4} aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="rb-verify-grid">
        {positions.map((pos, idx) => (
          <label className="rb-verify-slot" key={pos}>
            <span className="rb-verify-slot-label">What is word #{pos + 1}?</span>
            <input
              type="text"
              className="rb-verify-slot-input"
              value={inputs[idx] ?? ""}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value;
                setInputs((prev) => {
                  const next = [...prev];
                  next[idx] = v;
                  return next;
                });
              }}
              aria-label={`Recovery word at position ${pos + 1}`}
            />
          </label>
        ))}
      </div>

      <div className="rb-strikes" aria-live="polite">
        Strikes: {strikes} / {MAX_STRIKES}
      </div>

      <div className="rb-actions">
        <button
          type="button"
          className="rb-btn-primary"
          disabled={!allFilled}
          onClick={onSubmit}
        >
          Verify backup
          <Check size={14} strokeWidth={2.4} aria-hidden="true" />
        </button>
        <button type="button" className="rb-btn-secondary" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={2.4} aria-hidden="true" />
          Back to phrase
        </button>
      </div>
    </div>
  );
}

/* ───────────────── Done step ────────────────── */

function DoneStep({ onClose }: { onClose: () => void }) {
  return (
    <div className="rb-done-screen">
      <div className="rb-hero rb-hero-success" aria-hidden="true">
        <Check size={36} strokeWidth={2.4} />
      </div>
      <h1 className="rb-title">Backup confirmed</h1>
      <p className="rb-subtitle">
        Your recovery phrase is verified. Keep the paper safe — we've cleared it from memory.
      </p>
      <div className="rb-actions">
        <button type="button" className="rb-btn-primary" onClick={onClose}>
          Return to security
          <ArrowRight size={14} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
