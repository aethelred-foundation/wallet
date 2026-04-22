import { useEffect, useRef, useCallback } from "react";

/**
 * useSound — WebAudio-synthesized UI sounds.
 *
 * The wallet needs a handful of audible confirmations (tap, copy,
 * success, error) but bundling .mp3 / .wav assets would inflate the
 * Chrome extension download. Instead we synthesize every sound from
 * OscillatorNode + GainNode envelopes at play time. The entire audio
 * module costs ~120 lines of code and zero kilobytes of audio data.
 *
 * Each sound is a short (< 200ms) amplitude-enveloped oscillator pair
 * chosen to read as discrete UI feedback without being grating:
 *
 *   - playTap()     — single sine tick, 700Hz, 30ms exponential decay
 *   - playCopy()    — soft sine click, 520Hz, 50ms decay
 *   - playSuccess() — two ascending sine notes (C5 → E5), chime-like
 *   - playError()   — descending sawtooth thud, C4 → G3
 *
 * Every function is a *no-op* when:
 *
 *   1. `window.AudioContext` is undefined (very old browsers).
 *   2. The user has muted sounds via Settings (persisted to
 *      `chrome.storage.local.sound-enabled`).
 *   3. The document has never received a user gesture — Chromium
 *      auto-suspends AudioContext until one happens. We try to resume
 *      on each play; if that fails we silently drop the sound.
 *
 * @example
 *   const sound = useSound();
 *   <button onClick={() => { copy(addr); sound.playCopy(); }}>Copy</button>
 */

export interface SoundApi {
  playTap: () => void;
  playCopy: () => void;
  playSuccess: () => void;
  playError: () => void;
  /** Set the user's mute preference and persist it. */
  setMuted: (muted: boolean) => void;
  /** Returns whether sounds are currently enabled + supported. */
  isAvailable: () => boolean;
}

const STORAGE_KEY = "sound-enabled";
/**
 * Master gain for every tone — keeps UI sounds *well* below music levels
 * so they don't startle users on laptop speakers.
 */
const MASTER_GAIN = 0.08;

let cachedEnabled: boolean = true;
let cacheInitialized = false;
let sharedContext: AudioContext | null = null;

function primeCache(): void {
  if (cacheInitialized) return;
  cacheInitialized = true;

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        if (result && STORAGE_KEY in result) {
          cachedEnabled = result[STORAGE_KEY] !== false;
        }
      });
      chrome.storage.onChanged?.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        if (changes[STORAGE_KEY]) {
          cachedEnabled = changes[STORAGE_KEY].newValue !== false;
        }
      });
      return;
    }
  } catch {
    // fall through
  }

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "0" || saved === "false") cachedEnabled = false;
  } catch {
    // private mode
  }
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  if (sharedContext && sharedContext.state !== "closed") {
    return sharedContext;
  }
  try {
    sharedContext = new Ctor();
    return sharedContext;
  } catch {
    return null;
  }
}

/**
 * Play a single oscillator-enveloped tone. Used as a primitive by every
 * higher-level sound.
 *
 * Returns quickly; the sound plays itself out via the Web Audio graph.
 */
function playTone(
  ctx: AudioContext,
  options: {
    type: OscillatorType;
    freq: number;
    endFreq?: number;
    durationMs: number;
    peak: number;
    attackMs?: number;
    delayMs?: number;
  },
): void {
  const { type, freq, endFreq, durationMs, peak, attackMs = 2, delayMs = 0 } = options;
  const startTime = ctx.currentTime + delayMs / 1000;
  const endTime = startTime + durationMs / 1000;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  if (endFreq != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), endTime);
  }

  // Envelope: linear attack, exponential decay (sounds more natural
  // than linear decay — real instruments die off logarithmically).
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak * MASTER_GAIN, startTime + attackMs / 1000);
  gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(endTime + 0.01);

  // Clean up: disconnect after the tone completes so nodes don't pile up.
  osc.onended = () => {
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      // already disconnected
    }
  };
}

function attemptResume(ctx: AudioContext): void {
  if (ctx.state === "suspended" && typeof ctx.resume === "function") {
    // resume() returns a promise; we ignore it — if it rejects (no user
    // gesture yet) the subsequent start() call will be a no-op.
    try {
      void ctx.resume();
    } catch {
      // ignore
    }
  }
}

function canPlay(): boolean {
  return cachedEnabled && typeof window !== "undefined";
}

/* ─── Preset sounds ─────────────────────────────────────────── */

function playTapImpl(): void {
  if (!canPlay()) return;
  const ctx = getContext();
  if (!ctx) return;
  attemptResume(ctx);
  playTone(ctx, { type: "sine", freq: 720, endFreq: 560, durationMs: 40, peak: 0.8 });
}

function playCopyImpl(): void {
  if (!canPlay()) return;
  const ctx = getContext();
  if (!ctx) return;
  attemptResume(ctx);
  // Soft click: two quick sine bursts
  playTone(ctx, { type: "sine", freq: 520, endFreq: 420, durationMs: 50, peak: 0.9 });
  playTone(ctx, {
    type: "sine",
    freq: 680,
    endFreq: 680,
    durationMs: 30,
    peak: 0.4,
    delayMs: 22,
  });
}

function playSuccessImpl(): void {
  if (!canPlay()) return;
  const ctx = getContext();
  if (!ctx) return;
  attemptResume(ctx);
  // Two-note rising chime: C5 (523Hz) → E5 (659Hz)
  playTone(ctx, { type: "sine", freq: 523, durationMs: 140, peak: 0.8 });
  playTone(ctx, {
    type: "sine",
    freq: 659,
    durationMs: 180,
    peak: 1.0,
    delayMs: 80,
  });
}

function playErrorImpl(): void {
  if (!canPlay()) return;
  const ctx = getContext();
  if (!ctx) return;
  attemptResume(ctx);
  // Descending thud: triangle wave, C4 → G3
  playTone(ctx, {
    type: "triangle",
    freq: 262,
    endFreq: 196,
    durationMs: 180,
    peak: 1.0,
  });
}

export function useSound(): SoundApi {
  useEffect(() => {
    primeCache();
  }, []);

  const playTap = useCallback(() => playTapImpl(), []);
  const playCopy = useCallback(() => playCopyImpl(), []);
  const playSuccess = useCallback(() => playSuccessImpl(), []);
  const playError = useCallback(() => playErrorImpl(), []);

  const setMuted = useCallback((muted: boolean) => {
    setSoundEnabled(!muted);
    if (muted && sharedContext && sharedContext.state === "running") {
      // Suspend so the audio thread stops scheduling work
      try {
        void sharedContext.suspend();
      } catch {
        // ignore
      }
    }
  }, []);

  const isAvailable = useCallback(() => {
    return (
      cachedEnabled &&
      typeof window !== "undefined" &&
      !!(
        (window as typeof window & { webkitAudioContext?: unknown }).AudioContext ||
        (window as typeof window & { webkitAudioContext?: unknown }).webkitAudioContext
      )
    );
  }, []);

  const apiRef = useRef<SoundApi | null>(null);
  if (apiRef.current === null) {
    apiRef.current = { playTap, playCopy, playSuccess, playError, setMuted, isAvailable };
  } else {
    apiRef.current.playTap = playTap;
    apiRef.current.playCopy = playCopy;
    apiRef.current.playSuccess = playSuccess;
    apiRef.current.playError = playError;
    apiRef.current.setMuted = setMuted;
    apiRef.current.isAvailable = isAvailable;
  }
  return apiRef.current;
}

/**
 * Reset module-level state. **Test-only.**
 *
 * The `sharedContext` cache + `cachedEnabled` + `cacheInitialized`
 * flags persist for the lifetime of the module — which, in a browser
 * tab, is fine (one AudioContext per popup lifetime). In a test
 * runner, that same module is imported once and the state leaks
 * across test cases, so a mock installed in test A still satisfies
 * `getContext()`'s early return in test B. Under vitest 1 this
 * wasn't caught because the test ordering happened to not exercise
 * the leak path; vitest 4's different test ordering + stricter
 * module isolation surfaces it.
 *
 * Tests that mock `window.AudioContext` should call this in
 * `beforeEach` so `getContext()` re-resolves against the fresh mock
 * rather than returning the cached `sharedContext` from an earlier
 * case.
 */
export function __resetUseSoundForTests(): void {
  sharedContext = null;
  cachedEnabled = true;
  cacheInitialized = false;
}

/**
 * Persist the sound preference. Called from the Settings toggle. Writes
 * to chrome.storage.local with a localStorage fallback.
 */
export function setSoundEnabled(enabled: boolean): void {
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
 * Synchronous read of the current sound preference. Suitable for
 * seeding useState in Settings.
 */
export function isSoundEnabled(): boolean {
  primeCache();
  return cachedEnabled;
}
