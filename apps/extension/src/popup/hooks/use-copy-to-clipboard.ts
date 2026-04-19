import { useCallback, useRef, useState } from "react";

/**
 * useCopyToClipboard
 * ──────────────────
 * A tiny state hook that wraps `navigator.clipboard.writeText()` and
 * exposes a transient "copied" flag so UI components can show a
 * checkmark / scale animation / toast for 2 seconds without the parent
 * managing its own timer.
 *
 * Returns:
 *   - copy(text, label?): Promise<void> — writes to clipboard, optionally
 *     emits a toast via the caller's own useToast integration
 *   - copied: string | null — the last successfully copied label (used
 *     for UI feedback like `copied === "address"`)
 *   - error: Error | null — the last error, if any
 *   - isPending: boolean — true during the async write
 *
 * The `copied` flag auto-resets after 2 seconds so the caller doesn't
 * need a setTimeout. If copy is called again before the 2s elapses,
 * the previous timer is cleared (no leaks).
 *
 * Example:
 *   const { copy, copied } = useCopyToClipboard();
 *   <button onClick={() => copy(address, "addr")}>
 *     {copied === "addr" ? <Check /> : <Copy />}
 *   </button>
 */
export interface UseCopyToClipboardResult {
  copy: (text: string, label?: string) => Promise<boolean>;
  copied: string | null;
  error: Error | null;
  isPending: boolean;
  /** Manually reset the copied label (rarely needed) */
  reset: () => void;
}

export function useCopyToClipboard(
  resetAfterMs: number = 2000,
): UseCopyToClipboardResult {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const reset = useCallback(() => {
    clearTimer();
    setCopied(null);
    setError(null);
  }, []);

  const copy = useCallback(
    async (text: string, label: string = "default"): Promise<boolean> => {
      clearTimer();
      setError(null);
      setIsPending(true);
      try {
        // Prefer modern clipboard API; fall back to execCommand for
        // contexts without HTTPS (shouldn't happen inside the extension
        // popup but cheap insurance).
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          // eslint-disable-next-line deprecation/deprecation
          const ok = document.execCommand("copy");
          document.body.removeChild(textarea);
          if (!ok) throw new Error("execCommand(\"copy\") returned false");
        }
        setCopied(label);
        setIsPending(false);
        timerRef.current = window.setTimeout(() => {
          setCopied(null);
          timerRef.current = null;
        }, resetAfterMs);
        return true;
      } catch (err) {
        setError(err as Error);
        setIsPending(false);
        // eslint-disable-next-line no-console
        console.warn("[use-copy-to-clipboard] Failed to copy:", err);
        return false;
      }
    },
    [resetAfterMs],
  );

  return { copy, copied, error, isPending, reset };
}
