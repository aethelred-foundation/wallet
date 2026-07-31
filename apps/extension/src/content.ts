/**
 * Content script entry point.
 *
 * Thin orchestration layer: the pure integrity primitives live in
 * `content-integrity.ts` so the test suite can exercise them without
 * booting the browser-only `chrome`/`document` side effects below.
 *
 * Responsibilities:
 *   1. Verify the integrity of the bundled `inpage.js` via
 *      `verifyInpageIntegrity`. The `vite-plugin-inpage-integrity` plugin
 *      stamps the expected SHA-256 at build time.
 *   2. Bootstrap the isolated-world bridge that relays page ↔ background
 *      messages (handshake, RPC, state updates).
 *
 * The manifest loads `inpage.js` directly as a MAIN-world content script.
 * That browser-managed path is not blocked by a dApp's Content-Security-Policy.
 * Do not reintroduce script-element injection here: strict CSP pages reject
 * `chrome-extension://` script tags, leaving `window.aethelred` undefined.
 */

import { initContentBridge } from "./content-bridge";
import {
  verifyInpageIntegrity,
  INPAGE_INTEGRITY_SENTINEL,
} from "./content-integrity";

/**
 * Build-time-stamped expected SHA-256 of `inpage.js`. The sentinel is
 * rewritten by `vite-plugin-inpage-integrity.ts` during the Rollup
 * `generateBundle` phase. If left at the sentinel value, the integrity
 * helper treats it as a dev build and skips the check.
 */
export const EXPECTED_INPAGE_HASH: string = INPAGE_INTEGRITY_SENTINEL;

// Re-export the pure helper so external callers (tests, audit tooling)
// can continue to `import { verifyInpageIntegrity } from "../content"`.
// The actual implementation lives in content-integrity.ts.
export { verifyInpageIntegrity } from "./content-integrity";
export type { IntegrityResult } from "./content-integrity";

/**
 * Fetch `inpage.js` from our own extension bundle and verify the stamped
 * integrity hash. Loading is owned by the manifest's MAIN-world content
 * script entry; this check is diagnostic and never falls back to a DOM
 * script element.
 */
async function verifyProviderBundle(): Promise<void> {
  const url = chrome.runtime.getURL("inpage.js");
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`fetch ${url} → HTTP ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    const verification = await verifyInpageIntegrity(EXPECTED_INPAGE_HASH, bytes);
    if (!verification.ok) {
      console.error(
        "[Aethelred Wallet content] inpage integrity check failed",
        verification,
      );
    }
  } catch (err) {
    console.warn(
      "[Aethelred Wallet content] inpage integrity verification unavailable",
      err,
    );
  }
}

void verifyProviderBundle();
initContentBridge();

console.info("[Aethelred Wallet content] Provider bridge active");
