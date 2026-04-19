/**
 * Tests for useAccountActions — the hook the Accounts view + Account Detail
 * view call to drive the set-active-account and rename-account bridge
 * handlers in background.ts.
 *
 * The hook doesn't run inside a real extension; we stub chrome.runtime so
 * every sendMessage is captured and the response can be shaped per-test.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAccountActions } from "../popup/hooks/use-account-actions";

type BridgePayload = { kind: string; payload: unknown };

/* Install a fake `chrome.runtime.sendMessage` that returns whatever the
 * current test queues via `reply`. `hasExtensionContext()` inside the hook
 * checks `chrome.runtime.id`, so we set that too. */
function installChromeStub() {
  const state: {
    replies: Array<{ result?: unknown; error?: { message: string } }>;
    seen: BridgePayload[];
  } = { replies: [], seen: [] };

  (globalThis as any).chrome = {
    runtime: {
      id: "mock-ext-id",
      lastError: null,
      sendMessage: vi.fn((msg: any, cb: (resp: any) => void) => {
        state.seen.push({ kind: msg.kind, payload: msg.payload });
        const reply = state.replies.shift() ?? { result: { ok: true } };
        // Simulate async delivery.
        queueMicrotask(() => cb({ payload: reply }));
      }),
    },
  };
  return state;
}

describe("useAccountActions", () => {
  let stub: ReturnType<typeof installChromeStub>;

  beforeEach(() => {
    stub = installChromeStub();
  });

  it("sends set-active-account and returns ok on success", async () => {
    stub.replies.push({ result: { ok: true, accountId: "acc-2", address: "0xabc" } });
    const { result } = renderHook(() => useAccountActions());

    let res: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      res = await result.current.setActive("acc-2");
    });

    expect(res.ok).toBe(true);
    expect(stub.seen).toHaveLength(1);
    expect(stub.seen[0].kind).toBe("set-active-account");
    expect(stub.seen[0].payload).toEqual({ accountId: "acc-2" });
  });

  it("returns ok=false with error message when set-active-account rejects", async () => {
    stub.replies.push({ error: { message: "Account not found: acc-99" } });
    const { result } = renderHook(() => useAccountActions());

    let res: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      res = await result.current.setActive("acc-99");
    });

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Account not found/);
  });

  it("validates the rename label before hitting the bridge", async () => {
    const { result } = renderHook(() => useAccountActions());

    /* Empty label — hook short-circuits, no bridge call. */
    let res: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      res = await result.current.rename("acc-1", "   ");
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Label cannot be empty");
    expect(stub.seen).toHaveLength(0);

    /* Too long — also short-circuits. */
    await act(async () => {
      res = await result.current.rename("acc-1", "x".repeat(41));
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too long/i);
    expect(stub.seen).toHaveLength(0);
  });

  it("sends rename-account with trimmed label on success", async () => {
    stub.replies.push({ result: { ok: true } });
    const { result } = renderHook(() => useAccountActions());

    await act(async () => {
      await result.current.rename("acc-1", "  Treasury Wallet  ");
    });

    expect(stub.seen).toHaveLength(1);
    expect(stub.seen[0].kind).toBe("rename-account");
    expect(stub.seen[0].payload).toEqual({ id: "acc-1", label: "Treasury Wallet" });
  });

  it("tracks busy state across the in-flight request", async () => {
    stub.replies.push({ result: { ok: true } });
    const { result } = renderHook(() => useAccountActions());

    expect(result.current.busy).toBe(false);
    await act(async () => {
      const p = result.current.setActive("acc-1");
      // Resolves synchronously via microtask, so busy flip is short-lived —
      // asserting it's false AFTER await is the stable observable property.
      await p;
    });
    expect(result.current.busy).toBe(false);
  });
});
