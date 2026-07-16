/**
 * Privacy-first crash/error capture (WALLET-06).
 *
 * A wallet must never phone home with secrets. This module is therefore:
 *
 *   - **Opt-in.** Nothing is captured unless the user turns capture ON
 *     (`aethelred-error-capture` = "1"). Default is OFF.
 *   - **Local-only.** Entries live in localStorage. Nothing is transmitted;
 *     the user exports the log themselves and decides what to share on the
 *     support channel.
 *   - **PII/secret sanitized.** Before an error message or stack is stored,
 *     anything resembling a key, address, mnemonic, or long opaque token is
 *     redacted — belt and suspenders, since we never want a seed phrase or
 *     private key to reach even local storage in an error string.
 *   - **Bounded.** A ring buffer of the most recent {@link MAX_ENTRIES}.
 *
 * The per-view error boundary calls `window.__onViewError`; {@link installErrorHook}
 * wires that to {@link captureError}.
 */

export const ERROR_CAPTURE_KEY = "aethelred-error-capture";
export const ERROR_LOG_KEY = "aethelred-error-log";
export const SUPPORT_URL = "https://github.com/aethelred-foundation/wallet/issues";
export const MAX_ENTRIES = 20;

export interface ErrorLogEntry {
  readonly at: number;
  readonly view: string;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/**
 * Redact anything that could carry a secret or PII from free text.
 * Order matters: longer hex (keys/hashes, 64) is matched before shorter
 * hex (addresses, 40) so a private key is never mistaken for two addresses.
 */
export function sanitize(text: string): string {
  if (!text) return "";
  return (
    text
      // 0x-prefixed 64-hex — private keys, hashes, seeds
      .replace(/0x[0-9a-fA-F]{64}/g, "0x⟨redacted-key⟩")
      // 0x-prefixed 40-hex — EVM addresses
      .replace(/0x[0-9a-fA-F]{40}/g, "0x⟨redacted-addr⟩")
      // bech32 aethel1… addresses
      .replace(/\baethel1[0-9a-z]{20,}/g, "aethel1⟨redacted⟩")
      // BIP-39 mnemonic: 12+ consecutive lowercase words
      .replace(/\b([a-z]{3,10}\s+){11,}[a-z]{3,10}\b/g, "⟨redacted-phrase⟩")
      // long opaque tokens (base64/hex blobs ≥ 40 chars) — sigs, proofs, keys
      .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "⟨redacted-token⟩")
  );
}

function isCaptureEnabled(): boolean {
  try {
    return localStorage.getItem(ERROR_CAPTURE_KEY) === "1";
  } catch {
    return false;
  }
}

function readLog(): ErrorLogEntry[] {
  try {
    const raw = localStorage.getItem(ERROR_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ErrorLogEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Capture one error. No-op unless capture is opted in. Returns the stored
 * entry (or null when capture is off / storage is unavailable) so callers
 * and tests can assert behaviour without reading storage back.
 */
export function captureError(
  error: Error,
  view: string = "unknown",
): ErrorLogEntry | null {
  if (!isCaptureEnabled()) return null;

  const entry: ErrorLogEntry = {
    at: Date.now(),
    view: sanitize(view).slice(0, 64),
    name: sanitize(error?.name ?? "Error").slice(0, 64),
    message: sanitize(error?.message ?? "").slice(0, 500),
    stack: error?.stack ? sanitize(error.stack).slice(0, 2000) : undefined,
  };

  try {
    const next = [entry, ...readLog()].slice(0, MAX_ENTRIES);
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private mode / quota) — capture is best-effort
  }
  return entry;
}

/** The captured entries, most recent first. */
export function getErrorLog(): ErrorLogEntry[] {
  return readLog();
}

/** Wipe the captured log. */
export function clearErrorLog(): void {
  try {
    localStorage.removeItem(ERROR_LOG_KEY);
  } catch {
    /* ignore */
  }
}

/** A shareable JSON string of the (already-sanitized) log for the user to export. */
export function exportErrorLog(): string {
  return JSON.stringify(
    { schema: "aethelred-wallet-error-log/v1", exportedAt: Date.now(), entries: readLog() },
    null,
    2,
  );
}

/** Turn capture on/off. */
export function setErrorCaptureEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(ERROR_CAPTURE_KEY, "1");
    else localStorage.removeItem(ERROR_CAPTURE_KEY);
  } catch {
    /* ignore */
  }
}

export function errorCaptureEnabled(): boolean {
  return isCaptureEnabled();
}

/**
 * Wire the per-view error boundary's global hook to {@link captureError}.
 * Call once at popup boot. Safe to call repeatedly (idempotent assignment).
 */
export function installErrorHook(): void {
  (window as unknown as {
    __onViewError?: (error: Error, info: unknown, view?: string) => void;
  }).__onViewError = (error, _info, view) => {
    captureError(error, view ?? "unknown");
  };
}
