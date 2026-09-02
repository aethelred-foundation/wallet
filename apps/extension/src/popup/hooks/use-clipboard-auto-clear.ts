import { useEffect } from "react";

/**
 * Window after a secret is copied before the OS clipboard is overwritten.
 * Shared by every view that copies key material so the two flows cannot
 * drift apart: a recovery phrase and a private key deserve the same window.
 */
export const CLIPBOARD_CLEAR_MS = 30_000;

/**
 * useClipboardAutoClear
 * ─────────────────────
 * While `armed` is true, schedules a single timer that overwrites the
 * clipboard with the empty string after CLIPBOARD_CLEAR_MS and then calls
 * `disarm` so the caller's "copied" state falls back in step. Re-arming
 * (copying again) replaces the pending timer rather than stacking a second
 * one, and unmounting clears it — the effect cleanup is the only place the
 * timer is dropped, so there is nothing left ticking once the view is gone.
 *
 * Best-effort by design: clipboard permission can be revoked mid-session
 * and the write may reject. The secret has already left the wallet at that
 * point; there is nothing more useful to do than stop pretending it is
 * still on the clipboard.
 */
export function useClipboardAutoClear(armed: boolean, disarm: () => void): void {
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => {
      try {
        void navigator.clipboard?.writeText("").catch(() => {});
      } catch {
        /* no clipboard in this context */
      }
      disarm();
    }, CLIPBOARD_CLEAR_MS);
    return () => window.clearTimeout(timer);
  }, [armed, disarm]);
}
