/**
 * {@link CredentialVerifier} — validates attestations, credentials, and
 * presentations against a pinned trust bundle.
 *
 * Checks performed:
 *   1. Schema is in the issuer's allow-list (prevents issuer drift).
 *   2. Issuer is in the verifier's trusted-issuer bundle.
 *   3. Attestation has not expired.
 *   4. Attestation has not been revoked.
 *   5. Attestation UID matches the deterministic hash of its inputs.
 *   6. Signature verifies against `issuer.publicKeyHex` using secp256k1
 *      over `sha256(canonicalJson(attestation))`.
 *   7. Selective-disclosure proof structure (full Merkle verification is
 *      tracked via `@todo GH-ISSUE(credentials-selective-disclosure-merkle)`
 *      — the SDK today only inspects shape / flags a warning that the
 *      ZK layer must re-check).
 *   8. ZK commitment shape (delegated to {@link ZkVerifier}; default
 *      {@link NoopZkVerifier} performs a structural-only check).
 *   9. Presentation binding: nonce, challenge, expiry, challenge-sig.
 *
 * @packageDocumentation
 */

import * as secp from "@noble/secp256k1";

import {
  bytesToHex,
  canonicalAttestationHash,
  canonicalPresentationHash,
  computeAttestationUid,
  hexToBytes,
} from "./canonical";
import { PLACEHOLDER_PUBLIC_KEY } from "./issuer-registry";
import {
  type Attestation,
  type Issuer,
  type Presentation,
  type PresentationRequest,
  type SubjectCommitment,
  type VerifiableCredential,
  type VerificationResult,
  type ZkCommitment,
} from "./types";

/**
 * Optional hook that returns the holder's secp256k1 public key for a
 * given subject commitment. Implementations typically read from a
 * subject registry / DID resolver. Returning `undefined` tells the
 * verifier the holder pubkey is not yet known, so the presentation
 * signature check degrades to a structural check with a warning.
 */
export type HolderPublicKeyResolver = (
  subject: SubjectCommitment,
) => Uint8Array | `0x${string}` | undefined;

/**
 * Abstract ZK proof verifier. Real production implementations wrap a
 * circuit / proving-system specific library (e.g. Circom/snarkjs,
 * Halo2, PLONK). The default {@link NoopZkVerifier} accepts the
 * commitment shape and warns — no cryptographic check is performed.
 *
 * @todo GH-ISSUE(credentials-zk-circuits): replace {@link NoopZkVerifier}
 * instances at application boot with a production verifier bound to
 * the specific circuits in use (Poseidon, Pedersen, etc.).
 */
export interface ZkVerifier {
  readonly name: string;
  verify(commitment: ZkCommitment): Promise<{
    valid: boolean;
    warnings: string[];
    error?: string;
  }>;
}

/**
 * Structural ZK verifier — performs shape-only checks. It returns
 * `{ valid: true }` when the commitment is 0x-prefixed and non-empty,
 * and attaches a warning that an external circuit check is required.
 * Ships as the default so wallets without a circuit dependency can
 * still exercise the credential pipeline.
 */
export class NoopZkVerifier implements ZkVerifier {
  readonly name = "noop-structural";
  async verify(zk: ZkCommitment): Promise<{
    valid: boolean;
    warnings: string[];
    error?: string;
  }> {
    const warnings: string[] = [];
    if (!zk.commitment.startsWith("0x")) {
      return {
        valid: false,
        warnings,
        error: "ZK commitment is not 0x-prefixed",
      };
    }
    if (zk.commitment.length < 4) {
      return {
        valid: false,
        warnings,
        error: "ZK commitment is too short",
      };
    }
    warnings.push(
      `zk-commitment ${zk.scheme}: structural check only; circuit verification required externally`,
    );
    return { valid: true, warnings };
  }
}

/**
 * Verifier configuration.
 */
export interface CredentialVerifierConfig {
  /**
   * Issuers the verifier accepts.
   *
   * Every attestation's `issuer.id` must match one of these; the
   * verifier also re-checks that the pinned `publicKeyHex` matches the
   * issuer embedded in the attestation, so a caller cannot spoof the
   * issuer role by copying the id alone.
   */
  trustedIssuers: Issuer[];
  /**
   * Clock-skew tolerance in milliseconds.
   *
   * Applied symmetrically when checking `expiresAt` and the
   * presentation request's `expiresAt`.
   *
   * @defaultValue 300_000 (5 minutes)
   */
  clockSkewMs?: number;
  /**
   * Reject attestations whose `issuedAt` is more than this many ms old.
   *
   * @defaultValue `Number.POSITIVE_INFINITY` (no age cap)
   */
  maxAttestationAgeMs?: number;
  /**
   * Clock override for deterministic testing.
   *
   * @defaultValue `() => Date.now()`
   */
  clock?: () => number;
  /**
   * Accept issuers whose public key is still the bootstrap placeholder.
   *
   * Defaults to `false` — production deployments must wait for real
   * issuer pubkeys to land before enabling those issuers.
   */
  allowPlaceholderKeys?: boolean;
  /**
   * Resolver that looks up the holder's public key for a given
   * subject commitment. When defined, the verifier performs a real
   * secp256k1 signature check against the resolved key. When the
   * resolver is omitted (or returns `undefined` for a subject), the
   * verifier falls back to a structural signature check and attaches
   * a warning.
   */
  holderPublicKeyResolver?: HolderPublicKeyResolver;
  /**
   * Concrete ZK verifier used to check `zkCommitment` blocks on
   * credentials. Defaults to {@link NoopZkVerifier} which performs
   * shape-only checks.
   */
  zkVerifier?: ZkVerifier;
}

/**
 * Credential verifier.
 *
 * Callers typically instantiate one verifier per security domain and
 * reuse it across requests — the object is cheap to construct and does
 * not keep per-request state.
 */
export class CredentialVerifier {
  private readonly trustedById: Map<string, Issuer>;
  private readonly clockSkewMs: number;
  private readonly maxAttestationAgeMs: number;
  private readonly clock: () => number;
  private readonly allowPlaceholderKeys: boolean;
  private readonly holderPublicKeyResolver: HolderPublicKeyResolver | undefined;
  private readonly zkVerifier: ZkVerifier;

  constructor(config: CredentialVerifierConfig) {
    this.trustedById = new Map();
    for (const iss of config.trustedIssuers) this.trustedById.set(iss.id, iss);
    this.clockSkewMs = config.clockSkewMs ?? 300_000;
    this.maxAttestationAgeMs =
      config.maxAttestationAgeMs ?? Number.POSITIVE_INFINITY;
    this.clock = config.clock ?? (() => Date.now());
    this.allowPlaceholderKeys = config.allowPlaceholderKeys ?? false;
    this.holderPublicKeyResolver = config.holderPublicKeyResolver;
    this.zkVerifier = config.zkVerifier ?? new NoopZkVerifier();
  }

  /**
   * Verify a standalone attestation.
   *
   * Use this when the credential wrapper (selective disclosure / ZK) is
   * not relevant — for example, when validating an incoming issuance
   * before wrapping it into a {@link VerifiableCredential}.
   */
  async verifyAttestation(att: Attestation): Promise<VerificationResult> {
    const warnings: string[] = [];
    const now = this.clock();

    const trusted = this.trustedById.get(att.issuer.id);
    if (!trusted) {
      return fail(
        "issuer-not-trusted",
        `Issuer ${att.issuer.id} is not in the trust bundle`,
        now
      );
    }
    if (trusted.publicKeyHex.toLowerCase() !== att.issuer.publicKeyHex.toLowerCase()) {
      return fail(
        "issuer-not-trusted",
        `Issuer ${att.issuer.id} public key does not match the trust bundle`,
        now
      );
    }
    if (
      !this.allowPlaceholderKeys &&
      trusted.publicKeyHex.toLowerCase() === PLACEHOLDER_PUBLIC_KEY.toLowerCase()
    ) {
      return fail(
        "issuer-not-trusted",
        `Issuer ${att.issuer.id} is still using the placeholder key`,
        now
      );
    }
    if (!trusted.attestationSchemaUIDs.includes(att.schemaId as string)) {
      return fail(
        "schema-unknown",
        `Issuer ${trusted.id} is not authorised to sign schema ${String(att.schemaId)}`,
        now
      );
    }

    if (att.revokedAt !== undefined) {
      return fail(
        "revoked",
        `Attestation ${att.uid} was revoked at ${att.revokedAt}`,
        now
      );
    }
    if (
      att.expiresAt !== undefined &&
      att.expiresAt + this.clockSkewMs < now
    ) {
      return fail(
        "expired",
        `Attestation ${att.uid} expired at ${att.expiresAt}`,
        now
      );
    }
    if (
      Number.isFinite(this.maxAttestationAgeMs) &&
      now - att.issuedAt > this.maxAttestationAgeMs + this.clockSkewMs
    ) {
      return fail(
        "expired",
        `Attestation ${att.uid} exceeds maxAttestationAgeMs`,
        now
      );
    }

    // UID determinism check.
    const expectedUid = computeAttestationUid({
      schemaId: att.schemaId as string,
      issuerId: att.issuer.id,
      subject: att.subject,
      issuedAt: att.issuedAt,
      nonce: att.nonce,
    });
    if (expectedUid.toLowerCase() !== att.uid.toLowerCase()) {
      return fail(
        "signature-invalid",
        `Attestation UID does not match canonical hash (expected ${expectedUid})`,
        now
      );
    }

    // Signature check — real secp256k1 verification.
    let sigOk = false;
    try {
      const hash = canonicalAttestationHash(att);
      const sigBytes = hexToBytes(att.signature);
      const pubBytes = hexToBytes(att.issuer.publicKeyHex);
      sigOk = secp.verify(sigBytes, hash, pubBytes, { lowS: true });
    } catch (err) {
      return fail(
        "signature-invalid",
        `Signature parse failed: ${(err as Error).message}`,
        now
      );
    }
    if (!sigOk) {
      return fail(
        "signature-invalid",
        "Signature does not verify against issuer public key",
        now
      );
    }

    return {
      valid: true,
      verifiedAt: now,
      warnings,
    };
  }

  /**
   * Verify a credential wrapper, including selective disclosure and ZK
   * commitment shape.
   *
   * @param cred - the credential to verify
   * @param expectedSubject - if set, the attestation's subject must match
   */
  async verifyCredential(
    cred: VerifiableCredential,
    expectedSubject?: SubjectCommitment
  ): Promise<VerificationResult> {
    const base = await this.verifyAttestation(cred.attestation);
    if (!base.valid) return base;

    const warnings = [...base.warnings];

    if (
      expectedSubject &&
      expectedSubject.toLowerCase() !== cred.attestation.subject.toLowerCase()
    ) {
      return fail(
        "subject-mismatch",
        "Credential subject does not match the expected commitment",
        base.verifiedAt
      );
    }

    if (cred.selectiveDisclosureProof) {
      /**
       * @todo GH-ISSUE(credentials-selective-disclosure-merkle): implement full
       * Merkle proof verification. Today the SDK only inspects shape — the
       * ZK layer upstream must re-check disclosed field hashes against the
       * attestation's claim payload before trusting the selective view.
       */
      if (!cred.selectiveDisclosureProof.merkleRoot.startsWith("0x")) {
        return fail(
          "signature-invalid",
          "Selective-disclosure proof has a malformed merkle root",
          base.verifiedAt
        );
      }
      warnings.push(
        "selective-disclosure: structural check only; merkle proof not independently verified"
      );
    }

    if (cred.zkCommitment) {
      const zkResult = await this.zkVerifier.verify(cred.zkCommitment);
      if (!zkResult.valid) {
        return fail(
          "signature-invalid",
          zkResult.error ?? `ZK verifier (${this.zkVerifier.name}) rejected the commitment`,
          base.verifiedAt,
        );
      }
      warnings.push(...zkResult.warnings);
    }

    return {
      valid: true,
      verifiedAt: base.verifiedAt,
      warnings,
    };
  }

  /**
   * Verify a presentation against the original request.
   *
   * The check is 4-layered:
   *   1. Nonce echo: presentation.nonce === request.nonce.
   *   2. Expiry: now <= request.expiresAt (+ clock skew).
   *   3. Credentials: each credential wrapper verifies via
   *      {@link verifyCredential}.
   *   4. Required claims: every entry in `request.requiredClaims` is
   *      satisfied by at least one presented credential.
   *
   * Note: the presentation signature is verified against the *holder's*
   * public key, which is derived from the subject commitment in the
   * credential — a separate subject-pubkey registry is out of scope
   * for v1, so the SDK logs a warning when it cannot check the outer
   * signature.
   */
  async verifyPresentation(
    pres: Presentation,
    originalRequest: PresentationRequest
  ): Promise<VerificationResult> {
    const now = this.clock();
    const warnings: string[] = [];

    if (pres.nonce.toLowerCase() !== originalRequest.nonce.toLowerCase()) {
      return fail(
        "nonce-mismatch",
        "Presentation nonce does not match the request nonce",
        now
      );
    }
    if (originalRequest.expiresAt + this.clockSkewMs < now) {
      return fail(
        "expired",
        `Presentation request expired at ${originalRequest.expiresAt}`,
        now
      );
    }

    // Re-derive the canonical presentation hash — failing fast on a
    // malformed bundle even when no holder-pubkey resolver is wired.
    const hash = canonicalPresentationHash(originalRequest, {
      credentials: pres.credentials,
      nonce: pres.nonce,
      presentedAt: pres.presentedAt,
    });
    if (hash.length !== 32) {
      return fail(
        "signature-invalid",
        "Presentation canonical hash did not produce 32 bytes",
        now
      );
    }
    if (!pres.signature.startsWith("0x")) {
      return fail(
        "signature-invalid",
        "Presentation signature is malformed",
        now
      );
    }

    /**
     * Resolve the holder's public key from the first credential's
     * subject commitment. All credentials in a presentation share a
     * subject by construction — the wallet does not mix holders
     * within a single presentation.
     */
    const subject =
      pres.credentials[0]?.attestation.subject ?? undefined;
    const holderPub = subject
      ? this.holderPublicKeyResolver?.(subject)
      : undefined;

    if (holderPub !== undefined) {
      let sigOk = false;
      try {
        const sigBytes = hexToBytes(pres.signature);
        const pubBytes =
          typeof holderPub === "string" ? hexToBytes(holderPub) : holderPub;
        sigOk = secp.verify(sigBytes, hash, pubBytes, { lowS: true });
      } catch (err) {
        return fail(
          "signature-invalid",
          `Presentation signature parse failed: ${(err as Error).message}`,
          now,
        );
      }
      if (!sigOk) {
        return fail(
          "signature-invalid",
          "Presentation signature does not verify against the holder's public key",
          now,
        );
      }
    } else {
      /**
       * @todo GH-ISSUE(credentials-holder-pubkey-registry): configure a
       * `holderPublicKeyResolver` that reads from the production
       * subject-pubkey registry so this degraded path disappears.
       */
      warnings.push(
        "presentation-signature: structural check only; holder pubkey resolver not wired",
      );
    }

    // Each credential must verify.
    for (const cred of pres.credentials) {
      const sub = await this.verifyCredential(cred);
      if (!sub.valid) return { ...sub, verifiedAt: now };
      warnings.push(...sub.warnings);
    }

    // Required claims must be satisfied.
    for (const req of originalRequest.requiredClaims) {
      const matching = pres.credentials.find(
        (c) => c.attestation.schemaId === req.schemaId
      );
      if (!matching) {
        return fail(
          "credential-missing",
          `No credential satisfies required schema ${String(req.schemaId)}`,
          now
        );
      }
      if (req.predicate) {
        const claimValue = matching.attestation.claim.value as
          | Record<string, unknown>
          | undefined;
        if (!claimValue || !(req.predicate.field in claimValue)) {
          return fail(
            "predicate-unsatisfied",
            `Required field ${req.predicate.field} missing from claim`,
            now
          );
        }
        const fieldValue = claimValue[req.predicate.field];
        const predicateOk = evaluatePredicate(
          fieldValue,
          req.predicate.op,
          req.predicate.value
        );
        if (!predicateOk) {
          return fail(
            "predicate-unsatisfied",
            `Predicate failed for ${String(req.schemaId)}.${req.predicate.field}`,
            now
          );
        }
      }
    }

    return {
      valid: true,
      verifiedAt: now,
      warnings,
    };
  }

}

/* ─── Helpers ─────────────────────────────────────────────────── */

function fail(
  code: NonNullable<VerificationResult["errorCode"]>,
  detail: string,
  verifiedAt: number
): VerificationResult {
  return {
    valid: false,
    errorCode: code,
    errorDetail: detail,
    verifiedAt,
    warnings: [],
  };
}

function evaluatePredicate(
  field: unknown,
  op: "eq" | "gte" | "lte" | "in",
  value: unknown
): boolean {
  switch (op) {
    case "eq":
      return field === value;
    case "gte":
      if (typeof field === "number" && typeof value === "number") {
        return field >= value;
      }
      if (typeof field === "string" && typeof value === "string") {
        return field >= value;
      }
      return false;
    case "lte":
      if (typeof field === "number" && typeof value === "number") {
        return field <= value;
      }
      if (typeof field === "string" && typeof value === "string") {
        return field <= value;
      }
      return false;
    case "in":
      if (Array.isArray(value)) return value.includes(field);
      return false;
    default:
      return false;
  }
}

/**
 * Signature helper exported so callers that need to pre-sign attestations
 * (for example, the self-attest path in the wallet) can reuse the exact
 * canonical encoding the verifier expects.
 *
 * Returns a hex-encoded compact 64-byte secp256k1 signature of
 * `sha256(canonicalAttestation(att))`.
 *
 * @example
 * ```ts
 * const sig = signAttestation(att, issuerPrivKey);
 * ```
 */
export function signAttestation(
  att: Attestation,
  issuerPrivateKey: `0x${string}`
): `0x${string}` {
  const hash = canonicalAttestationHash(att);
  const sig = secp.sign(hash, hexToBytes(issuerPrivateKey), { lowS: true });
  return bytesToHex(sig.toBytes());
}
