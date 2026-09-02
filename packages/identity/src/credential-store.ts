import type { Credential } from "./types";

/**
 * WebAuthn passkey metadata stored alongside a `Credential`.
 *
 * The public key is captured at enrollment time (per-credential unique
 * ECDSA P-256 point) and the COSE-encoded raw SPKI bytes are kept so we
 * can hand them to `crypto.subtle.importKey` during verification. The
 * credential ID is the WebAuthn-issued handle the authenticator returns
 * on each assertion, and the origin/rpId are recorded to enforce
 * same-origin verification.
 */
export interface PasskeyMetadata {
  /** Base64url-encoded WebAuthn credential ID returned by the authenticator. */
  credentialId: string;
  /** Base64url-encoded SubjectPublicKeyInfo (P-256 ECDSA). */
  publicKeySpki: string;
  /** Effective Relying Party ID used at enrollment (the serialized extension origin). */
  rpId: string;
  /** Opaque transports reported by the authenticator (usb, nfc, ble, internal). */
  transports?: string[];
  /** Signature counter of the most recent successful verification. */
  signCounter: number;
  /** Friendly label shown in the settings UI. */
  label: string;
  /** Last successful authenticator assertion, if one has completed. */
  lastUsedAt?: number;
}

/**
 * A typed `Credential` specialised for passkeys. The `metadata` field is
 * required and typed to `PasskeyMetadata` so callers don't have to narrow
 * every time they pull a passkey out of the store.
 */
export type PasskeyCredential = Credential & {
  type: "passkey";
  metadata: PasskeyMetadata;
};

export class CredentialStore {
  private credentials = new Map<string, Credential>();

  add(credential: Credential): void {
    this.credentials.set(credential.id, credential);
  }

  get(id: string): Credential | undefined {
    return this.credentials.get(id);
  }

  listForSubject(subjectId: string): Credential[] {
    return Array.from(this.credentials.values()).filter(
      (c) => c.subjectId === subjectId
    );
  }

  isValid(id: string): boolean {
    const credential = this.credentials.get(id);
    if (!credential) return false;
    if (credential.expiresAt && credential.expiresAt < Date.now()) return false;
    return true;
  }

  revoke(id: string): void {
    this.credentials.delete(id);
  }

  loadFromSnapshot(credentials: Credential[]): void {
    this.credentials.clear();
    for (const cred of credentials) {
      this.credentials.set(cred.id, cred);
    }
  }

  toSnapshot(): Credential[] {
    return Array.from(this.credentials.values());
  }

  /* ─── Passkey-specific helpers ────────────────────────────────
   *
   * These methods give background.ts a typed entry point for
   * enrolling / verifying / listing / revoking WebAuthn passkeys
   * without every caller re-writing the narrow-to-passkey dance.
   * Each method validates the credential shape so callers can't
   * accidentally look up a non-passkey by credentialId. */

  /**
   * Store a newly-enrolled passkey credential. Idempotent on the
   * WebAuthn `credentialId` — re-enrolling the same authenticator
   * updates the label/signCounter instead of creating a duplicate.
   */
  enrollPasskey(opts: {
    subjectId: string;
    credentialId: string;
    publicKeySpki: string;
    rpId: string;
    label: string;
    transports?: string[];
    signCounter?: number;
  }): PasskeyCredential {
    const id = `passkey-${opts.credentialId}`;
    const existing = this.credentials.get(id);
    if (existing && existing.type !== "passkey") {
      throw new Error("Credential id is already used by a non-passkey credential");
    }
    if (existing?.type === "passkey") {
      const prior = existing as PasskeyCredential;
      if (
        prior.subjectId !== opts.subjectId ||
        prior.metadata.publicKeySpki !== opts.publicKeySpki ||
        prior.metadata.rpId !== opts.rpId
      ) {
        throw new Error("Passkey credential id is already enrolled with different key material");
      }
    }
    const now = Date.now();
    const previous = existing?.type === "passkey" ? existing as PasskeyCredential : undefined;
    const cred: PasskeyCredential = {
      id,
      subjectId: opts.subjectId,
      type: "passkey",
      label: opts.label,
      issuedAt: existing?.issuedAt ?? now,
      metadata: {
        credentialId: opts.credentialId,
        publicKeySpki: opts.publicKeySpki,
        rpId: opts.rpId,
        transports: opts.transports,
        signCounter: previous?.metadata.signCounter ?? opts.signCounter ?? 0,
        label: opts.label,
        lastUsedAt: previous?.metadata.lastUsedAt,
      },
    };
    this.credentials.set(id, cred);
    return cred;
  }

  /**
   * Look up a passkey by the WebAuthn credentialId (not the store id).
   * Returns undefined if no such credential exists or it isn't a passkey.
   */
  findPasskeyByCredentialId(credentialId: string): PasskeyCredential | undefined {
    const cred = this.credentials.get(`passkey-${credentialId}`);
    if (!cred || cred.type !== "passkey") return undefined;
    return cred as PasskeyCredential;
  }

  /**
   * Return all passkey credentials for a subject, typed and ordered
   * newest-first. Used by the settings panel to show enrolled authenticators.
   */
  listPasskeys(subjectId: string): PasskeyCredential[] {
    return this.listForSubject(subjectId)
      .filter((c): c is PasskeyCredential => c.type === "passkey")
      .sort((a, b) => b.issuedAt - a.issuedAt);
  }

  /**
   * Update the stored signature counter on successful verification.
   * Per WebAuthn §6.1.1, the counter must strictly increase across
   * verifications — any regression means the authenticator was cloned.
   */
  bumpPasskeySignCounter(credentialId: string, newCounter: number): void {
    const cred = this.findPasskeyByCredentialId(credentialId);
    if (!cred) return;
    if (newCounter <= cred.metadata.signCounter && cred.metadata.signCounter !== 0) {
      throw new Error(
        `Passkey signature counter regression detected (was ${cred.metadata.signCounter}, got ${newCounter}) — possible cloned authenticator`,
      );
    }
    cred.metadata.signCounter = newCounter;
    cred.metadata.lastUsedAt = Date.now();
    this.credentials.set(cred.id, cred);
  }

  /** Rename a passkey without re-enrolling or changing key material. */
  renamePasskey(credentialId: string, label: string): PasskeyCredential {
    const cred = this.findPasskeyByCredentialId(credentialId);
    if (!cred) throw new Error("Passkey not found");
    const cleanLabel = label.trim().slice(0, 60) || "Passkey";
    cred.label = cleanLabel;
    cred.metadata.label = cleanLabel;
    this.credentials.set(cred.id, cred);
    return cred;
  }

  /** Remove a passkey by credentialId. No-op if the credential doesn't exist. */
  removePasskey(credentialId: string): boolean {
    return this.credentials.delete(`passkey-${credentialId}`);
  }
}
