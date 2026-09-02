/**
 * Content script bridge between page-world (window.postMessage)
 * and the background service worker (chrome.runtime.sendMessage).
 *
 * This runs in the content script's isolated world.
 */

import { isScopedProviderEventForOrigin } from "./content-provider-event-scope";

const CHANNEL = "aethelred-wallet-bridge";

/**
 * Forward messages from the page's inpage.ts to the background.
 */
export function initContentBridge(): void {
  // Page → Content → Background
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data?.channel || event.data.channel !== CHANNEL) return;

    const msg = event.data.message;
    if (!msg || msg.kind !== "rpc-request") return;

    // Add the tab's origin for the background to verify
    const enriched = {
      ...msg,
      origin: window.location.origin,
    };

    chrome.runtime.sendMessage(enriched, (response) => {
      if (chrome.runtime.lastError) {
        // Target "*" is intentional: the content script is posting back
        // into its OWN tab's main world, which is by definition the
        // same origin as `window.location.origin`. The receive-side
        // (inpage.ts) filters by `event.data.channel === CHANNEL`,
        // which is the real boundary. Passing `window.location.origin`
        // instead would still accept the message — target-origin
        // narrowing can't improve security when both ends are the
        // same page. Suppress trailing-inline to handle either
        // position-based or call-site-based semgrep matching.
        window.postMessage({ // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
          channel: CHANNEL,
          message: {
            kind: "rpc-response",
            correlationId: msg.correlationId,
            payload: {
              error: { code: -32603, message: "Extension communication error" },
            },
            timestamp: Date.now(),
          },
        }, "*");
        return;
      }

      // Background → Content → Page: same-origin page-internal relay.
      // See rationale on the sibling post above.
      window.postMessage({ // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
        channel: CHANNEL,
        message: response,
      }, "*");
    });
  });

  // Listen for session-scoped EIP-1193 provider events. Internal wallet and
  // lock-state broadcasts belong to extension pages only and are never
  // relayed into page world (or converted into a page-observable re-fetch).
  chrome.runtime.onMessage.addListener((message) => {
    if (!isScopedProviderEventForOrigin(message, window.location.origin)) return;

    // Same-origin page-internal relay; target-origin "*" is safe because the
    // receive-side filters on CHANNEL and the event above is bound to this
    // exact browser origin + session before crossing into page world.
    window.postMessage({ // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
      channel: CHANNEL,
      // The session binding is a content-script authorization primitive, not
      // page API data. Strip it after validation and expose only EIP-1193's
      // event/data pair to the inpage provider.
      message: {
        kind: message.kind,
        correlationId: message.correlationId,
        payload: {
          event: message.payload.event,
          data: message.payload.data,
        },
        timestamp: message.timestamp,
      },
    }, "*");
  });
}
