/**
 * ───────────────────────────────────────────────────────────────
 *  use-passkey-enrollment
 * ───────────────────────────────────────────────────────────────
 *
 * React hook wrapping the browser's WebAuthn `navigator.credentials
 * .create()` ceremony for the Aethelred Wallet. The popup cannot
 * delegate this call to the background service worker — WebAuthn is
 * gated by user activation on the page that has focus — so we build
 * the `PublicKeyCredentialCreationOptions` here, let the authenticator
 * emit a platform credential, extract the material we need, and hand
 * it to the background via the existing `passkey-enroll` bridge
 * message. The background persists the record via the primitives in
 * `@aethelred/wallet-identity/credential-store` (clone-detection
 * counter, subject-scoped enrollment, audit record).
 *
 * Scope (intentionally narrow):
 *   - ES256 (COSE -7 / ECDSA P-256) only, matching the verifier in
 *     `background.ts → verifyWebAuthnAssertion`.
 *   - Platform authenticators with discoverable credentials so the
 *     device can present the passkey without any username hint.
 *   - `attestation: "none"` — the wallet never uploads attestation
 *     to a remote service, and omitting the statement avoids
 *     fingerprinting leaks.
 *   - Strict user verification (biometric/PIN every time).
 *
 * This hook exposes two functions and a boolean:
 *   - `verifySupport()` probes the UA for WebAuthn capability and a
 *     user-verifying platform authenticator (Touch ID, Windows Hello,
 *     Android screen-lock) before we ever spin the UI.
 *   - `enroll(opts)` performs the full `create()` flow and returns a
 *     result envelope with the credential ID, transports, and either
 *     `ok: true` or a tagged error reason.
 *   - `enrolling` reflects whether a ceremony is currently in-flight
 *     so callers can disable the button and show a spinner.
 *
 * The hook never stores secrets in React state, never caches the
 * challenge across renders, and clears the in-flight flag on unmount
 * so stale strict-mode re-invocations don't fire ghost requests.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useBackground } from "./use-background";

/**
 * Options required to build a well-formed
 * `PublicKeyCredentialCreationOptions`. All fields describe the user
 * and relying party; we never take the challenge as input (it's
 * generated per-call with `crypto.getRandomValues(32)`).
 */
export interface EnrollPasskeyOptions {
  /** Stable subject identifier (hex or base64url) — used as user.id. */
  userId: string;
  /** Machine-style username, e.g. an email or handle. */
  userName: string;
  /** Human-friendly display name shown in the OS passkey picker. */
  userDisplayName: string;
  /** RP name shown by the authenticator — "Aethelred Wallet". */
  rpName: string;
  /**
   * RP ID (hostname) — optional. Defaults to `location.host` so the
   * credential is bound to the origin it was created on. The caller
   * is still free to pin a specific value for extension/origin
   * mapping (e.g. the static `chrome-extension://<id>` host).
   */
  rpId?: string;
  /** Optional friendly label saved alongside the credential. */
  label?: string;
}

/**
 * Envelope returned from `enroll()`. `ok: true` means the credential
 * has been enrolled with the background and is ready for a later
 * `passkey-verify` call. `ok: false` carries a short, user-facing
 * reason string — the caller decides how to render it.
 */
export interface EnrollmentResult {
  ok: boolean;
  credentialId?: string;
  transports?: string[];
  error?: string;
}

/**
 * Result of the pre-flight capability probe.
 */
export interface SupportResult {
  supported: boolean;
  reason?: string;
}

/**
 * Hook API: three symmetrical fields that callers destructure. Kept
 * intentionally small so the security panel and the onboarding step
 * can share the same surface without bespoke glue.
 */
export interface UsePasskeyEnrollmentApi {
  enroll: (opts: EnrollPasskeyOptions) => Promise<EnrollmentResult>;
  verifySupport: () => Promise<SupportResult>;
  enrolling: boolean;
}

/**
 * Encode an arbitrary string into the user.id byte array required by
 * WebAuthn. The authenticator treats this as opaque; the only
 * constraint is the 1-64 byte length window. We TextEncoder-encode
 * then truncate to 64 bytes — the wallet's subject IDs are always
 * shorter than that, but defensive truncation guards against callers
 * that pass arbitrary external identifiers.
 */
function encodeUserId(userId: string): Uint8Array {
  const bytes = new TextEncoder().encode(userId);
  return bytes.byteLength <= 64 ? bytes : bytes.slice(0, 64);
}

/**
 * Encode a byte sequence as unpadded base64url — the format the
 * background expects for the `credentialId` and `publicKeySpki`
 * fields on the `passkey-enroll` bridge payload.
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * `navigator.credentials.create()` returns a `PublicKeyCredential`
 * with an `AuthenticatorAttestationResponse`. We only need:
 *   - the raw credential ID (opaque authenticator handle)
 *   - the public key in SPKI form so `crypto.subtle.importKey` can
 *     ingest it during verification — the SPKI form is exactly what
 *     `background.ts → verifyWebAuthnAssertion` consumes.
 *   - the transports so the UI can badge USB/NFC/BLE/Internal.
 *
 * If `getPublicKey()` is unavailable (older Safari), we bail to a
 * tagged error rather than silently recording an unverifiable key.
 */
function extractAttestationFields(credential: PublicKeyCredential): {
  credentialId: string;
  publicKeySpki: string;
  transports: string[];
} | null {
  const response = credential.response as AuthenticatorAttestationResponse;
  const pubKeyBuffer =
    typeof response.getPublicKey === "function" ? response.getPublicKey() : null;
  if (!pubKeyBuffer) return null;

  const credentialIdBytes = new Uint8Array(credential.rawId);
  const publicKeyBytes = new Uint8Array(pubKeyBuffer);

  const transports =
    typeof response.getTransports === "function" ? response.getTransports() : [];

  return {
    credentialId: bytesToBase64Url(credentialIdBytes),
    publicKeySpki: bytesToBase64Url(publicKeyBytes),
    transports: Array.from(new Set(transports)).filter((t) => !!t),
  };
}

/**
 * Map the most common `DOMException` names the authenticator emits
 * to a user-friendly message. `NotAllowedError` is overloaded — it
 * covers both user cancellation and hard failures — so we lean on
 * the message content where possible to distinguish.
 */
function mapCredentialError(err: unknown): string {
  if (!(err instanceof Error)) return "Passkey enrollment failed";
  const name = err.name || "";
  switch (name) {
    case "AbortError":
      return "Enrollment cancelled";
    case "NotAllowedError":
      // WebAuthn lumps explicit cancel + timeout here.
      return /timed? out/i.test(err.message)
        ? "Enrollment timed out"
        : "Enrollment cancelled";
    case "InvalidStateError":
      return "This device already has a passkey enrolled";
    case "NotSupportedError":
      return "This device does not support passkeys";
    case "SecurityError":
      return "Passkey blocked by the browser security policy";
    case "ConstraintError":
      return "Authenticator rejected the requested settings";
    default:
      return err.message || "Passkey enrollment failed";
  }
}

/**
 * React hook exposing the passkey enrollment ceremony.
 *
 * @example
 *   const { enroll, verifySupport, enrolling } = usePasskeyEnrollment();
 *   const support = await verifySupport();
 *   if (!support.supported) showFallback(support.reason);
 *   else await enroll({ userId, userName, userDisplayName, rpName: "Aethelred Wallet" });
 */
export function usePasskeyEnrollment(): UsePasskeyEnrollmentApi {
  const { send } = useBackground();
  const [enrolling, setEnrolling] = useState(false);
  /**
   * Track mount state. `navigator.credentials.create()` can take
   * several seconds while the user taps their authenticator; if the
   * hosting component unmounts in that window we must not call
   * `setEnrolling(false)` on an unmounted tree.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const verifySupport = useCallback(async (): Promise<SupportResult> => {
    if (typeof window === "undefined") {
      return { supported: false, reason: "No window context" };
    }
    if (typeof window.PublicKeyCredential === "undefined") {
      return { supported: false, reason: "WebAuthn API unavailable in this browser" };
    }
    if (typeof navigator === "undefined" || !navigator.credentials) {
      return { supported: false, reason: "navigator.credentials is not available" };
    }
    const probe =
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
        ? window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
        : null;
    if (!probe) {
      // No platform-authenticator probe — treat as unsupported rather
      // than guessing. A strict posture is preferable here.
      return { supported: false, reason: "Platform authenticator probe missing" };
    }
    try {
      const available = await probe.call(window.PublicKeyCredential);
      if (!available) {
        return {
          supported: false,
          reason: "No user-verifying platform authenticator (Touch ID / Windows Hello) detected",
        };
      }
      return { supported: true };
    } catch (err) {
      return {
        supported: false,
        reason:
          err instanceof Error ? err.message : "Failed to probe platform authenticator",
      };
    }
  }, []);

  const enroll = useCallback(
    async (opts: EnrollPasskeyOptions): Promise<EnrollmentResult> => {
      if (typeof navigator === "undefined" || !navigator.credentials) {
        return { ok: false, error: "WebAuthn unavailable in this environment" };
      }

      // Fresh 32-byte challenge per ceremony — this is the canonical
      // anti-replay primitive. It's never stored; the authenticator
      // signs over it and the background only ever sees the returned
      // material during verification, not enrollment.
      const challengeBuffer = new ArrayBuffer(32);
      crypto.getRandomValues(new Uint8Array(challengeBuffer));

      const rpId = opts.rpId ?? (typeof location !== "undefined" ? location.host : "");

      const userIdBytes = encodeUserId(opts.userId);
      const userIdBuffer = new ArrayBuffer(userIdBytes.byteLength);
      new Uint8Array(userIdBuffer).set(userIdBytes);

      const publicKey: PublicKeyCredentialCreationOptions = {
        challenge: challengeBuffer,
        rp: {
          name: opts.rpName,
          ...(rpId ? { id: rpId } : {}),
        },
        user: {
          id: userIdBuffer,
          name: opts.userName,
          displayName: opts.userDisplayName,
        },
        // ES256 is the COSE identifier for ECDSA P-256; the
        // background verifier only accepts this curve/alg pair.
        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
          authenticatorAttachment: "platform",
          requireResidentKey: true,
        },
        attestation: "none",
        timeout: 60_000,
      };

      if (mountedRef.current) setEnrolling(true);

      try {
        const raw = await navigator.credentials.create({ publicKey });
        if (!raw || raw.type !== "public-key") {
          return { ok: false, error: "Authenticator returned no credential" };
        }
        const credential = raw as PublicKeyCredential;
        const extracted = extractAttestationFields(credential);
        if (!extracted) {
          return { ok: false, error: "Authenticator did not return a usable public key" };
        }

        const result = (await send("passkey-enroll", {
          credentialId: extracted.credentialId,
          publicKeySpki: extracted.publicKeySpki,
          rpId,
          label: opts.label?.trim() || "Passkey",
          transports: extracted.transports,
        })) as { ok?: boolean; id?: string; label?: string } | undefined;

        if (!result?.ok) {
          return { ok: false, error: "Background refused to persist the passkey" };
        }

        return {
          ok: true,
          credentialId: extracted.credentialId,
          transports: extracted.transports,
        };
      } catch (err) {
        return { ok: false, error: mapCredentialError(err) };
      } finally {
        if (mountedRef.current) setEnrolling(false);
      }
    },
    [send],
  );

  return { enroll, verifySupport, enrolling };
}
