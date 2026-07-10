/**
 * EIP-1193 `request` argument forms on the inpage provider.
 *
 * The standard — and every mainstream dApp library (wagmi, viem, ethers) —
 * calls `request({ method, params })` with a single args object. A legacy
 * minority call `request(method, params)` positionally. The provider must
 * accept both: treating the args object as the method name turns every
 * modern dApp call into "Unknown method: [object Object]" and bricks the
 * wallet on wagmi-based apps (ZeroID included).
 *
 * The inpage script is a side-effect entry (it installs window.ethereum and
 * posts rpc-request frames to the content script over window.postMessage),
 * so the test imports it once and observes the outbound frames.
 */

import { beforeAll, describe, expect, it } from "vitest";

type RpcRequestFrame = {
  channel?: string;
  message?: { kind?: string; payload?: { method?: unknown; params?: unknown } };
};

function nextRpcRequestFrame(): Promise<NonNullable<RpcRequestFrame["message"]>["payload"]> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const frame = event.data as RpcRequestFrame;
      if (frame?.message?.kind === "rpc-request") {
        window.removeEventListener("message", onMessage);
        resolve(frame.message.payload);
      }
    };
    window.addEventListener("message", onMessage);
  });
}

describe("inpage provider request() argument forms", () => {
  beforeAll(async () => {
    await import("../inpage");
  });

  it("installs window.ethereum with the Aethelred marker", () => {
    const provider = (window as unknown as { ethereum?: { isAethelred?: boolean } }).ethereum;
    expect(provider?.isAethelred).toBe(true);
  });

  it("accepts the standard object form request({ method, params })", async () => {
    const outbound = nextRpcRequestFrame();
    void (window as any).ethereum.request({ method: "eth_chainId", params: [] });
    const payload = await outbound;
    expect(payload?.method).toBe("eth_chainId");
    expect(payload?.params).toEqual([]);
  });

  it("accepts the legacy positional form request(method, params)", async () => {
    const outbound = nextRpcRequestFrame();
    void (window as any).ethereum.request("eth_accounts", ["0xabc"]);
    const payload = await outbound;
    expect(payload?.method).toBe("eth_accounts");
    expect(payload?.params).toEqual(["0xabc"]);
  });
});
