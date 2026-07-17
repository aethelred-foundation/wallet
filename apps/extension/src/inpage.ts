/**
 * Inpage provider script - injected into the page's main world.
 * Creates window.ethereum and dispatches EIP-6963 announceProvider events.
 * Communicates with the content script via window.postMessage.
 */

const CHANNEL = "aethelred-wallet-bridge";

type Listener = (...args: unknown[]) => void;

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const eventListeners = new Map<string, Set<Listener>>();

/**
 * Methods that open an approval surface in the wallet (popup / approval
 * queue) and therefore complete at human speed. These MUST NOT be
 * subject to the RPC timeout: MetaMask waits indefinitely while its
 * approval window is open, and dApps are built around that contract.
 * Timing these out desyncs the dApp ("request failed") from the wallet
 * (approval still pending), and a late approval would sign a
 * transaction the dApp already abandoned.
 */
const INTERACTIVE_METHODS = new Set([
  "eth_requestAccounts",
  "eth_sendTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "wallet_addEthereumChain",
  "wallet_switchEthereumChain",
  "wallet_watchAsset",
  "wallet_requestPermissions",
  "wallet_revokePermissions",
  "aethelred_requestIntent",
]);

/** Timeout for non-interactive (read-only node RPC) requests. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Provider state mirrored from responses/events so the legacy
 * synchronous surface (selectedAddress / chainId / networkVersion /
 * isConnected) answers without a round-trip, matching MetaMask.
 */
let cachedAccounts: string[] = [];
let cachedChainId: string | null = null;
let connected = false;

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** UUIDv4 per EIP-6963: MUST be unique per page load; wallet identity
 *  across sessions is carried by `rdns`, not `uuid`. */
function uuidV4(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

/** Mirror account/chain answers into the synchronous legacy surface. */
function absorbResult(method: string, result: unknown): void {
  if ((method === "eth_accounts" || method === "eth_requestAccounts") && Array.isArray(result)) {
    cachedAccounts = result as string[];
  }
  if (method === "eth_chainId" && typeof result === "string") {
    cachedChainId = result;
  }
}

function sendRequest(method: string, params?: readonly unknown[] | object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const correlationId = generateId();
    pending.set(correlationId, {
      resolve: (value) => {
        connected = true;
        absorbResult(method, value);
        resolve(value);
      },
      reject,
    });

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

    // Read-only RPC times out; approval-driven methods wait for the user.
    if (!INTERACTIVE_METHODS.has(method)) {
      setTimeout(() => {
        if (pending.has(correlationId)) {
          pending.delete(correlationId);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, REQUEST_TIMEOUT_MS);
    }
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
      if (evt === "chainChanged" && typeof data === "string") cachedChainId = data;
      if (evt === "accountsChanged" && Array.isArray(data)) cachedAccounts = data as string[];
      if (evt === "connect") {
        connected = true;
        const cid = (data as { chainId?: string } | undefined)?.chainId;
        if (typeof cid === "string") cachedChainId = cid;
      }
      if (evt === "disconnect") connected = false;
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

function once(event: string, listener: Listener) {
  const wrapped: Listener = (...args) => {
    removeListener(event, wrapped);
    listener(...args);
  };
  return on(event, wrapped);
}

function emit(event: string, payload: unknown) {
  const listeners = eventListeners.get(event);
  if (!listeners) return;
  for (const listener of listeners) {
    try { listener(payload); } catch { /* event listeners must not break */ }
  }
}

/** JSON-RPC envelope shapes for the legacy send/sendAsync surface. */
type JsonRpcPayload = { id?: number | string | null; jsonrpc?: string; method: string; params?: readonly unknown[] | object };
type JsonRpcCallback = (error: Error | null, response?: { id: number | string | null; jsonrpc: string; result?: unknown; error?: { code: number; message: string } }) => void;

/**
 * Legacy `sendAsync(payload, callback)` — the pre-EIP-1193 transport
 * still used by ethers v5 Web3Provider and web3.js 1.x. Accepts a
 * single payload or a batch array, answering with JSON-RPC envelopes.
 */
function sendAsync(payload: JsonRpcPayload | JsonRpcPayload[], callback: JsonRpcCallback): void {
  const one = (p: JsonRpcPayload) =>
    sendRequest(p.method, p.params).then(
      (result) => ({ id: p.id ?? null, jsonrpc: p.jsonrpc ?? "2.0", result }),
      (error: Error & { code?: number }) => ({
        id: p.id ?? null,
        jsonrpc: p.jsonrpc ?? "2.0",
        error: { code: error.code ?? -32603, message: error.message },
      }),
    );
  if (Array.isArray(payload)) {
    Promise.all(payload.map(one)).then(
      (responses) => callback(null, responses as unknown as Parameters<JsonRpcCallback>[1]),
      (error: Error) => callback(error),
    );
    return;
  }
  one(payload).then((response) => callback(null, response));
}

/**
 * Legacy `send` — three call shapes survive in the wild:
 *   send(method: string, params?)   → Promise<result>     (ethers v5 JsonRpcProvider)
 *   send(payload, callback)         → sendAsync semantics (web3.js 1.x)
 *   send(payload)                   → Promise<result>     (rare; normalized to request)
 */
function send(
  methodOrPayload: string | JsonRpcPayload | JsonRpcPayload[],
  paramsOrCallback?: readonly unknown[] | object | JsonRpcCallback,
): Promise<unknown> | void {
  if (typeof methodOrPayload === "string") {
    return sendRequest(methodOrPayload, paramsOrCallback as readonly unknown[] | object | undefined);
  }
  if (typeof paramsOrCallback === "function") {
    sendAsync(methodOrPayload, paramsOrCallback as JsonRpcCallback);
    return;
  }
  const single = Array.isArray(methodOrPayload) ? methodOrPayload[0] : methodOrPayload;
  return sendRequest(single.method, single.params);
}

const provider = {
  isAethelred: true,
  isMetaMask: false,
  request,
  on,
  once,
  off: removeListener,
  removeListener,
  emit,
  send,
  sendAsync,
  /** Legacy EIP-1102 connect — alias for eth_requestAccounts. */
  enable(): Promise<unknown> {
    return sendRequest("eth_requestAccounts");
  },
  /** EIP-1193: true once the provider can service RPC requests. */
  isConnected(): boolean {
    return connected;
  },
  /** Legacy synchronous surface, mirrored from responses/events. */
  get selectedAddress(): string | null {
    return cachedAccounts[0] ?? null;
  },
  get chainId(): string | null {
    return cachedChainId;
  },
  get networkVersion(): string | null {
    return cachedChainId ? String(parseInt(cachedChainId, 16)) : null;
  },
};

// Expose as window.ethereum for MetaMask-compatible dApps
if (!(window as unknown as Record<string, unknown>).ethereum) {
  (window as unknown as Record<string, unknown>).ethereum = provider;
}

// Always reachable under a wallet-specific handle, even when another
// wallet owns window.ethereum. EIP-6963 remains the discovery path.
(window as unknown as Record<string, unknown>).aethelred = provider;

// EIP-6963: Announce provider for wallet discovery
const announceInfo = Object.freeze({
  uuid: uuidV4(),
  name: "Aethelred Wallet",
  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='20' fill='%23111a24'/%3E%3Cpath d='M17 45L31 15l16 30h-8l-2.4-5H27.5L25 45h-8zm14-12h2.8L32.4 30 31 33z' fill='%23f5efe6'/%3E%3C/svg%3E",
  rdns: "org.aethelred.wallet",
});

function announceEIP6963() {
  window.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", {
      detail: Object.freeze({ info: announceInfo, provider }),
    })
  );
}

window.addEventListener("eip6963:requestProvider", announceEIP6963);
announceEIP6963();

// Warm the synchronous legacy surface (chainId/networkVersion/accounts)
// the way MetaMask does on injection. Fire-and-forget: failures simply
// leave the cache empty until the dApp's first real request.
sendRequest("eth_chainId").catch(() => { /* cache stays cold */ });
sendRequest("eth_accounts").catch(() => { /* cache stays cold */ });

console.info("[Aethelred Wallet] Provider injected into page");
