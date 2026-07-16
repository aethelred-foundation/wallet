/**
 * MetaMask-parity surface of the inpage provider.
 *
 * dApps in the wild reach the wallet through four generations of API:
 *   1. EIP-6963 discovery (wagmi/mipd wallet pickers) — uuid MUST be a
 *      fresh UUIDv4 per page load, identity carried by rdns.
 *   2. EIP-1193 request() — covered by inpage-request-forms.test.ts.
 *   3. Legacy synchronous surface — selectedAddress / chainId /
 *      networkVersion / isConnected(), primed from responses and events.
 *   4. Pre-1193 transports — enable() / send() / sendAsync() as still
 *      emitted by ethers v5 Web3Provider and web3.js 1.x.
 *
 * Approval-driven methods (eth_sendTransaction, personal_sign, ...) must
 * NOT time out: MetaMask waits for the user indefinitely and dApps are
 * built around that contract. Read-only RPC keeps the 60s timeout.
 *
 * The inpage script is a side-effect entry; the tests import it once and
 * talk to it over the same window.postMessage frames the content script
 * would use.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const CHANNEL = "aethelred-wallet-bridge";

type RpcRequestFrame = {
  channel?: string;
  message?: {
    kind?: string;
    correlationId?: string;
    payload?: { method?: string; params?: unknown };
  };
};

type Eip1193Provider = {
  isAethelred?: boolean;
  isMetaMask?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  enable: () => Promise<unknown>;
  send: (
    methodOrPayload: unknown,
    paramsOrCallback?: unknown,
  ) => Promise<unknown> | void;
  sendAsync: (
    payload: unknown,
    callback: (error: Error | null, response?: unknown) => void,
  ) => void;
  isConnected: () => boolean;
  once: (event: string, listener: (...args: unknown[]) => void) => unknown;
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  selectedAddress: string | null;
  chainId: string | null;
  networkVersion: string | null;
};

function getProvider(): Eip1193Provider {
  return (window as unknown as { ethereum: Eip1193Provider }).ethereum;
}

/** Capture the next rpc-request frame matching `method`. */
function nextRequestFor(method: string): Promise<{ correlationId: string; params: unknown }> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const frame = event.data as RpcRequestFrame;
      if (
        frame?.channel === CHANNEL &&
        frame.message?.kind === "rpc-request" &&
        frame.message.payload?.method === method &&
        frame.message.correlationId
      ) {
        window.removeEventListener("message", onMessage);
        resolve({ correlationId: frame.message.correlationId, params: frame.message.payload.params });
      }
    };
    window.addEventListener("message", onMessage);
  });
}

/**
 * Deliver a frame to the inpage listener the way content-bridge.ts would.
 *
 * Dispatched as a synthetic MessageEvent rather than window.postMessage:
 * the inpage listener (correctly) drops frames whose `event.source` is
 * not the window itself, and the DOM test environment delivers
 * postMessage events with `source: null` — a harness limitation, not a
 * browser behavior. Explicitly stamping `source: window` exercises the
 * same code path a real page sees.
 */
function deliverFrame(message: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { channel: CHANNEL, message },
      source: window,
    }),
  );
}

/** Answer a captured request the way content-bridge.ts would. */
function respond(correlationId: string, payload: { result?: unknown; error?: { code: number; message: string } }): void {
  deliverFrame({ kind: "rpc-response", correlationId, payload, timestamp: Date.now() });
}

/** Emit a provider event the way background → content-bridge would. */
function emitProviderEvent(event: string, data: unknown): void {
  deliverFrame({ kind: "provider-event", payload: { event, data } });
}

const capturedAnnouncements: Array<{ info: { uuid: string; name: string; rdns: string; icon: string }; provider: unknown }> = [];
window.addEventListener("eip6963:announceProvider", ((event: CustomEvent) => {
  capturedAnnouncements.push(event.detail);
}) as EventListener);

beforeAll(async () => {
  // @ts-expect-error inpage.ts is a side-effect entry script (no exports).
  await import("../inpage");
  // Drain the injection-time eth_chainId/eth_accounts warm-up frames so
  // per-test captures below never race against them.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EIP-6963 announcement", () => {
  it("announces with a spec-valid UUIDv4 and the stable Aethelred rdns", async () => {
    const before = capturedAnnouncements.length;
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(capturedAnnouncements.length).toBeGreaterThan(before);
    const detail = capturedAnnouncements[capturedAnnouncements.length - 1];
    expect(detail.info.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(detail.info.rdns).toBe("org.aethelred.wallet");
    expect(detail.info.name).toBe("Aethelred Wallet");
    expect(detail.info.icon.startsWith("data:image/svg+xml")).toBe(true);
    expect(detail.provider).toBe(getProvider());
  });

  it("re-announces the same provider on every requestProvider event", async () => {
    const before = capturedAnnouncements.length;
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fresh = capturedAnnouncements.slice(before);
    expect(fresh.length).toBeGreaterThanOrEqual(2);
    const uuids = new Set(fresh.map((d) => d.info.uuid));
    expect(uuids.size).toBe(1); // stable within a page load
  });

  it("exposes the provider under window.aethelred even when window.ethereum is contested", () => {
    const aethelred = (window as unknown as { aethelred?: unknown }).aethelred;
    expect(aethelred).toBe(getProvider());
  });
});

describe("legacy synchronous surface", () => {
  it("primes selectedAddress/chainId/networkVersion from RPC responses", async () => {
    const provider = getProvider();

    const chainReq = nextRequestFor("eth_chainId");
    const chainPromise = provider.request({ method: "eth_chainId" });
    respond((await chainReq).correlationId, { result: "0x1ca4" }); // 7332
    await chainPromise;

    const accountsReq = nextRequestFor("eth_accounts");
    const accountsPromise = provider.request({ method: "eth_accounts" });
    respond((await accountsReq).correlationId, { result: ["0xAbCd000000000000000000000000000000000001"] });
    await accountsPromise;

    expect(provider.chainId).toBe("0x1ca4");
    expect(provider.networkVersion).toBe("7332");
    expect(provider.selectedAddress).toBe("0xAbCd000000000000000000000000000000000001");
    expect(provider.isConnected()).toBe(true);
  });

  it("tracks chainChanged / accountsChanged / disconnect events", async () => {
    const provider = getProvider();

    emitProviderEvent("chainChanged", "0x1ca3"); // 7331
    emitProviderEvent("accountsChanged", ["0xFeed000000000000000000000000000000000002"]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provider.chainId).toBe("0x1ca3");
    expect(provider.networkVersion).toBe("7331");
    expect(provider.selectedAddress).toBe("0xFeed000000000000000000000000000000000002");

    emitProviderEvent("disconnect", { code: 4900, message: "disconnected" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.isConnected()).toBe(false);

    emitProviderEvent("connect", { chainId: "0x1ca4" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(provider.isConnected()).toBe(true);
    expect(provider.chainId).toBe("0x1ca4");
  });

  it("delivers events registered via once() exactly one time", async () => {
    const provider = getProvider();
    const seen: unknown[] = [];
    provider.once("chainChanged", (chainId) => seen.push(chainId));

    emitProviderEvent("chainChanged", "0x1ca3");
    emitProviderEvent("chainChanged", "0x1ca4");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(seen).toEqual(["0x1ca3"]);
    // The second event still updated the sync surface.
    expect(provider.chainId).toBe("0x1ca4");
  });
});

describe("pre-1193 transports", () => {
  it("enable() issues eth_requestAccounts", async () => {
    const provider = getProvider();
    const captured = nextRequestFor("eth_requestAccounts");
    const enablePromise = provider.enable();
    respond((await captured).correlationId, { result: ["0x1111000000000000000000000000000000000001"] });
    await expect(enablePromise).resolves.toEqual(["0x1111000000000000000000000000000000000001"]);
  });

  it("send(method, params) resolves with the bare result (ethers v5 shape)", async () => {
    const provider = getProvider();
    const captured = nextRequestFor("eth_blockNumber");
    const sendPromise = provider.send("eth_blockNumber", []) as Promise<unknown>;
    respond((await captured).correlationId, { result: "0x10" });
    await expect(sendPromise).resolves.toBe("0x10");
  });

  it("sendAsync(payload, cb) answers with a JSON-RPC envelope (web3.js shape)", async () => {
    const provider = getProvider();
    const captured = nextRequestFor("eth_gasPrice");
    const envelope = new Promise<unknown>((resolve, reject) => {
      provider.sendAsync(
        { id: 42, jsonrpc: "2.0", method: "eth_gasPrice", params: [] },
        (error, response) => (error ? reject(error) : resolve(response)),
      );
    });
    respond((await captured).correlationId, { result: "0x3b9aca00" });
    await expect(envelope).resolves.toEqual({ id: 42, jsonrpc: "2.0", result: "0x3b9aca00" });
  });

  it("sendAsync surfaces RPC errors inside the envelope, not as transport failure", async () => {
    const provider = getProvider();
    const captured = nextRequestFor("eth_call");
    const envelope = new Promise<unknown>((resolve, reject) => {
      provider.sendAsync(
        { id: 7, jsonrpc: "2.0", method: "eth_call", params: [] },
        (error, response) => (error ? reject(error) : resolve(response)),
      );
    });
    respond((await captured).correlationId, { error: { code: -32000, message: "execution reverted" } });
    await expect(envelope).resolves.toEqual({
      id: 7,
      jsonrpc: "2.0",
      error: { code: -32000, message: "execution reverted" },
    });
  });
});

describe("timeout policy", () => {
  it("read-only RPC times out after 60s", async () => {
    vi.useFakeTimers();
    const provider = getProvider();
    const readPromise = provider.request({ method: "eth_getBalance", params: [] });
    const outcome = expect(readPromise).rejects.toThrow("Request timeout: eth_getBalance");
    await vi.advanceTimersByTimeAsync(60_001);
    await outcome;
  });

  it("approval-driven methods wait for the user indefinitely", async () => {
    vi.useFakeTimers();
    const provider = getProvider();
    let settled = false;
    const txPromise = provider
      .request({ method: "eth_sendTransaction", params: [] })
      .finally(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10 * 60_000); // 10 minutes in the approval popup
    expect(settled).toBe(false);
    // Silence the intentionally unsettled promise for the test runtime.
    void txPromise;
  });
});
