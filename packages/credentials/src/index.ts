/**
 * @packageDocumentation
 *
 * `@aethelred/wallet-credentials` — the Regulatory Passport as Verifiable
 * Credentials (Moat #2 of the Aethelred Wallet).
 *
 * The package ships the primitives a regulated counterparty needs in order
 * to prove KYC / AML status, jurisdiction, accredited-investor tier, or
 * VASP licence class without leaking raw identity data. Every attestation
 * is EAS-style (schema-first, UID-addressed) and signed by a well-known
 * issuer; verifiers pin the trusted-issuer set and re-derive each UID
 * canonically before checking the signature.
 *
 * ## Shape
 *
 * | Module              | Purpose                                                     |
 * | ------------------- | ----------------------------------------------------------- |
 * | `types`             | Attestations, presentations, verification results, errors   |
 * | `payloads`          | Typed discriminated-union payloads for every canonical schema |
 * | `issuer-registry`   | Well-known issuer seed list and lookup helpers              |
 * | `canonical`         | Deterministic canonical encoding + hash helpers             |
 * | `credential-manager`| Store + presentation builder                                |
 * | `verifier`          | Signature + binding + predicate verifier                    |
 *
 * @example
 * ```ts
 * import {
 *   CredentialManager,
 *   CredentialVerifier,
 *   SCHEMA_KYC_STATUS,
 *   listAllIssuers,
 * } from "@aethelred/wallet-credentials";
 *
 * const manager = new CredentialManager();
 * const verifier = new CredentialVerifier({ trustedIssuers: listAllIssuers() });
 * ```
 */

/* ─── Types ────────────────────────────────────────────────────── */

export type {
  SubjectCommitment,
  Issuer,
  IssuerRole,
  SchemaId,
  CredentialClaim,
  Attestation,
  VerifiableCredential,
  SelectiveDisclosureProof,
  ZkCommitment,
  PresentationRequest,
  Presentation,
  VerificationResult,
} from "./types";

export {
  SCHEMA_KYC_STATUS,
  SCHEMA_JURISDICTION,
  SCHEMA_ACCREDITED_INVESTOR,
  SCHEMA_VASP_LICENSE,
  SCHEMA_SANCTIONS_CLEAR,
  CredentialError,
  AttestationError,
  PresentationError,
} from "./types";

/* ─── Payloads ─────────────────────────────────────────────────── */

export type {
  KycStatusPayload,
  JurisdictionPayload,
  AccreditedInvestorPayload,
  VaspLicensePayload,
  SanctionsClearPayload,
  PayloadTypeMap,
} from "./payloads";

export { getPayload, getPayloadUnsafe } from "./payloads";

/* ─── Issuer registry ──────────────────────────────────────────── */

export {
  WELL_KNOWN_ISSUERS,
  PLACEHOLDER_PUBLIC_KEY,
  getIssuer,
  listIssuersByRole,
  listIssuersByJurisdiction,
  listAllIssuers,
  isPlaceholderIssuer,
  registerIssuer,
  unregisterIssuer,
} from "./issuer-registry";

/* ─── Canonical encoding ───────────────────────────────────────── */

export {
  bytesToHex,
  hexToBytes,
  canonicalJson,
  keccak256Hex,
  sha256Hex,
  computeAttestationUid,
  canonicalAttestationBytes,
  canonicalAttestationHash,
  canonicalPresentationBytes,
  canonicalPresentationHash,
  type HexString,
} from "./canonical";

/* ─── Credential manager ───────────────────────────────────────── */

export {
  CredentialManager,
  InMemoryCredentialStore,
  computeSubjectPublicKey,
  type CredentialStore,
  type CredentialListFilter,
  type CredentialManagerConfig,
} from "./credential-manager";

/* ─── Verifier ─────────────────────────────────────────────────── */

export {
  CredentialVerifier,
  signAttestation,
  type CredentialVerifierConfig,
} from "./verifier";
