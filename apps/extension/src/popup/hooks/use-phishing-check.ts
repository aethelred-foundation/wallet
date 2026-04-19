/**
 * ───────────────────────────────────────────────────────────────
 *  use-phishing-check
 * ───────────────────────────────────────────────────────────────
 *
 * Lightweight runtime attestation for the recovery-phrase reveal
 * screen. A phishing site that framed the wallet in an `<iframe>` or
 * hosted a clone on a look-alike domain could convince a user to
 * paste / display their mnemonic inside it — the damage is total
 * once the words are on-screen, so we refuse to render the reveal
 * unless three invariants hold:
 *
 *   1. The wallet is not embedded (`window.self === window.top`).
 *      Iframes can't read top-level state, so a framed renderer is
 *      by definition under attacker control.
 *   2. The protocol is `chrome-extension:` or `https:`. Mixed-content
 *      or `file://` loads should never trigger a phrase reveal.
 *   3. If we're on `https:`, the hostname is on a small allowlist of
 *      legitimate wallet hosts. The extension's popup always loads
 *      under `chrome-extension://`, but a dev/preview build may run
 *      under an explicit hostname — callers can inject their own
 *      allowlist through env config if needed later.
 *
 * The hook returns the booleans synchronously on first render so
 * conditional renderers (`if (!isGenuineContext) return <Warning />`)
 * can short-circuit before the mnemonic state is ever populated.
 */

import { useMemo } from "react";

/**
 * Return shape of the phishing probe. `isGenuineContext: true` means
 * every invariant above held; otherwise `reason` carries a concise
 * user-facing explanation.
 */
export interface PhishingCheckResult {
  isGenuineContext: boolean;
  reason?: string;
}

/**
 * Hosts the wallet is permitted to run under when served over HTTPS
 * (as opposed to the native `chrome-extension://` scheme). Keep this
 * small and explicit — adding an entry here is a trust decision.
 */
const HTTPS_HOST_ALLOWLIST: ReadonlyArray<string> = [
  "wallet.aethelred.org",
  "app.aethelred.org",
  "localhost",
  "127.0.0.1",
];

/**
 * Evaluate the three invariants and return a tagged result. Pulled
 * into a function so the memoised hook below and the unit tests can
 * share one implementation.
 */
function computeGenuineness(): PhishingCheckResult {
  if (typeof window === "undefined" || typeof location === "undefined") {
    return { isGenuineContext: false, reason: "No window context" };
  }

  // 1. No iframe embedding. If `self !== top`, a parent frame could
  //    mirror inputs and capture revealed secrets.
  try {
    if (window.self !== window.top) {
      return { isGenuineContext: false, reason: "Rendered inside an iframe" };
    }
  } catch {
    // Accessing `window.top` from a cross-origin frame throws. The
    // throw itself is confirmation we're embedded — treat as a fail.
    return { isGenuineContext: false, reason: "Rendered inside a cross-origin frame" };
  }

  // 2. Acceptable protocol.
  const protocol = location.protocol;
  if (protocol !== "chrome-extension:" && protocol !== "https:") {
    return {
      isGenuineContext: false,
      reason: `Unexpected protocol ${protocol || "(unknown)"}`,
    };
  }

  // 3. Hostname allowlist when HTTPS.
  if (protocol === "https:") {
    const host = location.hostname;
    if (!HTTPS_HOST_ALLOWLIST.includes(host)) {
      return {
        isGenuineContext: false,
        reason: `Hostname ${host} is not on the wallet allowlist`,
      };
    }
  }

  return { isGenuineContext: true };
}

/**
 * React hook for the phishing probe. The result is memoised — the
 * invariants depend on `window`/`location`, which are stable for the
 * lifetime of a popup instance, so re-computing on every render is
 * pure waste.
 *
 * @example
 *   const { isGenuineContext, reason } = usePhishingCheck();
 *   if (!isGenuineContext) return <BigWarning reason={reason} />;
 */
export function usePhishingCheck(): PhishingCheckResult {
  return useMemo(computeGenuineness, []);
}
