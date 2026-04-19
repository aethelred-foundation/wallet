/**
 * Typed discriminated-union payloads for every canonical Aethelred schema.
 *
 * Each payload interface maps 1:1 onto a `SchemaId` constant from `./types`.
 * `getPayload()` is the safe reader: it checks the attestation's `schemaId`
 * against the expected schema, validates the payload shape, and returns
 * a strongly-typed value — throwing `AttestationError` on mismatch.
 *
 * @packageDocumentation
 */

import {
  type Attestation,
  type SchemaId,
  SCHEMA_KYC_STATUS,
  SCHEMA_JURISDICTION,
  SCHEMA_ACCREDITED_INVESTOR,
  SCHEMA_VASP_LICENSE,
  SCHEMA_SANCTIONS_CLEAR,
  AttestationError,
} from "./types";

/* ─── Payload shapes ─────────────────────────────────────────────── */

/**
 * KYC tier the issuer has verified for the subject.
 *
 *   - `none`          no KYC on file
 *   - `basic`         e-mail + one government ID
 *   - `enhanced`      basic + proof of address + sanctions + PEP screening
 *   - `institutional` enhanced + UBO / structure chart for entities
 *
 * @example
 * ```ts
 * const kyc: KycStatusPayload = {
 *   level: "enhanced",
 *   providerRef: "sumsub:acct_abc123",
 *   completedAt: Date.now(),
 *   sanctionsChecked: true,
 *   pepChecked: true,
 * };
 * ```
 */
export interface KycStatusPayload {
  /** Tier the issuer signed off on. */
  level: "none" | "basic" | "enhanced" | "institutional";
  /** Vendor-side reference the issuer's CRM can map back to a case. */
  providerRef: string;
  /** Unix millis — when the vendor marked the check complete. */
  completedAt: number;
  /** Unix millis — when this status should be re-checked. */
  validUntil?: number;
  /** Whether OFAC / UN / EU sanctions screening ran. */
  sanctionsChecked: boolean;
  /** Whether politically-exposed-person screening ran. */
  pepChecked: boolean;
}

/**
 * Subject's jurisdiction of residency or incorporation.
 *
 * @example
 * ```ts
 * const j: JurisdictionPayload = {
 *   country: "AE",
 *   region: "ADGM",
 *   residencyBasis: "registered-entity",
 * };
 * ```
 */
export interface JurisdictionPayload {
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  /** Sub-national region, e.g. `"ADGM"`, `"Delaware"`. */
  region?: string;
  /** Basis on which the issuer determined the residency. */
  residencyBasis: "citizen" | "resident" | "registered-entity";
}

/**
 * Accredited-investor status per a named legal regime.
 *
 * @example
 * ```ts
 * const a: AccreditedInvestorPayload = {
 *   jurisdiction: "US",
 *   basis: "regulation-d-506c",
 *   verifiedAt: Date.now(),
 *   verifiedBy: "parallel-markets",
 * };
 * ```
 */
export interface AccreditedInvestorPayload {
  /** Jurisdiction whose accreditation rules the issuer applied. */
  jurisdiction: string;
  /** Basis the issuer used to attest (statute-specific). */
  basis: "income" | "net-worth" | "entity-type" | "regulation-d-506c";
  /** Unix millis — when the verification was conducted. */
  verifiedAt: number;
  /** Vendor id that performed the verification. */
  verifiedBy: string;
}

/**
 * VASP licence attested by a regulator.
 *
 * @example
 * ```ts
 * const v: VaspLicensePayload = {
 *   licenseClass: "custodian",
 *   regulator: "ADGM FSRA",
 *   licenseId: "FSRA-23-9001",
 *   issuedAt: Date.now(),
 * };
 * ```
 */
export interface VaspLicensePayload {
  /** Licence class the regulator granted. */
  licenseClass:
    | "exchange"
    | "custodian"
    | "broker-dealer"
    | "issuer"
    | "investment-advisor";
  /** Regulator name, e.g. `"ADGM FSRA"`, `"VARA"`, `"MiCA passport"`. */
  regulator: string;
  /** Regulator-issued licence identifier. */
  licenseId: string;
  /** Unix millis — licence issue date. */
  issuedAt: number;
  /** Unix millis — licence expiry, if time-bounded. */
  validUntil?: number;
}

/**
 * Proof that the subject is clear against a set of sanctions lists at a
 * specific point in time.
 *
 * @example
 * ```ts
 * const s: SanctionsClearPayload = {
 *   listsChecked: ["OFAC-SDN", "UN-1267", "EU-consolidated"],
 *   clearedAt: Date.now(),
 *   dataSourceRefs: ["ofac:2026-04-18", "un1267:2026-04-18"],
 * };
 * ```
 */
export interface SanctionsClearPayload {
  /** Canonical list identifiers the issuer screened against. */
  listsChecked: string[];
  /** Unix millis — when the screening ran. */
  clearedAt: number;
  /** Dated references so the screening can be audited. */
  dataSourceRefs: string[];
}

/* ─── Mapping helpers ────────────────────────────────────────────── */

/**
 * Schema-to-payload map used by {@link getPayload}.
 *
 * Callers generally don't need to reference this directly — it's exported
 * so third parties can extend the registry with their own schemas.
 */
export interface PayloadTypeMap {
  [SCHEMA_KYC_STATUS]: KycStatusPayload;
  [SCHEMA_JURISDICTION]: JurisdictionPayload;
  [SCHEMA_ACCREDITED_INVESTOR]: AccreditedInvestorPayload;
  [SCHEMA_VASP_LICENSE]: VaspLicensePayload;
  [SCHEMA_SANCTIONS_CLEAR]: SanctionsClearPayload;
}

/**
 * Type-safe typed reader for an attestation's claim payload.
 *
 * Validates:
 *   1. the attestation's `schemaId` matches the `expectedSchema` argument;
 *   2. the claim payload is a non-null object with all required fields.
 *
 * @param att - the attestation to read from
 * @param expectedSchema - the schema the caller expects
 * @returns the typed payload
 * @throws AttestationError if the schema mismatches or the payload is malformed
 *
 * @example
 * ```ts
 * const kyc = getPayload(att, SCHEMA_KYC_STATUS);
 * if (kyc.level === "institutional") { ... }
 * ```
 */
export function getPayload<K extends keyof PayloadTypeMap>(
  att: Attestation,
  expectedSchema: K
): PayloadTypeMap[K] {
  if (att.schemaId !== expectedSchema) {
    throw new AttestationError(
      "schema-mismatch",
      `Expected schema ${String(expectedSchema)}, got ${String(att.schemaId)}`
    );
  }
  if (att.claim.schemaId !== att.schemaId) {
    throw new AttestationError(
      "schema-mismatch",
      "Claim schema does not match attestation schema"
    );
  }
  const value = att.claim.value;
  if (value === null || typeof value !== "object") {
    throw new AttestationError(
      "payload-malformed",
      "Claim payload is not an object"
    );
  }
  validatePayload(expectedSchema, value as Record<string, unknown>);
  return value as PayloadTypeMap[K];
}

/**
 * Lenient reader for third-party schemas.
 *
 * When a counterparty issues attestations against a schema the Aethelred
 * wallet does not know about, `getPayload` rejects the read. Callers who
 * want to accept unknown schemas can reach for this helper, which returns
 * the raw `unknown` payload without validation.
 *
 * @param att - the attestation to read from
 * @param schemaId - a schema UID the caller is opting into
 * @returns the raw payload
 *
 * @example
 * ```ts
 * const unknown = getPayloadUnsafe(att, "3rd-party/foo/v1");
 * ```
 */
export function getPayloadUnsafe(att: Attestation, schemaId: SchemaId): unknown {
  if (att.schemaId !== schemaId) {
    throw new AttestationError(
      "schema-mismatch",
      `Expected schema ${String(schemaId)}, got ${String(att.schemaId)}`
    );
  }
  return att.claim.value;
}

/* ─── Per-schema structural validators ───────────────────────────── */

function validatePayload<K extends keyof PayloadTypeMap>(
  schema: K,
  value: Record<string, unknown>
): void {
  switch (schema) {
    case SCHEMA_KYC_STATUS:
      requireStringUnion(value, "level", [
        "none",
        "basic",
        "enhanced",
        "institutional",
      ]);
      requireString(value, "providerRef");
      requireNumber(value, "completedAt");
      requireOptionalNumber(value, "validUntil");
      requireBoolean(value, "sanctionsChecked");
      requireBoolean(value, "pepChecked");
      return;
    case SCHEMA_JURISDICTION:
      requireString(value, "country");
      requireOptionalString(value, "region");
      requireStringUnion(value, "residencyBasis", [
        "citizen",
        "resident",
        "registered-entity",
      ]);
      return;
    case SCHEMA_ACCREDITED_INVESTOR:
      requireString(value, "jurisdiction");
      requireStringUnion(value, "basis", [
        "income",
        "net-worth",
        "entity-type",
        "regulation-d-506c",
      ]);
      requireNumber(value, "verifiedAt");
      requireString(value, "verifiedBy");
      return;
    case SCHEMA_VASP_LICENSE:
      requireStringUnion(value, "licenseClass", [
        "exchange",
        "custodian",
        "broker-dealer",
        "issuer",
        "investment-advisor",
      ]);
      requireString(value, "regulator");
      requireString(value, "licenseId");
      requireNumber(value, "issuedAt");
      requireOptionalNumber(value, "validUntil");
      return;
    case SCHEMA_SANCTIONS_CLEAR:
      requireStringArray(value, "listsChecked");
      requireNumber(value, "clearedAt");
      requireStringArray(value, "dataSourceRefs");
      return;
    default: {
      // Exhaustive check — helps catch missing cases at compile time.
      const _exhaustive: never = schema;
      void _exhaustive;
      throw new AttestationError(
        "schema-unknown",
        `Unknown schema ${String(schema)}`
      );
    }
  }
}

function requireString(obj: Record<string, unknown>, field: string): void {
  if (typeof obj[field] !== "string") {
    throw new AttestationError(
      "payload-malformed",
      `Field ${field} must be a string`
    );
  }
}
function requireOptionalString(
  obj: Record<string, unknown>,
  field: string
): void {
  if (obj[field] !== undefined && typeof obj[field] !== "string") {
    throw new AttestationError(
      "payload-malformed",
      `Field ${field} must be a string when set`
    );
  }
}
function requireStringArray(
  obj: Record<string, unknown>,
  field: string
): void {
  const v = obj[field];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new AttestationError(
      "payload-malformed",
      `Field ${field} must be a string[]`
    );
  }
}
function requireNumber(obj: Record<string, unknown>, field: string): void {
  if (typeof obj[field] !== "number" || !Number.isFinite(obj[field])) {
    throw new AttestationError(
      "payload-malformed",
      `Field ${field} must be a finite number`
    );
  }
}
function requireOptionalNumber(
  obj: Record<string, unknown>,
  field: string
): void {
  const v = obj[field];
  if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) {
    throw new AttestationError(
      "payload-malformed",
      `Field ${field} must be a finite number when set`
    );
  }
}
function requireBoolean(obj: Record<string, unknown>, field: string): void {
  if (typeof obj[field] !== "boolean") {
    throw new AttestationError(
      "payload-malformed",
      `Field ${field} must be a boolean`
    );
  }
}
function requireStringUnion(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly string[]
): void {
  const v = obj[field];
  if (typeof v !== "string" || !allowed.includes(v)) {
    throw new AttestationError(
      "payload-malformed",
      `Field ${field} must be one of ${allowed.join(", ")}`
    );
  }
}
