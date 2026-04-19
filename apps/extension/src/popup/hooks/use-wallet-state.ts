import { useEffect, useState } from "react";
import { createDemoConnectKernel, type AethelredWalletState, type BridgeMessage } from "@aethelred/wallet-connect";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

interface WalletStateResult {
  state: AethelredWalletState | null;
  lockState: { locked: boolean; initialized: boolean } | null;
  loading: boolean;
  isDevMode: boolean;
  contextError: string | null;
}

const isExtensionContext =
  typeof chrome !== "undefined" &&
  typeof chrome.runtime !== "undefined" &&
  !!chrome.runtime.id;

/**
 * Subscribe to wallet state updates from the background service worker.
 * Falls back to the demo kernel when running in the dev server (not as extension).
 */
export function useWalletState(): WalletStateResult {
  const [state, setState] = useState<AethelredWalletState | null>(null);
  const [lockState, setLockState] = useState<{ locked: boolean; initialized: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);

  useEffect(() => {
    if (!isExtensionContext) {
      if (IS_PRODUCTION_BUILD) {
        setContextError(
          "Aethelred Wallet production builds require the signed browser extension context. The popup preview stays unavailable outside the extension.",
        );
        setLockState({ locked: false, initialized: true });
        setLoading(false);
        return;
      }

      // Dev mode: use demo kernel for preview
      const kernel = createDemoConnectKernel();
      setState(kernel.getState());
      setLockState({ locked: false, initialized: true });
      setLoading(false);
      setContextError(null);

      const unsub = kernel.subscribe((s) => setState(s));
      return unsub;
    }

    // Extension mode: communicate with background service worker (with retry)
    const sendWithRetry = (msg: BridgeMessage, retries = 3, delay = 500) => {
      chrome.runtime.sendMessage(msg, (response: BridgeMessage) => {
        if (chrome.runtime.lastError) {
          if (retries > 0) {
            setTimeout(() => sendWithRetry(msg, retries - 1, delay * 2), delay);
          } else {
            setLoading(false);
          }
          return;
        }
        const payload = response?.payload as {
          result?: AethelredWalletState;
          lockState?: { locked: boolean; initialized: boolean };
        };
        if (payload?.result) setState(payload.result);
        if (payload?.lockState) setLockState(payload.lockState);
        setContextError(null);
        setLoading(false);
      });
    };

    const initMsg: BridgeMessage = {
      kind: "popup-ready",
      correlationId: `init-${Date.now()}`,
      payload: {},
      timestamp: Date.now(),
    };

    sendWithRetry(initMsg);

    const listener = (message: BridgeMessage) => {
      if (message.kind === "state-update" && message.payload) {
        setState(message.payload as AethelredWalletState);
      }
      if (message.kind === "lock-state" && message.payload) {
        setLockState(message.payload as { locked: boolean; initialized: boolean });
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  return {
    state,
    lockState,
    loading,
    isDevMode: !isExtensionContext,
    contextError,
  };
}
