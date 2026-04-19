/**
 * Core type surface for the Aethelred Regulatory Passport — Moat #2.
 *
 * These types describe EAS-style attestations that regulated counterparties
 * (VASPs, custodians, banks, brokers) exchange to prove KYC/AML status,
 * jurisdiction, accredited-investor tier, and VASP license class without
 * leaking raw identity data across the wire.
 *
 * The design borrows the best of:
 *   - EAS (Ethereum Attestation Service) — schema-first, UID-addressed
 *   - EIP-712 / EIP-7410 — issuer pubkey registry model
 *   - W3C Verifiable Credentials — presentation/request protocol
 *   - Poseidon / Pedersen commitments — ZK-friendly subject hashes
 *
 * Every raw identifier (email, passport number, entity registration) is
 * hashed into a {@link SubjectCommitment} before it leaves the holder's
 * device. Counterparties only ever see the commitment + signed claim;
 * the holder keeps the pre-image. This keeps the passport GDPR-safe
 * while staying cryptographically verifiable.
 *
 * @packageDocumentation
 */

/**
 * Subject of an attestation, hashed so the raw identifier never leaks.
 *
 * In production this is a Poseidon or SHA-256 commitment of
 * `(subjectType || rawId || salt)`. The holder keeps the salt on-device
 * and reproduces the commitment deterministically when proving linkage
 * to a credential.
 *
 * @example
 * ```ts
 * const commitment: SubjectCommitment = "0x" + "ab".repeat(32) as SubjectCommitment;
 * ```
 */
export type SubjectCommitment = `0x${string}`;

/**
 * Role classification for a credential issuer.
 *
 * Separates "what the issuer is permitted to attest to" from "who the
 * issuer is". A single organisation can be registered with multiple roles
 * (for example a KYC vendor that also operates a chain-analytics product).
 *
 * @example
 * ```ts
 * const role: IssuerRole = "kyc-provider";
 * ```
 */
export type IssuerRole =
  | "kyc-provider"
  | "aml-provider"
  | "accredited-investor-verifier"
  | "vasp-registrar"
  | "chain-analytics"
  | "self";

/**
 * Well-known credential issuer — a trusted third party whose signatures
 * the verifier will accept for the role's allowed schemas.
 *
 * Issuers are modelled after EIP-7410: every issuer has a stable
 * identifier, a human-readable name, a public-key fingerprint, and an
 * allow-list of schema UIDs it is permitted to sign.
 *
 * @example
 * ```ts
 * const issuer: Issuer = {
 *   id: "sumsub-global",
 *   name: "Sumsub Global KYC",
 *   role: "kyc-provider",
 *   publicKeyHex: "0x" + "00".repeat(33),
 *   jurisdiction: "GB",
 *   licenseRef: "FCA-9001",
 *   attestationSchemaUIDs: [SCHEMA_KYC_STATUS, SCHEMA_SANCTIONS_CLEAR],
 * };
 * ```
 */
export interface Issuer {
  /** Stable identifier; used for registry lookups and audit rows. */
  id: string;
  /** Human-readable name shown to the user in consent dialogs. */
  name: string;
  /** Role the issuer is permitted to play (determines allowed schemas). */
  role: IssuerRole;
  /**
   * Compressed secp256k1 public key (0x-prefixed hex, 33 bytes).
   *
   * Placeholder `0x00...00` is permitted during the bootstrap phase
   * while real issuers onboard — verifiers MUST reject placeholders
   * unless the consumer has opted into `allowPlaceholderKeys`.
   */
  publicKeyHex: `0x${string}`;
  /** ISO 3166-1 alpha-2 country code for the issuer's jurisdiction. */
  jurisdiction: string;
  /** Optional regulator licence reference, e.g. `"ADGM-FSRA-23-9001"`. */
  licenseRef?: string;
  /**
   * UIDs of EAS schemas this issuer is authorised to sign attestations for.
   *
   * The verifier rejects any attestation whose `schemaId` is not present
   * in this allow-list, even if the signature is otherwise valid.
   */
  attestationSchemaUIDs: string[];
}

/* ─── Canonical schema IDs ─────────────────────────────────────────── */

/**
 * Aethelred KYC status attestation schema UID.
 *
 * Payload shape: {@link KycStatusPayload}.
 *
 * @example
 * ```ts
 * claim.schemaId === SCHEMA_KYC_STATUS
 * ```
 */
export const SCHEMA_KYC_STATUS = "aethel/kyc-status/v1" as const;

/**
 * Jurisdiction / residency attestation schema UID.
 *
 * Payload shape: {@link JurisdictionPayload}.
 */
export const SCHEMA_JURISDICTION = "aethel/jurisdiction/v1" as const;

/**
 * Accredited-investor attestation schema UID.
 *
 * Payload shape: {@link AccreditedInvestorPayload}.
 */
export const SCHEMA_ACCREDITED_INVESTOR = "aethel/accredited-investor/v1" as const;

/**
 * VASP licence attestation schema UID.
 *
 * Payload shape: {@link VaspLicensePayload}.
 */
export const SCHEMA_VASP_LICENSE = "aethel/vasp-license/v1" as const;

/**
 * Sanctions-clear attestation schema UID.
 *
 * Payload shape: {@link SanctionsClearPayload}.
 */
export const SCHEMA_SANCTIONS_CLEAR = "aethel/sanctions-clear/v1" as const;

/**
 * Branded string type for schema identifiers.
 *
 * Accepts the five canonical Aethelred schema constants plus any third-party
 * string UID that conforms to the `namespace/name/version` convention.
 */
export type SchemaId =
  | typeof SCHEMA_KYC_STATUS
  | typeof SCHEMA_JURISDICTION
  | typeof SCHEMA_ACCREDITED_INVESTOR
  | typeof SCHEMA_VASP_LICENSE
  | typeof SCHEMA_SANCTIONS_CLEAR
  | (string & { readonly __schemaBrand?: unique symbol });

/**
 * Claim embedded inside an {@link Attestation}.
 *
 * The `value` is typed via the discriminated-union helpers in `./payloads`;
 * `getPayload()` reads + checks the claim in one call.
 */
export interface CredentialClaim {
  /** Schema UID the `value` conforms to. */
  schemaId: SchemaId;
  /** Schema-specific payload (see `./payloads`). */
  value: unknown;
}

/**
 * A single signed attestation — the atomic building block of a verifiable
 * credential.
 *
 * @example
 * ```ts
 * if (att.expiresAt && att.expiresAt < Date.now()) throw new Error("stale");
 * ```
 */
export interface Attestation {
  /**
   * Deterministic attestation UID.
   *
   * Computed as `keccak256(schemaId || issuer.id || subject || issuedAt || nonce)`.
   * Two attestations with the same inputs collide by design — callers
   * must include a nonce when issuing multiple credentials with
   * otherwise-identical fields.
   */
  uid: `0x${string}`;
  /** Schema this attestation is signed against. */
  schemaId: SchemaId;
  /** Issuing party (full snapshot; no registry lookup required at verify time). */
  issuer: Issuer;
  /** Subject commitment — the holder's hashed identifier. */
  subject: SubjectCommitment;
  /** Claim payload. */
  claim: CredentialClaim;
  /** Unix millis — when the issuer minted the attestation. */
  issuedAt: number;
  /** Unix millis — optional expiry. Unset for permanent attestations. */
  expiresAt?: number;
  /** Whether the issuer retains the right to revoke this attestation. */
  revocable: boolean;
  /** Unix millis — set if the attestation has been revoked. */
  revokedAt?: number;
  /** Human-readable explanation for revocation (shown in the UI). */
  revocationReason?: string;
  /**
   * Compact secp256k1 ECDSA signature (64 bytes, `r || s`) over the
   * canonical encoding of the attestation. Verified against
   * `issuer.publicKeyHex` by {@link CredentialVerifier.verifyAttestation}.
   */
  signature: `0x${string}`;
  /** On-chain EAS transaction hash if the attestation was notarised. */
  onChainTxHash?: `0x${string}`;
  /**
   * Random nonce mixed into the UID hash to break ties between otherwise
   * identical attestations. Stored so the UID is reproducible.
   */
  nonce: `0x${string}`;
}

/**
 * Verifiable credential wrapper around an {@link Attestation}, optionally
 * carrying a selective-disclosure Merkle proof and a ZK commitment.
 *
 * The wrapper stays intentionally thin — selective-disclosure and ZK are
 * orthogonal opt-in features, not required for basic KYC + jurisdiction
 * checks.
 */
export interface VerifiableCredential {
  /** Signed attestation backing the credential. */
  attestation: Attestation;
  /** Optional Merkle proof for selective field disclosure. */
  selectiveDisclosureProof?: SelectiveDisclosureProof;
  /** Optional ZK commitment for private presentation. */
  zkCommitment?: ZkCommitment;
}

/**
 * Merkle-tree selective-disclosure proof.
 *
 * The attestation payload is split into leaves (one per field). The holder
 * reveals a subset of fields and the matching Merkle siblings; the verifier
 * reconstructs `merkleRoot` from the disclosed values + sibling hashes and
 * compares it to the attested commitment.
 *
 * @example
 * ```ts
 * const proof: SelectiveDisclosureProof = {
 *   disclosedFields: ["level", "sanctionsChecked"],
 *   concealedFieldHashes: ["0x..."],
 *   merkleRoot: "0x..." as `0x${string}`,
 *   merkleSiblings: ["0x..." as `0x${string}`],
 * };
 * ```
 */
export interface SelectiveDisclosureProof {
  /** Names of payload fields the holder is revealing. */
  disclosedFields: string[];
  /** Pre-hashed leaves for fields the holder is keeping private. */
  concealedFieldHashes: string[];
  /** Merkle root the verifier re-derives from disclosed + concealed leaves. */
  merkleRoot: `0x${string}`;
  /** Sibling hashes along the Merkle path. */
  merkleSiblings: `0x${string}`[];
}

/**
 * ZK commitment a holder presents in place of the full credential when
 * privacy is paramount (e.g. regulated DeFi gating).
 *
 * The marker only identifies the commitment *scheme* — the actual proof
 * transcript is out of band and is verified by the protocol's circuit,
 * not by this SDK.
 *
 * @example
 * ```ts
 * const commit: ZkCommitment = {
 *   scheme: "poseidon-v1",
 *   commitment: "0x" + "ab".repeat(32) as `0x${string}`,
 *   circuitId: "aethel-kyc-eu-accred-v1",
 * };
 * ```
 */
export interface ZkCommitment {
  /** Commitment scheme used by the circuit. */
  scheme: "poseidon-v1" | "pedersen-v1" | "sha256-stub";
  /** The commitment value itself (32-byte hex). */
  commitment: `0x${string}`;
  /** Circuit identifier the verifier must match to its proving key. */
  circuitId: string;
}

/**
 * Presentation request a counterparty sends to the holder's wallet.
 *
 * The request is DID-Auth-style: the counterparty states what claims it
 * needs, pins a `challenge` it expects the holder to sign, and sets an
 * expiry so stale requests cannot be replayed.
 *
 * @example
 * ```ts
 * const req: PresentationRequest = {
 *   requesterId: "cruzible-exchange",
 *   requesterName: "Cruzible",
 *   requiredClaims: [{ schemaId: SCHEMA_KYC_STATUS }],
 *   nonce: ("0x" + "aa".repeat(16)) as `0x${string}`,
 *   challenge: ("0x" + "bb".repeat(32)) as `0x${string}`,
 *   issuedAt: Date.now(),
 *   expiresAt: Date.now() + 60_000,
 * };
 * ```
 */
export interface PresentationRequest {
  /** Counterparty DID / stable id. */
  requesterId: string;
  /** Human-readable name (shown in consent dialog). */
  requesterName: string;
  /**
   * Claims the holder must disclose.
   *
   * Each entry names a schema and an optional predicate:
   *   - `eq` / `gte` / `lte` for scalar comparisons
   *   - `in` for set-membership tests
   *
   * A credential satisfies the requirement when the predicate holds
   * against the matching field of the attestation payload (or when no
   * predicate is given and a credential of that schema exists).
   */
  requiredClaims: Array<{
    schemaId: SchemaId;
    predicate?: {
      field: string;
      op: "eq" | "gte" | "lte" | "in";
      value: unknown;
    };
  }>;
  /** Random nonce the holder echoes back in the presentation. */
  nonce: `0x${string}`;
  /** Challenge the holder must sign with their subject key. */
  challenge: `0x${string}`;
  /** Unix millis the request was minted. */
  issuedAt: number;
  /** Unix millis after which the request must be rejected. */
  expiresAt: number;
}

/**
 * The holder's response to a {@link PresentationRequest}.
 *
 * `signature` is a secp256k1 signature over
 * `keccak256(nonce || challenge || uids...)` — binding the bundle to
 * the exact challenge the requester chose so the packet cannot be
 * replayed against a different request.
 */
export interface Presentation {
  /** Credentials the holder chose to disclose. */
  credentials: VerifiableCredential[];
  /** Echoed nonce from the request. */
  nonce: `0x${string}`;
  /** Holder signature binding the credentials to the challenge. */
  signature: `0x${string}`;
  /** Unix millis the presentation was built. */
  presentedAt: number;
}

/**
 * Structured verification result.
 *
 * `errorCode` is a closed vocabulary so compliance tooling can triage
 * failures without parsing `errorDetail`. `warnings` carries non-fatal
 * observations — for instance, that a ZK commitment was not
 * independently verified by this SDK and must be re-checked by the
 * circuit layer.
 */
export interface VerificationResult {
  /** `true` iff every check passed (warnings do NOT fail the check). */
  valid: boolean;
  /** Closed-vocabulary error code when `valid === false`. */
  errorCode?:
    | "signature-invalid"
    | "expired"
    | "revoked"
    | "issuer-not-trusted"
    | "schema-unknown"
    | "challenge-mismatch"
    | "predicate-unsatisfied"
    | "subject-mismatch"
    | "nonce-mismatch"
    | "credential-missing";
  /** Free-form human-readable detail (safe to log). */
  errorDetail?: string;
  /** Unix millis when the check ran — helpful for audit chains. */
  verifiedAt: number;
  /** Non-fatal observations. */
  warnings: string[];
}

/* ─── Error taxonomy ──────────────────────────────────────────────── */

/**
 * Base error for every credential-related failure.
 *
 * Carries a machine-readable `code` field so audit tooling can pattern
 * match without parsing the message.
 *
 * @example
 * ```ts
 * try {
 *   await verifier.verifyAttestation(att);
 * } catch (err) {
 *   if (err instanceof CredentialError && err.code === "issuer-not-trusted") {
 *     // Route to manual review queue
 *   }
 * }
 * ```
 */
export class CredentialError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CredentialError";
    this.code = code;
  }
}

/**
 * Thrown when an attestation cannot be parsed, signed, or verified.
 */
export class AttestationError extends CredentialError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "AttestationError";
  }
}

/**
 * Thrown when a presentation fails binding, challenge, or claim-satisfaction
 * checks.
 */
export class PresentationError extends CredentialError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "PresentationError";
  }
}
