import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const sendMock = vi.fn();

vi.mock("../popup/hooks/use-background", () => ({
  useBackground: () => ({ send: sendMock }),
}));

import { usePasskeyAuthentication } from "../popup/hooks/use-passkey-authentication";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeAssertion(): PublicKeyCredential {
  const response = {
    authenticatorData: new Uint8Array([1, 2, 3]).buffer,
    clientDataJSON: new Uint8Array([4, 5, 6]).buffer,
    signature: new Uint8Array([7, 8, 9]).buffer,
    userHandle: null,
  } as AuthenticatorAssertionResponse;
  return {
    id: "credential",
    rawId: new Uint8Array([10, 11, 12]).buffer,
    type: "public-key",
    response,
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => ({}),
  } as unknown as PublicKeyCredential;
}

beforeEach(() => sendMock.mockReset());

afterEach(() => {
  Object.defineProperty(navigator, "credentials", {
    configurable: true,
    value: undefined,
  });
});

describe("usePasskeyAuthentication", () => {
  it("returns immediately when the wallet has no enrolled passkey", async () => {
    sendMock.mockResolvedValue({ required: false });
    const get = vi.fn();
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { get },
    });
    const { result } = renderHook(() => usePasskeyAuthentication());

    let outcome: Awaited<ReturnType<typeof result.current.authenticateForUnlock>> | undefined;
    await act(async () => {
      outcome = await result.current.authenticateForUnlock("password-only");
    });

    expect(outcome).toEqual({ required: false });
    expect(get).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("runs the authenticator with background-issued options and returns a grant", async () => {
    const challenge = new Uint8Array(32).fill(0xaa);
    const credentialId = new Uint8Array(16).fill(0xbb);
    sendMock
      .mockResolvedValueOnce({
        required: true,
        challengeId: "challenge-id",
        challenge: toBase64Url(challenge),
        timeoutMs: 90_000,
        allowCredentials: [{ id: toBase64Url(credentialId), transports: ["internal"] }],
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, unlockGrant: "grant-token" });
    const get = vi.fn().mockResolvedValue(makeAssertion());
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { get },
    });
    const { result } = renderHook(() => usePasskeyAuthentication());

    let outcome: Awaited<ReturnType<typeof result.current.authenticateForUnlock>> | undefined;
    await act(async () => {
      outcome = await result.current.authenticateForUnlock("correct horse battery staple");
    });

    expect(outcome).toEqual({ required: true, unlockGrant: "grant-token" });
    const request = get.mock.calls[0][0] as { publicKey: PublicKeyCredentialRequestOptions };
    expect(Array.from(new Uint8Array(request.publicKey.challenge as ArrayBuffer))).toEqual(Array.from(challenge));
    // Chrome extension WebAuthn derives the RP ID from the serialized origin.
    // Passing only the extension host here makes the real browser reject it.
    expect(request.publicKey.rpId).toBeUndefined();
    expect(request.publicKey.userVerification).toBe("required");
    expect(request.publicKey.allowCredentials?.[0].transports).toEqual(["internal"]);
    expect(sendMock).toHaveBeenNthCalledWith(2, "verify-password", {
      password: "correct horse battery staple",
    });
    expect(sendMock).toHaveBeenNthCalledWith(3, "passkey-auth-complete", {
      challengeId: "challenge-id",
      credentialId: toBase64Url(new Uint8Array([10, 11, 12])),
      authenticatorData: toBase64Url(new Uint8Array([1, 2, 3])),
      clientDataJSON: toBase64Url(new Uint8Array([4, 5, 6])),
      signature: toBase64Url(new Uint8Array([7, 8, 9])),
    });
  });

  it("surfaces a cancelled platform prompt without issuing an unlock grant", async () => {
    sendMock.mockResolvedValue({
      required: true,
      challengeId: "challenge-id",
      challenge: toBase64Url(new Uint8Array(32).fill(1)),
      allowCredentials: [{ id: toBase64Url(new Uint8Array(16).fill(2)) }],
    });
    const cancelled = Object.assign(new Error("cancel"), { name: "NotAllowedError" });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { get: vi.fn().mockRejectedValue(cancelled) },
    });
    const { result } = renderHook(() => usePasskeyAuthentication());

    await expect(result.current.authenticateForUnlock("correct password")).rejects.toThrow(/cancelled/i);
    expect(sendMock).toHaveBeenNthCalledWith(2, "verify-password", {
      password: "correct password",
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the background omits the passkey requirement", async () => {
    sendMock.mockResolvedValue({ challenge: "not-authoritative" });
    const get = vi.fn();
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { get },
    });
    const { result } = renderHook(() => usePasskeyAuthentication());

    await expect(result.current.authenticateForUnlock("password")).rejects.toThrow(
      /invalid passkey requirement/i,
    );
    expect(get).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed background challenges before invoking WebAuthn", async () => {
    sendMock
      .mockResolvedValueOnce({
        required: true,
        challengeId: "challenge-id",
        challenge: "contains+standard/base64",
        allowCredentials: [{ id: toBase64Url(new Uint8Array(16).fill(2)) }],
      })
      .mockResolvedValueOnce({ ok: true });
    const get = vi.fn();
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { get },
    });
    const { result } = renderHook(() => usePasskeyAuthentication());

    await expect(result.current.authenticateForUnlock("password")).rejects.toThrow(
      /invalid passkey challenge/i,
    );
    expect(get).not.toHaveBeenCalled();
  });
});
