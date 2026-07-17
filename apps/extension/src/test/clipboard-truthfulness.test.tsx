import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "../popup/hooks/use-copy-to-clipboard";

describe("clipboard truthfulness", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets the copied label only after the browser confirms the write", async () => {
    let completeWrite: (() => void) | undefined;
    writeText.mockImplementation(() => new Promise<void>((resolve) => {
      completeWrite = resolve;
    }));
    const { result } = renderHook(() => useCopyToClipboard());

    let copyResult!: Promise<boolean>;
    act(() => {
      copyResult = result.current.copy("0xabc", "address");
    });

    expect(result.current.copied).toBeNull();
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      completeWrite?.();
      await copyResult;
    });

    expect(result.current.copied).toBe("address");
    expect(result.current.error).toBeNull();
    await expect(copyResult).resolves.toBe(true);
  });

  it("reports a rejected clipboard write without showing copied success", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    writeText.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const { result } = renderHook(() => useCopyToClipboard());

    let ok = true;
    await act(async () => {
      ok = await result.current.copy("secret", "recovery-phrase");
    });

    expect(ok).toBe(false);
    expect(result.current.copied).toBeNull();
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it("clears an earlier success before a retry and keeps it cleared on rejection", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    writeText.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useCopyToClipboard());

    await act(async () => {
      await result.current.copy("first", "address");
    });
    expect(result.current.copied).toBe("address");

    let rejectRetry: ((reason?: unknown) => void) | undefined;
    writeText.mockImplementationOnce(() => new Promise<void>((_, reject) => {
      rejectRetry = reject;
    }));
    let retry!: Promise<boolean>;
    act(() => {
      retry = result.current.copy("second", "address");
    });
    expect(result.current.copied).toBeNull();
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      rejectRetry?.(new DOMException("denied", "NotAllowedError"));
      await retry;
    });
    expect(result.current.copied).toBeNull();
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).not.toBeNull();
  });
});
