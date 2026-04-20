import { useEffect, useRef, useCallback } from "react";
import { prefersReducedMotion } from "../design/motion";

/**
 * useHaptics — web Vibration API wrapper with iOS-style semantic names.
 *
 * Apple's UIKit ships 5 canonical haptic feedback styles:
 *
 *   - selection()       — light tap for pickers, sliders
 *   - impact(light/med/heavy) — discrete "thump" for state transitions
 *   - notification(success/warning/error) — layered patterns for outcomes
 *
 * The web Vibration API can't deliver tactile impacts as nuanced as
 * Taptic Engine feedback, but it can deliver short pulse patterns that
 * reinforce the same mental model. This hook translates each semantic
 * intent into a Vibration pattern tuned to feel as close as possible to
 * its iOS equivalent on Android devices that still expose vibrate().
 *
 * The hook is a *no-op* in four cases, each silently:
 *
 *   1. `navigator.vibrate` is undefined (iOS Safari, desktop Chromium,
 *      newer Chrome versions that have deprecated the API on desktop).
 *   2. The user has `prefers-reduced-motion: reduce` set — haptics count
 *      as motion for the purposes of accessibility guidance.
 *   3. The user has disabled haptics in Settings (persisted to
 *      `chrome.storage.local.haptics-enabled`).
 *   4. We're running in a test environment without a DOM.
 *
 * We deliberately do NOT throw or log when vibrate() isn't available:
 * call sites should treat haptics as a "nice to have" enhancement, not
 * a requirement. If a button's `onClick` calls `haptics.selection()`
 * on a desktop Chromium, the call returns instantly with no error.
 *
 * @example
 *   function SendButton({ onConfirm }: { onConfirm: () => void }) {
 *     const haptics = useHaptics();
 *     return (
 *       <button
 *         onClick={() => {
 *           haptics.impact("medium");
 *           onConfirm();
 *         }}
 *       >
 *         Send
 *       </button>
 *     );
 *   }
 */

/** Semantic haptic API. All methods are safe to call unconditionally. */
export interface HapticsApi {
  /** Very light tap — picker scroll, toggle slider drag. */
  selection: () => void;
  /** Discrete impact — buttons, tab switches. */
  impact: (strength?: "light" | "medium" | "heavy") => void;
  /** Multi-pulse success pattern — transaction confirmed, copy, approval. */
  success: () => void;
  /** Double pulse warning — about to do something risky. */
  warning: () => void;
  /** Long buzz error — form invalid, reject, network fail. */
  error: () => void;
  /** Returns whether haptics are currently enabled + supported. */
  isAvailable: () => boolean;
}

const STORAGE_KEY = "haptics-enabled";

/**
 * Internal helper that reads the user's haptic preference from
 * `chrome.storage.local`. Falls back to localStorage then to `true` if
 * neither is available (dev mode / first launch).
 *
 * Synchronous: callers need a cheap read per tap. We cache the result in
 * a module-level ref and keep it fresh via a storage-change listener.
 */
let cachedEnabled: boolean = true;
let cacheInitialized = false;

function primeCache(): void {
  if (cacheInitialized) return;
  cacheInitialized = true;

  // chrome.storage.local is async — read once at module init.
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (result && STORAGE_KEY in result) {
          cachedEnabled = result[STORAGE_KEY] !== false;
        }
      });
      // Keep cache fresh when the Settings toggle flips
      chrome.storage.onChanged?.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        if (changes[STORAGE_KEY]) {
          cachedEnabled = changes[STORAGE_KEY].newValue !== false;
        }
      });
      return;
    }
  } catch {
    // chrome.* not available — fall through to localStorage
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "0" || saved === "false") cachedEnabled = false;
  } catch {
    // private mode — default to enabled
  }
}

function isVibrateAvailable(): boolean {
  if (typeof navigator === "undefined") return false;
  // TypeScript's lib.dom.d.ts has `vibrate` on Navigator, but the function
  // can be undefined at runtime on iOS Safari and desktop Chromium ≥ 120.
  return typeof (navigator as Navigator & { vibrate?: unknown }).vibrate === "function";
}

function vibratePattern(pattern: number | number[]): void {
  if (!isVibrateAvailable()) return;
  if (!cachedEnabled) return;
  if (prefersReducedMotion()) return;
  try {
    // Cast because TypeScript's navigator.vibrate returns boolean but we
    // ignore the return value.
    (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate(pattern);
  } catch {
    // Some browsers throw InvalidStateError if document is hidden.
    // Silent fallthrough is correct — haptics are best-effort.
  }
}

/**
 * Vibration patterns tuned to approximate iOS feedback styles. Each
 * pattern is an array of durations alternating vibrate / pause in ms.
 *
 * Design rationale:
 *   - Selection is 5ms — just long enough for the driver to fire, short
 *     enough to feel like a click rather than a buzz.
 *   - Impact scales with strength. 10 / 16 / 24 feels like a faint tap /
 *     solid thump / heavy strike without being annoying.
 *   - Success is three short pulses — same rhythm as iOS haptic success.
 *   - Warning is a two-pulse "ta-ta" with a pause in the middle.
 *   - Error is a single long buzz — unambiguous.
 */
const PATTERNS = {
  selection: 5,
  impactLight: 10,
  impactMedium: 16,
  impactHeavy: 24,
  success: [12, 48, 12, 48, 12],
  warning: [20, 80, 20],
  error: [60],
} as const;

export function useHaptics(): HapticsApi {
  // Prime the cache once per module — the hook just reads it.
  useEffect(() => {
    primeCache();
  }, []);

  const selection = useCallback(() => {
    vibratePattern(PATTERNS.selection);
  }, []);

  const impact = useCallback((strength: "light" | "medium" | "heavy" = "medium") => {
    if (strength === "light") vibratePattern(PATTERNS.impactLight);
    else if (strength === "heavy") vibratePattern(PATTERNS.impactHeavy);
    else vibratePattern(PATTERNS.impactMedium);
  }, []);

  const success = useCallback(() => {
    vibratePattern([...PATTERNS.success]);
  }, []);

  const warning = useCallback(() => {
    vibratePattern([...PATTERNS.warning]);
  }, []);

  const error = useCallback(() => {
    vibratePattern([...PATTERNS.error]);
  }, []);

  const isAvailable = useCallback(() => {
    return isVibrateAvailable() && cachedEnabled && !prefersReducedMotion();
  }, []);

  // Return a stable object so consumer components don't re-render when
  // the hook re-runs. useRef holds the function map.
  const apiRef = useRef<HapticsApi | null>(null);
  if (apiRef.current === null) {
    apiRef.current = { selection, impact, success, warning, error, isAvailable };
  } else {
    // Keep functions fresh (they're stable via useCallback, but keep the
    // object the same identity so memo-consumers don't thrash).
    apiRef.current.selection = selection;
    apiRef.current.impact = impact;
    apiRef.current.success = success;
    apiRef.current.warning = warning;
    apiRef.current.error = error;
    apiRef.current.isAvailable = isAvailable;
  }
  return apiRef.current;
}

/**
 * Persist the haptics preference. Called from Settings toggle. Writes to
 * chrome.storage.local (the authoritative source), with a localStorage
 * fallback for dev mode.
 */
export function setHapticsEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: enabled });
    }
  } catch {
    // fallthrough
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // private mode
  }
}

/**
 * Read the current haptics preference — synchronous. For reactive
 * Settings UIs, subscribe to chrome.storage.onChanged directly or use
 * a useState seeded from this value.
 */
export function isHapticsEnabled(): boolean {
  primeCache();
  return cachedEnabled;
}
