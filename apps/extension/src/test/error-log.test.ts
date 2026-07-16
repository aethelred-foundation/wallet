/**
 * WALLET-06 crash/error capture — the security-critical property is that a
 * wallet NEVER stores or leaks a secret, even in an error string. These
 * tests pin: opt-in gating, PII/secret sanitization, bounded ring buffer,
 * and the boundary-hook wiring.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ERROR_CAPTURE_KEY,
  ERROR_LOG_KEY,
  MAX_ENTRIES,
  captureError,
  clearErrorLog,
  errorCaptureEnabled,
  exportErrorLog,
  getErrorLog,
  installErrorHook,
  sanitize,
  setErrorCaptureEnabled,
} from "../popup/lib/error-log";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
  delete (window as unknown as { __onViewError?: unknown }).__onViewError;
});

describe("sanitize", () => {
  it("redacts a private key (0x + 64 hex)", () => {
    const pk = "0x" + "ab".repeat(32);
    const out = sanitize(`failed to import key ${pk} at step 3`);
    expect(out).not.toContain(pk);
    expect(out).toContain("⟨redacted-key⟩");
  });

  it("redacts an EVM address (0x + 40 hex)", () => {
    const addr = "0x" + "cd".repeat(20);
    const out = sanitize(`balance query for ${addr}`);
    expect(out).not.toContain(addr);
    expect(out).toContain("⟨redacted-addr⟩");
  });

  it("redacts a bech32 aethel1 address", () => {
    const out = sanitize("send to aethel17w0adeg64ky0daxwd2ugyuneellmjgnx2kvj49 reverted");
    expect(out).not.toContain("aethel17w0adeg64ky0daxwd2ugyuneellmjgnx2kvj49");
    expect(out).toContain("⟨redacted⟩");
  });

  it("redacts a BIP-39 mnemonic phrase", () => {
    const mnemonic =
      "legal winner thank year wave sausage worth useful legal winner thank yellow";
    const out = sanitize(`recovery failed for phrase: ${mnemonic}`);
    expect(out).not.toContain("sausage");
    expect(out).toContain("⟨redacted-phrase⟩");
  });

  it("redacts long opaque tokens (signatures/proofs)", () => {
    const sig = "MEUCIQDx" + "A".repeat(60) + "==";
    const out = sanitize(`signature ${sig} rejected`);
    expect(out).not.toContain(sig);
    expect(out).toContain("⟨redacted-token⟩");
  });

  it("leaves ordinary text intact", () => {
    expect(sanitize("Network request failed: timeout after 30s")).toBe(
      "Network request failed: timeout after 30s",
    );
  });
});

describe("opt-in gating", () => {
  it("captures nothing by default (capture OFF)", () => {
    expect(errorCaptureEnabled()).toBe(false);
    const entry = captureError(new Error("boom"), "home");
    expect(entry).toBeNull();
    expect(getErrorLog()).toHaveLength(0);
  });

  it("captures once opted in", () => {
    setErrorCaptureEnabled(true);
    expect(localStorage.getItem(ERROR_CAPTURE_KEY)).toBe("1");
    const entry = captureError(new Error("boom"), "home");
    expect(entry).not.toBeNull();
    expect(getErrorLog()).toHaveLength(1);
    expect(getErrorLog()[0].message).toBe("boom");
    expect(getErrorLog()[0].view).toBe("home");
  });

  it("stops capturing when opted back out", () => {
    setErrorCaptureEnabled(true);
    captureError(new Error("one"), "home");
    setErrorCaptureEnabled(false);
    captureError(new Error("two"), "home");
    expect(getErrorLog()).toHaveLength(1);
  });
});

describe("capture sanitizes secrets before storage", () => {
  it("never writes a private key or mnemonic to storage", () => {
    setErrorCaptureEnabled(true);
    const pk = "0x" + "11".repeat(32);
    const mnemonic = "legal winner thank year wave sausage worth useful legal winner thank yellow";
    captureError(new Error(`import ${pk} phrase ${mnemonic}`), "settings");

    const raw = localStorage.getItem(ERROR_LOG_KEY) ?? "";
    expect(raw).not.toContain(pk);
    expect(raw).not.toContain("sausage");
    // and the exported form is likewise clean
    const exported = exportErrorLog();
    expect(exported).not.toContain(pk);
    expect(exported).not.toContain("sausage");
  });
});

describe("ring buffer + management", () => {
  it("keeps only the most recent MAX_ENTRIES, newest first", () => {
    setErrorCaptureEnabled(true);
    for (let i = 0; i < MAX_ENTRIES + 5; i++) captureError(new Error(`e${i}`), "home");
    const log = getErrorLog();
    expect(log).toHaveLength(MAX_ENTRIES);
    expect(log[0].message).toBe(`e${MAX_ENTRIES + 4}`); // newest first
  });

  it("clearErrorLog wipes the log", () => {
    setErrorCaptureEnabled(true);
    captureError(new Error("x"), "home");
    clearErrorLog();
    expect(getErrorLog()).toHaveLength(0);
  });

  it("exportErrorLog produces a versioned schema", () => {
    setErrorCaptureEnabled(true);
    captureError(new Error("x"), "home");
    const parsed = JSON.parse(exportErrorLog());
    expect(parsed.schema).toBe("aethelred-wallet-error-log/v1");
    expect(Array.isArray(parsed.entries)).toBe(true);
  });
});

describe("installErrorHook", () => {
  it("wires window.__onViewError to capture (respecting opt-in)", () => {
    installErrorHook();
    const hook = (window as unknown as {
      __onViewError?: (e: Error, i: unknown, v?: string) => void;
    }).__onViewError;
    expect(typeof hook).toBe("function");

    // OFF → no capture
    hook!(new Error("boom"), null, "vault");
    expect(getErrorLog()).toHaveLength(0);

    // ON → captured with the view name
    setErrorCaptureEnabled(true);
    hook!(new Error("boom"), null, "vault");
    expect(getErrorLog()).toHaveLength(1);
    expect(getErrorLog()[0].view).toBe("vault");
  });
});
