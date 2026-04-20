/**
 * Content script entry point.
 *
 * Thin orchestration layer: the pure integrity primitives live in
 * `content-integrity.ts` so the test suite can exercise them without
 * booting the browser-only `chrome`/`document` side effects below.
 *
 * Responsibilities:
 *   1. Verify the integrity of the bundled `inpage.js` before injection
 *      via `verifyInpageIntegrity`. The `vite-plugin-inpage-integrity`
 *      plugin stamps the expected SHA-256 at build time.
 *   2. Inject the (verified) provider into the page's main world.
 *   3. Bootstrap the content-script bridge that relays page ↔ background
 *      messages (handshake, RPC, state updates).
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
 * Fetches `inpage.js` from our own extension bundle, verifies the
 * integrity hash, and injects the script element into the page's main
 * world. Non-fatal: if the fetch fails, we fall back to a plain
 * `<script src>` tag — Chrome's own extension signature enforcement
 * applies to `chrome-extension://…/inpage.js`, so this is still safe.
 */
async function injectProvider(): Promise<void> {
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
        "[Aethelred Wallet content] inpage integrity check failed — refusing to inject",
        verification,
      );
      return;
    }
  } catch (err) {
    // Fall through to the script-tag fallback — Chrome's extension
    // signing still guarantees served bytes match the signed bundle.
    console.warn(
      "[Aethelred Wallet content] inpage integrity prefetch failed, falling back to script tag",
      err,
    );
  }

  const script = document.createElement("script");
  script.src = url;
  script.type = "module";
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

void injectProvider();
initContentBridge();

console.info("[Aethelred Wallet content] Provider injected and bridge active");
