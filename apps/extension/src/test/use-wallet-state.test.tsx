import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

async function importHookWithMocks({
  production,
  extensionContext,
}: {
  production: boolean;
  extensionContext: boolean;
}) {
  vi.resetModules();

  if (extensionContext) {
    (globalThis as any).chrome = {
      runtime: {
        id: "mock-ext-id",
        lastError: null,
        sendMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    };
  } else {
    delete (globalThis as any).chrome;
  }

  const subscribe = vi.fn(() => vi.fn());
  const getState = vi.fn(() => ({
    activeWorkspace: { name: "Preview Workspace" },
    subject: { displayName: "Preview Subject" },
    pendingApprovals: [],
  }));

  vi.doMock("../popup/lib/release-mode", () => ({
    IS_PRODUCTION_BUILD: production,
  }));

  vi.doMock("@aethelred/wallet-connect", () => ({
    createDemoConnectKernel: vi.fn(() => ({
      getState,
      subscribe,
    })),
  }));

  const module = await import("../popup/hooks/use-wallet-state");
  const connectModule = await import("@aethelred/wallet-connect");

  return {
    useWalletState: module.useWalletState,
    createDemoConnectKernel:
      connectModule.createDemoConnectKernel as unknown as ReturnType<typeof vi.fn>,
    getState,
    subscribe,
  };
}

describe("useWalletState", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
    delete (globalThis as any).chrome;
  });

  it("uses the demo kernel for non-extension development previews", async () => {
    const { useWalletState, createDemoConnectKernel } = await importHookWithMocks({
      production: false,
      extensionContext: false,
    });

    const { result } = renderHook(() => useWalletState());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(createDemoConnectKernel).toHaveBeenCalledTimes(1);
    expect(result.current.isDevMode).toBe(true);
    expect(result.current.contextError).toBeNull();
    expect(result.current.state?.activeWorkspace.name).toBe("Preview Workspace");
    expect(result.current.lockState).toEqual({ locked: false, initialized: true });
  });

  it("fails closed for non-extension production shells", async () => {
    const { useWalletState, createDemoConnectKernel } = await importHookWithMocks({
      production: true,
      extensionContext: false,
    });

    const { result } = renderHook(() => useWalletState());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(createDemoConnectKernel).not.toHaveBeenCalled();
    expect(result.current.state).toBeNull();
    expect(result.current.contextError).toMatch(/signed browser extension context/i);
    expect(result.current.lockState).toEqual({ locked: false, initialized: true });
  });
});
