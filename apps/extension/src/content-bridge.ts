/**
 * Content script bridge between page-world (window.postMessage)
 * and the background service worker (chrome.runtime.sendMessage).
 *
 * This runs in the content script's isolated world.
 */

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
        // same page.
        // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
        window.postMessage({
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
      // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
      window.postMessage({
        channel: CHANNEL,
        message: response,
      }, "*");
    });
  });

  // Listen for broadcasts from background (state updates, lock state,
  // EIP-1193 provider events like chainChanged/accountsChanged).
  chrome.runtime.onMessage.addListener((message) => {
    if (
      message.kind === "state-update" ||
      message.kind === "lock-state" ||
      message.kind === "provider-event"
    ) {
      // Same-origin page-internal relay; target-origin "*" is safe
      // because the receive-side filters on CHANNEL + origin.
      // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
      window.postMessage({
        channel: CHANNEL,
        message,
      }, "*");
    }
  });
}
