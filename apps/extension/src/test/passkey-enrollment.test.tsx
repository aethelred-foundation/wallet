/**
 * ───────────────────────────────────────────────────────────────
 *  passkey-enrollment.test.tsx
 * ───────────────────────────────────────────────────────────────
 *
 * Production-mode unit tests for the passkey primitives:
 *   - usePasskeyEnrollment (verifySupport + enroll)
 *   - RecoveryBackupView step-2 cooldown + step-3 verifier
 *   - usePhishingCheck iframe detection
 *
 * We stub `navigator.credentials.create` and `window.PublicKeyCredential`
 * directly so the tests never hit real browser WebAuthn. The
 * background bridge is stubbed via `vi.mock("../popup/hooks/use-
 * background", ...)` — the hook resolves `send()` to a vi.fn so each
 * test can assert the payload the hook attempted to dispatch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, render, screen, cleanup, fireEvent } from "@testing-library/react";

const sendMock = vi.fn();

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send: sendMock }),
}));

// Navigation stub — the recovery-backup view calls `navigate()` on
// strike-out or completion. A no-op is fine; we only assert state.
const navigateMock = vi.fn();
const goBackMock = vi.fn();
vi.mock("../popup/router", () => ({
  useNavigation: () => ({
    navigate: navigateMock,
    goBack: goBackMock,
    canGoBack: true,
    view: "recovery-backup",
    params: {},
  }),
  NavigationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { usePasskeyEnrollment } from "../popup/hooks/use-passkey-enrollment";
import { usePhishingCheck } from "../popup/hooks/use-phishing-check";
import { RecoveryBackupView } from "../popup/views/recovery-backup";

/**
 * Minimal stub for the authenticator response. `rawId` and the
 * public-key SPKI buffer are 32/65 bytes of deterministic content so
 * the base64url encoding we compute in the hook is reproducible.
 */
function makeCredential(): PublicKeyCredential {
  const rawId = new Uint8Array(32).fill(0xab).buffer;
  const publicKey = new Uint8Array(65).fill(0xcd).buffer;

  const response: AuthenticatorAttestationResponse = {
    clientDataJSON: new ArrayBuffer(16),
    attestationObject: new ArrayBuffer(32),
    getPublicKey: () => publicKey,
    getPublicKeyAlgorithm: () => -7,
    getTransports: () => ["internal", "hybrid"],
    getAuthenticatorData: () => new ArrayBuffer(37),
  } as AuthenticatorAttestationResponse;

  return {
    id: "stub-id",
    rawId,
    type: "public-key",
    authenticatorAttachment: "platform",
    response,
    getClientExtensionResults: () => ({}),
  } as unknown as PublicKeyCredential;
}

beforeEach(() => {
  sendMock.mockReset();
  navigateMock.mockReset();
  goBackMock.mockReset();
});

afterEach(() => {
  cleanup();
  // Restore any window mutations between tests.
  delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: undefined,
  });
});

/* ═══════════ verifySupport ═══════════ */

describe("usePasskeyEnrollment.verifySupport", () => {
  it("returns supported: true when API + platform authenticator are available", async () => {
    (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { create: vi.fn(), get: vi.fn() },
    });

    const { result } = renderHook(() => usePasskeyEnrollment());
    const support = await result.current.verifySupport();
    expect(support.supported).toBe(true);
  });

  it("returns a specific reason when PublicKeyCredential is missing", async () => {
    delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;

    const { result } = renderHook(() => usePasskeyEnrollment());
    const support = await result.current.verifySupport();
    expect(support.supported).toBe(false);
    expect(support.reason).toMatch(/WebAuthn/i);
  });

  it("returns a specific reason when navigator.credentials is absent", async () => {
    (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: undefined,
    });

    const { result } = renderHook(() => usePasskeyEnrollment());
    const support = await result.current.verifySupport();
    expect(support.supported).toBe(false);
    expect(support.reason).toMatch(/navigator\.credentials/i);
  });

  it("returns a specific reason when platform authenticator probe returns false", async () => {
    (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(false),
    };
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { create: vi.fn() },
    });

    const { result } = renderHook(() => usePasskeyEnrollment());
    const support = await result.current.verifySupport();
    expect(support.supported).toBe(false);
    expect(support.reason).toMatch(/platform authenticator/i);
  });
});

/* ═══════════ enroll ═══════════ */

describe("usePasskeyEnrollment.enroll", () => {
  function stubSuccessfulCreate() {
    const createSpy = vi.fn().mockResolvedValue(makeCredential());
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { create: createSpy, get: vi.fn() },
    });
    (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
    };
    return createSpy;
  }

  it("sends well-formed CredentialCreationOptions to the authenticator", async () => {
    const createSpy = stubSuccessfulCreate();
    sendMock.mockResolvedValue({ ok: true, id: "passkey-abc", label: "Test" });

    const { result } = renderHook(() => usePasskeyEnrollment());

    await act(async () => {
      await result.current.enroll({
        userId: "subject-123",
        userName: "ramesh",
        userDisplayName: "Ramesh T",
        rpName: "Aethelred Wallet",
        rpId: "aethelred.test",
        label: "MacBook",
      });
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const args = createSpy.mock.calls[0][0] as { publicKey: PublicKeyCredentialCreationOptions };
    const pk = args.publicKey;
    expect(pk.rp).toEqual({ name: "Aethelred Wallet", id: "aethelred.test" });
    expect(pk.pubKeyCredParams).toEqual([{ alg: -7, type: "public-key" }]);
    expect(pk.authenticatorSelection?.residentKey).toBe("required");
    expect(pk.authenticatorSelection?.userVerification).toBe("required");
    expect(pk.authenticatorSelection?.authenticatorAttachment).toBe("platform");
    expect(pk.attestation).toBe("none");
    expect(pk.timeout).toBe(60_000);
  });

  it("challenge is always 32 random bytes", async () => {
    const createSpy = stubSuccessfulCreate();
    sendMock.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => usePasskeyEnrollment());

    await act(async () => {
      await result.current.enroll({
        userId: "a",
        userName: "a",
        userDisplayName: "A",
        rpName: "Aethelred Wallet",
      });
    });

    const args = createSpy.mock.calls[0][0] as { publicKey: PublicKeyCredentialCreationOptions };
    const challenge = args.publicKey.challenge as ArrayBuffer;
    expect(challenge.byteLength).toBe(32);

    // Make a second call and confirm the challenge differs (random).
    createSpy.mockResolvedValue(makeCredential());
    await act(async () => {
      await result.current.enroll({
        userId: "a",
        userName: "a",
        userDisplayName: "A",
        rpName: "Aethelred Wallet",
      });
    });
    const secondArgs = createSpy.mock.calls[1][0] as { publicKey: PublicKeyCredentialCreationOptions };
    const secondChallenge = secondArgs.publicKey.challenge as ArrayBuffer;
    expect(secondChallenge.byteLength).toBe(32);

    const view1 = Array.from(new Uint8Array(challenge));
    const view2 = Array.from(new Uint8Array(secondChallenge));
    expect(view1).not.toEqual(view2);
  });

  it("dispatches passkey-enroll bridge with base64url-encoded ids", async () => {
    stubSuccessfulCreate();
    sendMock.mockResolvedValue({ ok: true });

    const { result } = renderHook(() => usePasskeyEnrollment());
    await act(async () => {
      await result.current.enroll({
        userId: "subject-xyz",
        userName: "ramesh",
        userDisplayName: "Ramesh T",
        rpName: "Aethelred Wallet",
        rpId: "wallet.aethelred.org",
        label: "Primary",
      });
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    const kind = call[0];
    const payload = call[1];
    expect(kind).toBe("passkey-enroll");
    const p = payload as {
      credentialId: string;
      publicKeySpki: string;
      rpId: string;
      label: string;
      transports: string[];
    };
    expect(p.rpId).toBe("wallet.aethelred.org");
    expect(p.label).toBe("Primary");
    // base64url has no +, /, or = — confirm.
    expect(p.credentialId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.publicKeySpki).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(p.transports).toEqual(expect.arrayContaining(["internal", "hybrid"]));
  });

  it("returns error when the user cancels (AbortError)", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { create: vi.fn().mockRejectedValue(abort) },
    });
    (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
    };

    const { result } = renderHook(() => usePasskeyEnrollment());
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.enroll({
        userId: "a",
        userName: "a",
        userDisplayName: "A",
        rpName: "Aethelred Wallet",
      });
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/cancel/i);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns a distinct error for already-enrolled (InvalidStateError)", async () => {
    const invalid = Object.assign(new Error("dup"), { name: "InvalidStateError" });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { create: vi.fn().mockRejectedValue(invalid) },
    });
    (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
    };

    const { result } = renderHook(() => usePasskeyEnrollment());
    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.enroll({
        userId: "a",
        userName: "a",
        userDisplayName: "A",
        rpName: "Aethelred Wallet",
      });
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/already/i);
  });
});

/* ═══════════ usePhishingCheck ═══════════ */

describe("usePhishingCheck", () => {
  it("returns isGenuineContext=true under chrome-extension: (top window)", () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        protocol: "chrome-extension:",
        hostname: "abc123",
      },
    });
    const { result } = renderHook(() => usePhishingCheck());
    expect(result.current.isGenuineContext).toBe(true);
  });

  it("detects iframe embedding (self !== top)", () => {
    // Emulate a framed context: make `window.top` a different object.
    const fakeTop = {} as Window;
    Object.defineProperty(window, "top", {
      configurable: true,
      get: () => fakeTop,
    });

    const { result } = renderHook(() => usePhishingCheck());
    expect(result.current.isGenuineContext).toBe(false);
    expect(result.current.reason).toMatch(/iframe/i);

    // Restore top for later tests.
    Object.defineProperty(window, "top", {
      configurable: true,
      get: () => window,
    });
  });
});

/* ═══════════ RecoveryBackupView step flow ═══════════ */

describe("RecoveryBackupView", () => {
  const phrase = [
    "abandon", "ability", "able", "about", "above", "absent",
    "absorb", "abstract", "absurd", "abuse", "access", "accident",
  ];

  beforeEach(() => {
    // Baseline: pass the phishing check so the reveal path renders.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        protocol: "chrome-extension:",
        hostname: "aethelred-test",
      },
    });
    Object.defineProperty(window, "top", {
      configurable: true,
      get: () => window,
    });

    // Clipboard stub — the reveal step triggers writeText for Copy.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    sendMock.mockImplementation(((kind: string) => {
      if (kind === "get-recovery-phrase") return Promise.resolve(phrase);
      return Promise.resolve({});
    }) as never);
  });

  it("reveal step requires a cooldown before continue unlocks", async () => {
    render(<RecoveryBackupView />);

    // Warning step: tick the checkbox.
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /continue to reveal/i }));

    // Wait for the reveal step — the step-banner "Step 2 of 3"
    // only appears once the warning acknowledgement has advanced.
    await vi.waitFor(() =>
      expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument(),
    );

    // Immediately after switching to reveal, the continue button must
    // be disabled while the cooldown hint still reads 10s.
    const continueBtn = screen.getByRole("button", { name: /i've written it down/i });
    expect(continueBtn).toBeDisabled();
    expect(screen.getByText(/continue available in 10s/i)).toBeInTheDocument();
  });

  it("verify step accepts the real phrase", async () => {
    // To avoid wall-clock waits on the 10-second reveal cooldown we
    // run under fake timers and drain the setInterval manually in
    // 1-second chunks wrapped in act(), each of which lets React
    // flush state commits.
    vi.useFakeTimers();

    try {
      render(<RecoveryBackupView />);

      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: /continue to reveal/i }));

      // Flush the get-recovery-phrase microtasks.
      await act(async () => { await Promise.resolve(); });
      await act(async () => { await Promise.resolve(); });

      // Wait for the reveal step to commit.
      await vi.waitFor(() =>
        expect(screen.getByText(/step 2 of 3/i)).toBeInTheDocument(),
      );

      // Drain the 10-tick cooldown.
      for (let i = 0; i < 11; i++) {
        await act(async () => {
          vi.advanceTimersByTime(1_000);
        });
      }

      const continueBtn = screen.getByRole("button", { name: /i've written it down/i });
      expect(continueBtn).not.toBeDisabled();
      fireEvent.click(continueBtn);

      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText(/confirm your backup/i)).toBeInTheDocument();

      // Fill every slot with the correct word for whatever position
      // was picked.
      const prompts = screen.getAllByLabelText(/recovery word at position/i);
      prompts.forEach((input) => {
        const pos = parseInt(
          (input.getAttribute("aria-label") || "").match(/position (\d+)/)?.[1] ?? "0",
          10,
        );
        fireEvent.change(input, { target: { value: phrase[pos - 1] } });
      });

      fireEvent.click(screen.getByRole("button", { name: /verify backup/i }));

      await act(async () => { await Promise.resolve(); });
      expect(screen.getByText(/backup confirmed/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
