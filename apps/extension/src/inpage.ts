/**
 * Inpage provider script - injected into the page's main world.
 * Creates window.ethereum and dispatches EIP-6963 announceProvider events.
 * Communicates with the content script via window.postMessage.
 */

const CHANNEL = "aethelred-wallet-bridge";
const PROVIDER_UUID = "aethelred-wallet-alpha";

type Listener = (...args: unknown[]) => void;

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const eventListeners = new Map<string, Set<Listener>>();

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * EIP-1193 `request`. The standard — and every mainstream dApp library
 * (wagmi, viem, ethers) — calls `request({ method, params })` with a SINGLE
 * args object. A legacy minority still call `request(method, params)`
 * positionally, so both are accepted. Getting this wrong makes the provider
 * treat the whole args object as the method name, and every call fails with
 * "Unknown method: [object Object]".
 */
function request(
  argsOrMethod:
    | { method: string; params?: readonly unknown[] | object }
    | string,
  maybeParams?: readonly unknown[] | object,
): Promise<unknown> {
  const method =
    typeof argsOrMethod === "string" ? argsOrMethod : argsOrMethod?.method;
  const params =
    typeof argsOrMethod === "string"
      ? maybeParams
      : argsOrMethod?.params;
  return sendRequest(method, params);
}

function sendRequest(method: string, params?: readonly unknown[] | object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const correlationId = generateId();
    pending.set(correlationId, { resolve, reject });

    // Target "*" is intentional: inpage.js runs in the dApp page's
    // main world and posts to the content script, which is also on
    // the same page (isolated world, same origin). The receive-side
    // (content-bridge.ts) filters by `event.data.channel === CHANNEL`
    // and verifies the origin is the tab's own origin — that's the
    // real boundary. Narrowing targetOrigin here would not change
    // the security model because both sides are the same page.
    window.postMessage({ // nosemgrep: javascript.browser.security.wildcard-postmessage-configuration.wildcard-postmessage-configuration
      channel: CHANNEL,
      message: {
        kind: "rpc-request",
        correlationId,
        payload: { method, params },
        timestamp: Date.now(),
      },
    }, "*");

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pending.has(correlationId)) {
        pending.delete(correlationId);
        reject(new Error(`Request timeout: ${method}`));
      }
    }, 60_000);
  });
}

// Listen for responses from the content script
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data?.channel || event.data.channel !== CHANNEL) return;

  const msg = event.data.message;
  if (!msg) return;

  if (msg.kind === "rpc-response" && msg.correlationId) {
    const handler = pending.get(msg.correlationId);
    if (handler) {
      pending.delete(msg.correlationId);
      const payload = msg.payload as { result?: unknown; error?: { code: number; message: string } };
      if (payload.error) {
        const err = new Error(payload.error.message);
        (err as unknown as Record<string, unknown>).code = payload.error.code;
        handler.reject(err);
      } else {
        handler.resolve(payload.result);
      }
    }
  }

  if (msg.kind === "state-update" || msg.kind === "lock-state") {
    emit("aethelred:stateChanged", msg.payload);
  }

  /* EIP-1193 provider events.
   * When the wallet switches networks, adds/removes accounts, or
   * locks/unlocks, `background.ts` broadcasts via `broadcastProviderEvent`.
   * The content-bridge forwards it to this inpage context, and we
   * fan it out to anyone listening via `window.ethereum.on(...)`.
   * Standard events per EIP-1193:
   *   - "chainChanged"    → (chainId: string)
   *   - "accountsChanged" → (accounts: string[])
   *   - "connect"         → ({chainId: string})
   *   - "disconnect"      → ({code: number, message: string})
   *   - "message"         → ({type: string, data: unknown})
   */
  if (msg.kind === "provider-event") {
    const evt = (msg.payload as { event?: string; data?: unknown })?.event;
    const data = (msg.payload as { event?: string; data?: unknown })?.data;
    if (typeof evt === "string") {
      emit(evt, data);
    }
  }
});

function on(event: string, listener: Listener) {
  const listeners = eventListeners.get(event) ?? new Set();
  listeners.add(listener);
  eventListeners.set(event, listeners);
  return provider;
}

function removeListener(event: string, listener: Listener) {
  const listeners = eventListeners.get(event);
  listeners?.delete(listener);
  return provider;
}

function emit(event: string, payload: unknown) {
  const listeners = eventListeners.get(event);
  if (!listeners) return;
  for (const listener of listeners) {
    try { listener(payload); } catch { /* event listeners must not break */ }
  }
}

const provider = {
  isAethelred: true,
  isMetaMask: false,
  request,
  on,
  removeListener,
  emit,
};

// Expose as window.ethereum for MetaMask-compatible dApps
if (!(window as unknown as Record<string, unknown>).ethereum) {
  (window as unknown as Record<string, unknown>).ethereum = provider;
}

// EIP-6963: Announce provider for wallet discovery
const announceInfo = {
  uuid: PROVIDER_UUID,
  name: "Aethelred Wallet",
  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='20' fill='%23111a24'/%3E%3Cpath d='M17 45L31 15l16 30h-8l-2.4-5H27.5L25 45h-8zm14-12h2.8L32.4 30 31 33z' fill='%23f5efe6'/%3E%3C/svg%3E",
  rdns: "org.aethelred.wallet",
};

function announceEIP6963() {
  window.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", {
      detail: { info: announceInfo, provider },
    })
  );
}

window.addEventListener("eip6963:requestProvider", announceEIP6963);
announceEIP6963();

console.info("[Aethelred Wallet] Provider injected into page");
