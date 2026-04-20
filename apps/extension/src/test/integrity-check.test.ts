/**
 * Tests for the runtime integrity-check hook.
 *
 * The hook drives the wallet popup's decision to render the wallet
 * UI or a full-screen security warning. Its probes cover four
 * invariants (runtime id, frame ancestry, document origin, CSP);
 * each path has its own test so a regression in one does not shadow
 * another.
 *
 * The tests drive the pure `runIntegrityProbes` function — that way
 * we sidestep React's async state transitions and can assert the
 * exact shape of the failures list, not the eventual state the hook
 * settles into.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  runIntegrityProbes,
  type IntegrityFailure,
} from "../popup/hooks/use-integrity-check";

/** Build a minimal jsdom-compatible window stub used across tests. */
function buildWindowStub(overrides: {
  origin?: string;
  runtimeId?: string;
  hostname?: string;
  selfIsTop?: boolean;
  cspMeta?: string;
} = {}): typeof window {
  const {
    origin = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef",
    runtimeId = "abcdefghijklmnopqrstuvwxyzabcdef",
    hostname = "abcdefghijklmnopqrstuvwxyzabcdef",
    selfIsTop = true,
    cspMeta = "",
  } = overrides;

  // `document.querySelector` stub for the CSP meta probe.
  const doc = {
    location: { origin, hostname },
    querySelector: (sel: string) => {
      if (sel.includes("Content-Security-Policy") && cspMeta) {
        return { content: cspMeta } as unknown as HTMLMetaElement;
      }
      return null;
    },
  };

  const win = {
    document: doc,
    self: {} as Window,
    top: null as Window | null,
    chrome: runtimeId ? { runtime: { id: runtimeId } } : undefined,
  } as unknown as typeof window;

  (win as unknown as { top: Window | null }).top = selfIsTop
    ? (win as unknown as { self: Window }).self
    : ({} as Window);

  return win;
}

describe("runIntegrityProbes", () => {
  // Reset the JSDOM environment between tests so one failure case
  // doesn't bleed into the next.
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns no failures when every invariant holds", async () => {
    const win = buildWindowStub();
    const okFetch = vi.fn().mockResolvedValue({
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-security-policy"
            ? "script-src 'self'; object-src 'self';"
            : null,
      },
    });
    const failures = await runIntegrityProbes({
      windowRef: win,
      expectedExtensionId: "abcdefghijklmnopqrstuvwxyzabcdef",
      fetchImpl: okFetch as unknown as typeof fetch,
    });
    expect(failures).toEqual<IntegrityFailure[]>([]);
  });

  it("fails when chrome.runtime.id is unavailable", async () => {
    const win = buildWindowStub({ runtimeId: "" });
    const failures = await runIntegrityProbes({ windowRef: win });
    expect(failures.map((f) => f.probe)).toContain("runtime-id");
  });

  it("fails when chrome.runtime.id does not match the expected id", async () => {
    const win = buildWindowStub({ runtimeId: "wrongidwrongidwrongidwrongidwron" });
    const failures = await runIntegrityProbes({
      windowRef: win,
      expectedExtensionId: "abcdefghijklmnopqrstuvwxyzabcdef",
    });
    const runtimeFail = failures.find((f) => f.probe === "runtime-id");
    expect(runtimeFail).toBeDefined();
    expect(runtimeFail?.detail).toContain("does not match");
  });

  it("fails when the popup is rendered inside an iframe", async () => {
    const win = buildWindowStub({ selfIsTop: false });
    const failures = await runIntegrityProbes({ windowRef: win });
    expect(failures.map((f) => f.probe)).toContain("frame-ancestry");
  });

  it("reports a cross-origin frame as an embedding failure", async () => {
    const win = buildWindowStub();
    // Force `window.top` access to throw as it would for a
    // cross-origin frame.
    Object.defineProperty(win, "top", {
      get: () => {
        throw new Error("Blocked a frame with origin");
      },
    });
    const failures = await runIntegrityProbes({ windowRef: win });
    const frameFail = failures.find((f) => f.probe === "frame-ancestry");
    expect(frameFail).toBeDefined();
    expect(frameFail?.detail).toContain("cross-origin");
  });

  it("fails when document.origin is missing", async () => {
    const win = buildWindowStub({ origin: "" });
    const failures = await runIntegrityProbes({ windowRef: win });
    expect(failures.map((f) => f.probe)).toContain("document-origin");
  });

  it("fails when origin uses an unexpected scheme", async () => {
    const win = buildWindowStub({ origin: "file:///tmp/popup.html" });
    const failures = await runIntegrityProbes({ windowRef: win });
    const originFail = failures.find((f) => f.probe === "document-origin");
    expect(originFail?.detail).toContain("Unexpected origin scheme");
  });

  it("accepts HTTPS origins only when the hostname is allow-listed", async () => {
    const rogue = buildWindowStub({
      origin: "https://evil.example.com",
      hostname: "evil.example.com",
    });
    const failures = await runIntegrityProbes({ windowRef: rogue });
    expect(failures.map((f) => f.probe)).toContain("document-origin");
  });

  it("passes for HTTPS wallet hosts (localhost / wallet.aethelred.org)", async () => {
    const win = buildWindowStub({
      origin: "https://wallet.aethelred.org",
      hostname: "wallet.aethelred.org",
    });
    const failures = await runIntegrityProbes({
      windowRef: win,
      expectedExtensionId: "abcdefghijklmnopqrstuvwxyzabcdef",
    });
    // No document-origin failure; runtime-id may still match so
    // the overall result should be clean.
    expect(failures.find((f) => f.probe === "document-origin")).toBeUndefined();
  });

  it("fails when the CSP header is missing", async () => {
    const win = buildWindowStub();
    const emptyFetch = vi.fn().mockResolvedValue({
      headers: { get: () => null },
    });
    const failures = await runIntegrityProbes({
      windowRef: win,
      expectedExtensionId: "abcdefghijklmnopqrstuvwxyzabcdef",
      fetchImpl: emptyFetch as unknown as typeof fetch,
    });
    expect(failures.map((f) => f.probe)).toContain("csp-header");
  });

  it("falls back to the meta tag when the CSP header is absent", async () => {
    const win = buildWindowStub({
      cspMeta: "script-src 'self'; object-src 'self';",
    });
    const fakeFetch = vi.fn().mockResolvedValue({
      headers: { get: () => null },
    });
    const failures = await runIntegrityProbes({
      windowRef: win,
      expectedExtensionId: "abcdefghijklmnopqrstuvwxyzabcdef",
      fetchImpl: fakeFetch as unknown as typeof fetch,
    });
    expect(failures.find((f) => f.probe === "csp-header")).toBeUndefined();
  });

  it("fails when CSP does not restrict script-src to 'self'", async () => {
    const win = buildWindowStub();
    const permissiveFetch = vi.fn().mockResolvedValue({
      headers: {
        get: () => "script-src https://cdn.example.com; object-src 'self';",
      },
    });
    const failures = await runIntegrityProbes({
      windowRef: win,
      expectedExtensionId: "abcdefghijklmnopqrstuvwxyzabcdef",
      fetchImpl: permissiveFetch as unknown as typeof fetch,
    });
    const cspFail = failures.find((f) => f.probe === "csp-header");
    expect(cspFail?.detail).toContain("script-src");
  });

  it("fails when CSP allows unsafe-eval", async () => {
    const win = buildWindowStub();
    const unsafeFetch = vi.fn().mockResolvedValue({
      headers: {
        get: () => "script-src 'self' 'unsafe-eval'; object-src 'self';",
      },
    });
    const failures = await runIntegrityProbes({
      windowRef: win,
      expectedExtensionId: "abcdefghijklmnopqrstuvwxyzabcdef",
      fetchImpl: unsafeFetch as unknown as typeof fetch,
    });
    const cspFail = failures.find((f) => f.probe === "csp-header");
    expect(cspFail?.detail).toContain("unsafe-eval");
  });

  it("aggregates multiple failures in a single pass", async () => {
    const win = buildWindowStub({
      runtimeId: "", // triggers runtime-id failure
      selfIsTop: false, // triggers frame-ancestry failure
      origin: "about:blank", // triggers document-origin failure
    });
    const failures = await runIntegrityProbes({ windowRef: win });
    const probes = failures.map((f) => f.probe);
    expect(probes).toContain("runtime-id");
    expect(probes).toContain("frame-ancestry");
    expect(probes).toContain("document-origin");
  });

  it("treats network errors on the CSP probe as unknown rather than a failure", async () => {
    const win = buildWindowStub();
    const networkFetch = vi
      .fn()
      .mockRejectedValue(new Error("NetworkError: request aborted"));
    const failures = await runIntegrityProbes({
      windowRef: win,
      expectedExtensionId: "abcdefghijklmnopqrstuvwxyzabcdef",
      fetchImpl: networkFetch as unknown as typeof fetch,
    });
    expect(failures.find((f) => f.probe === "csp-header")).toBeUndefined();
  });
});
