import { useCallback } from "react";
import type { BridgeMessage, BridgeMessageKind } from "@aethelred/wallet-connect";

/**
 * Check whether we're running inside a real Chrome extension context.
 *
 * This check used to live at module scope (`const isExtensionContext =
 * ...` at import time) which made it impossible to mock `chrome.runtime`
 * from tests: the check was frozen when the module was first loaded,
 * long before any test setup code could install a fake global. Moving
 * it into the function body means it evaluates per-call, which is both
 * test-friendly and slightly more resilient if `chrome.runtime` becomes
 * available mid-session (e.g., extension reload).
 */
function hasExtensionContext(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.runtime !== "undefined" &&
    !!chrome.runtime.id
  );
}

/**
 * Sends a message to the background service worker and returns the response.
 * Security-sensitive wallet operations fail closed outside a packaged
 * extension; preview builds must inject an explicit mock provider in tests.
 */
export function useBackground() {
  const send = useCallback(
    async (kind: BridgeMessageKind, payload: unknown): Promise<unknown> => {
      if (!hasExtensionContext()) {
        throw new Error(
          `Wallet background is unavailable for “${kind}”. Open the packaged extension to perform wallet operations.`,
        );
      }

      return new Promise((resolve, reject) => {
        const msg: BridgeMessage = {
          kind,
          correlationId: `${kind}-${Date.now()}`,
          payload,
          timestamp: Date.now(),
        };

        chrome.runtime.sendMessage(msg, (response: BridgeMessage) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          const p = response?.payload as { result?: unknown; error?: { message: string } };
          if (p?.error) {
            reject(new Error(p.error.message));
          } else {
            resolve(p?.result);
          }
        });
      });
    },
    []
  );

  return { send };
}
