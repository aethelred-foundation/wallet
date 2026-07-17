import { useCallback, useState } from "react";
import { useBackground } from "./use-background";

interface PasskeyAuthBeginResult {
  required: boolean;
  challengeId?: string;
  challenge?: string;
  timeoutMs?: number;
  allowCredentials?: Array<{
    id: string;
    transports?: string[];
  }>;
}

export interface PasskeyAuthenticationResult {
  required: boolean;
  unlockGrant?: string;
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Wallet returned an invalid passkey challenge");
  }
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function arrayBufferToBase64Url(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function mapWebAuthnError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error("Passkey verification failed");
  switch (error.name) {
    case "AbortError":
      return new Error("Passkey verification cancelled");
    case "NotAllowedError":
      return new Error(
        /timed? out/i.test(error.message)
          ? "Passkey verification timed out"
          : "Passkey verification cancelled",
      );
    case "SecurityError":
      return new Error("Passkey verification was blocked by the browser");
    case "NotSupportedError":
      return new Error("This browser does not support the enrolled passkey");
    default:
      return new Error(error.message || "Passkey verification failed");
  }
}

/**
 * Run the background-issued, one-time WebAuthn ceremony used by unlock.
 * Password-only wallets return immediately without touching WebAuthn.
 */
export function usePasskeyAuthentication() {
  const { send } = useBackground();
  const [authenticating, setAuthenticating] = useState(false);

  const authenticateForUnlock = useCallback(async (password: string): Promise<PasskeyAuthenticationResult> => {
    const begin = (await send("passkey-auth-begin", {})) as PasskeyAuthBeginResult | undefined;
    if (!begin || typeof begin.required !== "boolean") {
      throw new Error("Wallet returned an invalid passkey requirement");
    }
    if (!begin.required) return { required: false };
    if (
      !begin.challengeId ||
      !begin.challenge ||
      !Array.isArray(begin.allowCredentials) ||
      begin.allowCredentials.length === 0
    ) {
      throw new Error("Wallet returned incomplete passkey options");
    }
    if (typeof navigator === "undefined" || !navigator.credentials?.get) {
      throw new Error("Passkey verification is unavailable in this browser");
    }

    setAuthenticating(true);
    try {
      // Reject a mistyped password before asking the user to touch their
      // authenticator. unlock-request verifies it again before releasing keys.
      await send("verify-password", { password });
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64UrlToArrayBuffer(begin.challenge),
          timeout: begin.timeoutMs ?? 90_000,
          userVerification: "required",
          allowCredentials: begin.allowCredentials.map((entry) => ({
            type: "public-key" as const,
            id: base64UrlToArrayBuffer(entry.id),
            transports: (entry.transports ?? []).filter(
              (transport): transport is AuthenticatorTransport =>
                ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(transport),
            ),
          })),
        },
      });
      if (!credential || credential.type !== "public-key") {
        throw new Error("Authenticator returned no passkey assertion");
      }
      const publicKeyCredential = credential as PublicKeyCredential;
      const response = publicKeyCredential.response as AuthenticatorAssertionResponse;
      const completed = (await send("passkey-auth-complete", {
        challengeId: begin.challengeId,
        credentialId: arrayBufferToBase64Url(publicKeyCredential.rawId),
        authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
        clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
        signature: arrayBufferToBase64Url(response.signature),
      })) as { ok?: boolean; unlockGrant?: string } | undefined;

      if (!completed?.ok || !completed.unlockGrant) {
        throw new Error("Passkey verification was not accepted");
      }
      return { required: true, unlockGrant: completed.unlockGrant };
    } catch (error) {
      throw mapWebAuthnError(error);
    } finally {
      setAuthenticating(false);
    }
  }, [send]);

  return { authenticateForUnlock, authenticating };
}
