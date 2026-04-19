/**
 * Registry of well-known credential issuers.
 *
 * This module ships a seed list of identity vendors and regulators whose
 * signatures the Aethelred verifier will accept once their real public
 * keys are published. During the bootstrap phase every issuer carries a
 * placeholder compressed secp256k1 key (`0x00...00`, 33 bytes) — the
 * verifier rejects placeholders unless the deployment explicitly opts
 * into `allowPlaceholderKeys`.
 *
 * Helpers:
 *   - {@link getIssuer}                 — lookup by stable id
 *   - {@link listIssuersByRole}         — filter by {@link IssuerRole}
 *   - {@link listIssuersByJurisdiction} — filter by ISO 3166-1 alpha-2
 *
 * @packageDocumentation
 */

import {
  type Issuer,
  type IssuerRole,
  SCHEMA_KYC_STATUS,
  SCHEMA_JURISDICTION,
  SCHEMA_ACCREDITED_INVESTOR,
  SCHEMA_VASP_LICENSE,
  SCHEMA_SANCTIONS_CLEAR,
} from "./types";

/**
 * Placeholder compressed secp256k1 public key (33 bytes, hex-encoded).
 *
 * Real issuer pubkeys land once each vendor onboards and publishes a
 * signing key via the governance process. Until then verifiers reject
 * this sentinel unless {@link CredentialVerifierConfig.allowPlaceholderKeys}
 * is explicitly enabled (staging-only).
 */
export const PLACEHOLDER_PUBLIC_KEY: `0x${string}` = `0x${"00".repeat(33)}` as `0x${string}`;

/* ─── Well-known issuer seed list ──────────────────────────────── */

/**
 * Canonical seed list of issuers.
 *
 * Keys are human-friendly stable ids; the wallet pins attestations to
 * these ids rather than to the placeholder pubkeys so the registry can
 * be rotated without invalidating audit rows.
 *
 * @example
 * ```ts
 * const sumsub = WELL_KNOWN_ISSUERS["sumsub-global"];
 * ```
 */
export const WELL_KNOWN_ISSUERS: Record<string, Issuer> = {
  "sumsub-global": {
    id: "sumsub-global",
    name: "Sumsub Global KYC",
    role: "kyc-provider",
    // TODO(credentials): replace with Sumsub Global's published signing key
    // once they publish their well-known EAS attester identity.
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "GB",
    licenseRef: "FCA-905962",
    attestationSchemaUIDs: [SCHEMA_KYC_STATUS, SCHEMA_SANCTIONS_CLEAR],
  },
  "fractal-id": {
    id: "fractal-id",
    name: "Fractal ID",
    role: "kyc-provider",
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "DE",
    licenseRef: "BaFin-fractal-2024",
    attestationSchemaUIDs: [
      SCHEMA_KYC_STATUS,
      SCHEMA_JURISDICTION,
      SCHEMA_SANCTIONS_CLEAR,
    ],
  },
  "parallel-markets": {
    id: "parallel-markets",
    name: "Parallel Markets",
    role: "accredited-investor-verifier",
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "US",
    licenseRef: "FINRA-parallel-2022",
    attestationSchemaUIDs: [SCHEMA_ACCREDITED_INVESTOR],
  },
  "vara-issuer": {
    id: "vara-issuer",
    name: "VARA (UAE)",
    role: "vasp-registrar",
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "AE",
    licenseRef: "VARA-Regulator",
    attestationSchemaUIDs: [SCHEMA_VASP_LICENSE, SCHEMA_JURISDICTION],
  },
  "mica-issuer": {
    id: "mica-issuer",
    name: "MiCA (EU)",
    role: "vasp-registrar",
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "EU",
    licenseRef: "MiCA-Passporting-Authority",
    attestationSchemaUIDs: [SCHEMA_VASP_LICENSE, SCHEMA_JURISDICTION],
  },
  "fsra-issuer": {
    id: "fsra-issuer",
    name: "ADGM FSRA",
    role: "vasp-registrar",
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "AE",
    licenseRef: "ADGM-FSRA-Registrar",
    attestationSchemaUIDs: [SCHEMA_VASP_LICENSE, SCHEMA_JURISDICTION],
  },
  chainalysis: {
    id: "chainalysis",
    name: "Chainalysis",
    role: "chain-analytics",
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "US",
    attestationSchemaUIDs: [SCHEMA_SANCTIONS_CLEAR],
  },
  "trm-labs": {
    id: "trm-labs",
    name: "TRM Labs",
    role: "chain-analytics",
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "US",
    attestationSchemaUIDs: [SCHEMA_SANCTIONS_CLEAR],
  },
  "ofac-sanctions-list": {
    id: "ofac-sanctions-list",
    name: "US OFAC",
    role: "aml-provider",
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "US",
    licenseRef: "Treasury-OFAC",
    attestationSchemaUIDs: [SCHEMA_SANCTIONS_CLEAR],
  },
  "aethelred-self": {
    id: "aethelred-self",
    name: "Aethelred Self-Attested",
    role: "self",
    publicKeyHex: PLACEHOLDER_PUBLIC_KEY,
    jurisdiction: "AE",
    attestationSchemaUIDs: [
      SCHEMA_KYC_STATUS,
      SCHEMA_JURISDICTION,
      SCHEMA_ACCREDITED_INVESTOR,
      SCHEMA_VASP_LICENSE,
      SCHEMA_SANCTIONS_CLEAR,
    ],
  },
};

/**
 * Lookup an issuer by its stable identifier.
 *
 * @param id - stable issuer id (e.g. `"sumsub-global"`)
 * @returns the {@link Issuer} or `undefined` if not registered
 *
 * @example
 * ```ts
 * const issuer = getIssuer("fractal-id");
 * if (!issuer) throw new Error("unknown issuer");
 * ```
 */
export function getIssuer(id: string): Issuer | undefined {
  return WELL_KNOWN_ISSUERS[id];
}

/**
 * Return every registered issuer with the matching role.
 *
 * @param role - {@link IssuerRole} to filter on
 *
 * @example
 * ```ts
 * const kycProviders = listIssuersByRole("kyc-provider");
 * ```
 */
export function listIssuersByRole(role: IssuerRole): Issuer[] {
  return Object.values(WELL_KNOWN_ISSUERS).filter((i) => i.role === role);
}

/**
 * Return every registered issuer for the given ISO 3166-1 alpha-2 code.
 *
 * @param iso - ISO 3166-1 alpha-2 country code (case-insensitive) or `"EU"`
 *
 * @example
 * ```ts
 * const eu = listIssuersByJurisdiction("EU");
 * ```
 */
export function listIssuersByJurisdiction(iso: string): Issuer[] {
  const upper = iso.toUpperCase();
  return Object.values(WELL_KNOWN_ISSUERS).filter(
    (i) => i.jurisdiction.toUpperCase() === upper
  );
}

/**
 * Return every registered issuer as a flat array.
 *
 * Primarily used by the verifier's default-trust bootstrap and by the
 * UI's issuer picker.
 */
export function listAllIssuers(): Issuer[] {
  return Object.values(WELL_KNOWN_ISSUERS);
}

/**
 * `true` if the issuer is currently using the placeholder public key.
 *
 * Deployments that require real cryptography should refuse to accept
 * attestations whose issuer returns `true` here.
 *
 * @example
 * ```ts
 * if (isPlaceholderIssuer(issuer)) console.warn("pre-production issuer");
 * ```
 */
export function isPlaceholderIssuer(issuer: Issuer): boolean {
  return issuer.publicKeyHex.toLowerCase() === PLACEHOLDER_PUBLIC_KEY.toLowerCase();
}

/**
 * Register an additional issuer at runtime.
 *
 * Useful for enterprise deployments that publish an internal vendor
 * registry — the wallet bootstraps the canonical list, then calls
 * `registerIssuer()` for each internal signer at load time.
 *
 * @param issuer - the issuer to register
 * @returns the registered issuer (same reference)
 * @throws CredentialError if an issuer with the same id already exists
 *
 * @example
 * ```ts
 * registerIssuer({ id: "internal-compliance", ... });
 * ```
 */
export function registerIssuer(issuer: Issuer): Issuer {
  if (WELL_KNOWN_ISSUERS[issuer.id]) {
    throw new Error(
      `Issuer ${issuer.id} already registered — unregister first`
    );
  }
  WELL_KNOWN_ISSUERS[issuer.id] = issuer;
  return issuer;
}

/**
 * Remove a previously registered issuer.
 *
 * Seed issuers can be removed via this helper for test isolation; the
 * caller is responsible for re-registering them if needed.
 *
 * @param id - stable id
 * @returns `true` if an issuer was removed, `false` if no match
 */
export function unregisterIssuer(id: string): boolean {
  if (!WELL_KNOWN_ISSUERS[id]) return false;
  delete WELL_KNOWN_ISSUERS[id];
  return true;
}
