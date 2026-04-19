/**
 * {@link CredentialManager} — in-memory store + builder for verifiable
 * credentials held by the Aethelred Wallet.
 *
 * Responsibilities:
 *   - persist credentials the user has received
 *   - support filtered listing (by schema, issuer, unexpired, revocation)
 *   - revoke credentials the user no longer wants to present
 *   - build a signed presentation in response to a counterparty's request
 *
 * The manager is deliberately transport-agnostic — a caller can swap the
 * default in-memory store for a keyring-backed one by implementing
 * {@link CredentialStore} without touching the rest of the surface.
 *
 * @packageDocumentation
 */

import * as secp from "@noble/secp256k1";

import {
  bytesToHex,
  canonicalPresentationHash,
  hexToBytes,
} from "./canonical";
import {
  type Presentation,
  type PresentationRequest,
  type SchemaId,
  type VerifiableCredential,
  CredentialError,
  PresentationError,
} from "./types";

/**
 * Pluggable persistence interface — defaults to an in-memory Map.
 *
 * Implementations should be deterministic: `get(uid)` after `put(uid, …)`
 * must return the same value, and `delete(uid)` + `get(uid)` must return
 * `null`. The manager does not call these concurrently from the wallet
 * popup's main thread, but callers that wire a worker-backed store can
 * still use the same contract.
 */
export interface CredentialStore {
  /** Insert or replace a credential. */
  put(uid: `0x${string}`, cred: VerifiableCredential): Promise<void>;
  /** Look up a credential by UID. Returns `null` when missing. */
  get(uid: `0x${string}`): Promise<VerifiableCredential | null>;
  /** Delete a credential by UID. Returns `true` if a credential was removed. */
  delete(uid: `0x${string}`): Promise<boolean>;
  /** Return every credential currently in the store. */
  all(): Promise<VerifiableCredential[]>;
}

/**
 * Reference in-memory implementation of {@link CredentialStore}.
 */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly items = new Map<`0x${string}`, VerifiableCredential>();

  async put(uid: `0x${string}`, cred: VerifiableCredential): Promise<void> {
    this.items.set(uid, cred);
  }
  async get(uid: `0x${string}`): Promise<VerifiableCredential | null> {
    return this.items.get(uid) ?? null;
  }
  async delete(uid: `0x${string}`): Promise<boolean> {
    return this.items.delete(uid);
  }
  async all(): Promise<VerifiableCredential[]> {
    return Array.from(this.items.values());
  }
}

/**
 * Filter options for {@link CredentialManager.listCredentials}.
 */
export interface CredentialListFilter {
  /** Keep only credentials signed against the matching schema UID. */
  schemaId?: SchemaId;
  /** Keep only credentials issued by the matching issuer id. */
  issuerId?: string;
  /** If `true`, drop credentials whose `expiresAt` is in the past. */
  unexpiredOnly?: boolean;
  /**
   * If `true`, include credentials that have been revoked (by default
   * revoked credentials are filtered out of listings).
   */
  includeRevoked?: boolean;
  /**
   * Clock override for deterministic testing. Defaults to `Date.now()`.
   */
  nowMs?: number;
}

/**
 * Configuration for {@link CredentialManager}.
 */
export interface CredentialManagerConfig {
  /** Pluggable persistence; defaults to {@link InMemoryCredentialStore}. */
  store?: CredentialStore;
  /** Override for wall-clock reads (defaults to `Date.now`). */
  clock?: () => number;
}

/**
 * Presentation-build result.
 *
 * The manager always echoes the `nonce` from the request; the holder's
 * signing key produces the outer signature.
 *
 * @example
 * ```ts
 * const pres = await manager.buildPresentation(req, [uid1, uid2], sk);
 * send(pres);
 * ```
 */
export class CredentialManager {
  private readonly store: CredentialStore;
  private readonly clock: () => number;

  constructor(config: CredentialManagerConfig = {}) {
    this.store = config.store ?? new InMemoryCredentialStore();
    this.clock = config.clock ?? (() => Date.now());
  }

  /**
   * Persist a credential.
   *
   * Idempotent — replacing a credential with the same UID overwrites the
   * previous record. Callers that want hash-chained audit history should
   * wire the audit capture at the caller level.
   */
  async storeCredential(cred: VerifiableCredential): Promise<void> {
    if (!cred.attestation?.uid) {
      throw new CredentialError(
        "credential-malformed",
        "storeCredential: attestation.uid missing"
      );
    }
    await this.store.put(cred.attestation.uid, cred);
  }

  /**
   * Look up a credential by UID.
   *
   * Returns `null` (not `undefined`) for a clean absence sentinel.
   */
  async getCredential(uid: `0x${string}`): Promise<VerifiableCredential | null> {
    return this.store.get(uid);
  }

  /**
   * Return every credential matching the filter.
   *
   * @example
   * ```ts
   * const kyc = await manager.listCredentials({ schemaId: SCHEMA_KYC_STATUS });
   * ```
   */
  async listCredentials(
    filter: CredentialListFilter = {}
  ): Promise<VerifiableCredential[]> {
    const {
      schemaId,
      issuerId,
      unexpiredOnly,
      includeRevoked = false,
      nowMs = this.clock(),
    } = filter;

    const all = await this.store.all();
    return all.filter((c) => {
      const att = c.attestation;
      if (schemaId && att.schemaId !== schemaId) return false;
      if (issuerId && att.issuer.id !== issuerId) return false;
      if (!includeRevoked && att.revokedAt !== undefined) return false;
      if (unexpiredOnly && att.expiresAt !== undefined && att.expiresAt < nowMs) {
        return false;
      }
      return true;
    });
  }

  /**
   * Mark a credential as revoked.
   *
   * Revocation is stored locally so the presentation builder can
   * transparently filter revoked credentials out. The issuer still owns
   * the on-chain revocation bit when a credential has been notarised.
   *
   * @throws CredentialError if the credential does not exist.
   */
  async revokeCredential(
    uid: `0x${string}`,
    reason: string,
    actor: string
  ): Promise<void> {
    const existing = await this.store.get(uid);
    if (!existing) {
      throw new CredentialError(
        "credential-not-found",
        `revokeCredential: no credential with uid ${uid}`
      );
    }
    const now = this.clock();
    const updated: VerifiableCredential = {
      ...existing,
      attestation: {
        ...existing.attestation,
        revokedAt: now,
        revocationReason: `${reason} [actor=${actor}]`,
      },
    };
    await this.store.put(uid, updated);
  }

  /**
   * Build a signed presentation in response to a counterparty request.
   *
   * Flow:
   *   1. Resolve each UID from the store.
   *   2. Assemble the presentation with `presentedAt = clock()`.
   *   3. Hash `canonical(request, presentation)` and sign with the subject
   *      private key using secp256k1 (low-s).
   *
   * @throws PresentationError if a UID is missing, revoked, or expired.
   */
  async buildPresentation(
    request: PresentationRequest,
    matchingUids: `0x${string}`[],
    subjectPrivateKey: `0x${string}`
  ): Promise<Presentation> {
    if (matchingUids.length === 0) {
      throw new PresentationError(
        "credential-missing",
        "buildPresentation: matchingUids must not be empty"
      );
    }
    const now = this.clock();
    if (request.expiresAt < now) {
      throw new PresentationError(
        "expired",
        "buildPresentation: presentation request has expired"
      );
    }

    const credentials: VerifiableCredential[] = [];
    for (const uid of matchingUids) {
      const cred = await this.store.get(uid);
      if (!cred) {
        throw new PresentationError(
          "credential-missing",
          `buildPresentation: uid ${uid} not found`
        );
      }
      if (cred.attestation.revokedAt !== undefined) {
        throw new PresentationError(
          "revoked",
          `buildPresentation: uid ${uid} is revoked`
        );
      }
      if (
        cred.attestation.expiresAt !== undefined &&
        cred.attestation.expiresAt < now
      ) {
        throw new PresentationError(
          "expired",
          `buildPresentation: uid ${uid} is expired`
        );
      }
      credentials.push(cred);
    }

    const unsigned: Omit<Presentation, "signature"> = {
      credentials,
      nonce: request.nonce,
      presentedAt: now,
    };

    const hash = canonicalPresentationHash(request, unsigned);
    const priv = hexToBytes(subjectPrivateKey);
    let sigHex: `0x${string}`;
    try {
      const signature = secp.sign(hash, priv, { lowS: true });
      sigHex = bytesToHex(signature.toBytes());
    } catch (err) {
      throw new PresentationError(
        "signature-invalid",
        `buildPresentation: failed to sign (${(err as Error).message})`
      );
    }

    return {
      ...unsigned,
      signature: sigHex,
    };
  }

  /**
   * Return every UID currently held (including revoked and expired).
   *
   * Primarily used by the UI to render the "credentials" tab quickly
   * without pulling full payloads into memory twice.
   */
  async listUids(): Promise<`0x${string}`[]> {
    const all = await this.store.all();
    return all.map((c) => c.attestation.uid);
  }
}

/**
 * Compute the secp256k1 public key for a subject private key.
 *
 * Exposed so the UI can render a short fingerprint next to a chosen
 * subject identifier. The returned value is a 33-byte compressed key.
 *
 * @example
 * ```ts
 * const pk = computeSubjectPublicKey(sk);
 * ```
 */
export function computeSubjectPublicKey(privateKey: `0x${string}`): `0x${string}` {
  const pub = secp.getPublicKey(hexToBytes(privateKey), true);
  return bytesToHex(pub);
}
