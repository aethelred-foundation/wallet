/**
 * Test suite for the Regulatory Passport — Verifiable Credentials
 * package (Moat #2 of the Aethelred Wallet).
 *
 * The suite exercises the full surface:
 *   - deterministic attestation UID derivation
 *   - CredentialManager persistence, filtering, revocation, presentation
 *   - CredentialVerifier trust bundle, expiry, revocation, signature,
 *     presentation binding, predicate evaluation
 *   - Typed payload readers
 *   - Issuer registry helpers
 *   - Selective-disclosure and ZK commitment structural paths
 *
 * Every test uses an injected clock so we never depend on wall-clock
 * ordering, and real secp256k1 signatures are produced + verified (not
 * stubbed) to prove the canonical encoding round-trips across the
 * manager/verifier boundary.
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as secp from "@noble/secp256k1";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

import {
  CredentialManager,
  CredentialVerifier,
  SCHEMA_KYC_STATUS,
  SCHEMA_JURISDICTION,
  SCHEMA_ACCREDITED_INVESTOR,
  SCHEMA_VASP_LICENSE,
  SCHEMA_SANCTIONS_CLEAR,
  bytesToHex,
  canonicalJson,
  computeAttestationUid,
  getIssuer,
  getPayload,
  isPlaceholderIssuer,
  listAllIssuers,
  listIssuersByJurisdiction,
  listIssuersByRole,
  signAttestation,
  type Attestation,
  type Issuer,
  type Presentation,
  type PresentationRequest,
  type SubjectCommitment,
  type VerifiableCredential,
} from "@aethelred/wallet-credentials";

/* ─── secp256k1 bootstrap (required by @noble/secp256k1 v2) ───────── */

if (!secp.etc.hmacSha256Sync) {
  secp.etc.hmacSha256Sync = (key, ...msgs) =>
    hmac(sha256, key, secp.etc.concatBytes(...msgs));
}

/* ─── Fixtures ────────────────────────────────────────────────── */

const NOW = 1_700_000_000_000;
const SUBJECT: SubjectCommitment = `0x${"aa".repeat(32)}` as SubjectCommitment;

const ISSUER_PRIV: `0x${string}` = `0x${"11".repeat(32)}` as `0x${string}`;
const ISSUER_PUB_BYTES = secp.getPublicKey(hexBytes(ISSUER_PRIV), true);
const ISSUER_PUB_HEX = bytesToHex(ISSUER_PUB_BYTES);

const OTHER_PRIV: `0x${string}` = `0x${"22".repeat(32)}` as `0x${string}`;

const TRUSTED_ISSUER: Issuer = {
  id: "test-issuer",
  name: "Test Issuer",
  role: "kyc-provider",
  publicKeyHex: ISSUER_PUB_HEX,
  jurisdiction: "AE",
  licenseRef: "TEST-9001",
  attestationSchemaUIDs: [
    SCHEMA_KYC_STATUS,
    SCHEMA_JURISDICTION,
    SCHEMA_ACCREDITED_INVESTOR,
    SCHEMA_VASP_LICENSE,
    SCHEMA_SANCTIONS_CLEAR,
  ],
};

function hexBytes(hex: `0x${string}`): Uint8Array {
  const b = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < b.length; i++) {
    b[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return b;
}

/**
 * Build a fully-signed attestation deterministically. Tests use this
 * to share the base shape and override fields as needed.
 */
function buildAttestation(
  overrides: Partial<Omit<Attestation, "uid" | "signature">> & {
    signWith?: `0x${string}`;
  } = {}
): Attestation {
  const base: Omit<Attestation, "uid" | "signature"> = {
    schemaId: SCHEMA_KYC_STATUS,
    issuer: TRUSTED_ISSUER,
    subject: SUBJECT,
    claim: {
      schemaId: SCHEMA_KYC_STATUS,
      value: {
        level: "enhanced",
        providerRef: "test:acct_a",
        completedAt: NOW - 60_000,
        sanctionsChecked: true,
        pepChecked: true,
      },
    },
    issuedAt: NOW - 60_000,
    expiresAt: NOW + 10 * 60_000,
    revocable: true,
    nonce: `0x${"bb".repeat(16)}` as `0x${string}`,
    ...overrides,
  };
  // Recompute UID canonically.
  const uid = computeAttestationUid({
    schemaId: base.schemaId as string,
    issuerId: base.issuer.id,
    subject: base.subject,
    issuedAt: base.issuedAt,
    nonce: base.nonce,
  });
  const unsigned: Attestation = {
    ...base,
    uid,
    signature: `0x${"00".repeat(64)}` as `0x${string}`,
  };
  const signWith = overrides.signWith ?? ISSUER_PRIV;
  const signature = signAttestation(unsigned, signWith);
  return { ...unsigned, signature };
}

function wrap(att: Attestation): VerifiableCredential {
  return { attestation: att };
}

/* ─── Tests ─────────────────────────────────────────────────────── */

describe("Attestation UID is deterministic", () => {
  it("derives the same UID for the same inputs", () => {
    const a = buildAttestation();
    const b = buildAttestation();
    expect(a.uid).toEqual(b.uid);
  });

  it("changes the UID when a field changes", () => {
    const a = buildAttestation();
    const b = buildAttestation({ issuedAt: NOW - 30_000 });
    expect(a.uid).not.toEqual(b.uid);
  });
});

describe("CredentialManager", () => {
  let manager: CredentialManager;
  beforeEach(() => {
    manager = new CredentialManager({ clock: () => NOW });
  });

  it("stores and retrieves a credential by UID", async () => {
    const cred = wrap(buildAttestation());
    await manager.storeCredential(cred);
    const round = await manager.getCredential(cred.attestation.uid);
    expect(round?.attestation.uid).toEqual(cred.attestation.uid);
  });

  it("filters listCredentials by schemaId", async () => {
    const kyc = wrap(buildAttestation());
    const juris = wrap(
      buildAttestation({
        schemaId: SCHEMA_JURISDICTION,
        claim: {
          schemaId: SCHEMA_JURISDICTION,
          value: {
            country: "AE",
            region: "ADGM",
            residencyBasis: "registered-entity",
          },
        },
        nonce: `0x${"cc".repeat(16)}` as `0x${string}`,
      })
    );
    await manager.storeCredential(kyc);
    await manager.storeCredential(juris);
    const onlyKyc = await manager.listCredentials({
      schemaId: SCHEMA_KYC_STATUS,
    });
    expect(onlyKyc).toHaveLength(1);
    expect(onlyKyc[0].attestation.schemaId).toEqual(SCHEMA_KYC_STATUS);
  });

  it("filters listCredentials by issuerId", async () => {
    const mine = wrap(buildAttestation());
    const other = wrap(
      buildAttestation({
        issuer: { ...TRUSTED_ISSUER, id: "other-issuer" },
        nonce: `0x${"dd".repeat(16)}` as `0x${string}`,
      })
    );
    await manager.storeCredential(mine);
    await manager.storeCredential(other);
    const got = await manager.listCredentials({ issuerId: "test-issuer" });
    expect(got).toHaveLength(1);
    expect(got[0].attestation.issuer.id).toEqual("test-issuer");
  });

  it("filters listCredentials by unexpiredOnly", async () => {
    const live = wrap(buildAttestation());
    const stale = wrap(
      buildAttestation({
        expiresAt: NOW - 60_000,
        nonce: `0x${"ee".repeat(16)}` as `0x${string}`,
      })
    );
    await manager.storeCredential(live);
    await manager.storeCredential(stale);
    const fresh = await manager.listCredentials({ unexpiredOnly: true });
    expect(fresh).toHaveLength(1);
    expect(fresh[0].attestation.uid).toEqual(live.attestation.uid);
  });

  it("marks a credential revoked via revokeCredential", async () => {
    const cred = wrap(buildAttestation());
    await manager.storeCredential(cred);
    await manager.revokeCredential(cred.attestation.uid, "lost device", "tester");
    const fresh = await manager.getCredential(cred.attestation.uid);
    expect(fresh?.attestation.revokedAt).toBeDefined();
    expect(fresh?.attestation.revocationReason).toContain("lost device");
  });

  it("hides revoked credentials by default but includes them when requested", async () => {
    const cred = wrap(buildAttestation());
    await manager.storeCredential(cred);
    await manager.revokeCredential(cred.attestation.uid, "rotated", "tester");
    const visible = await manager.listCredentials();
    expect(visible).toHaveLength(0);
    const withRevoked = await manager.listCredentials({ includeRevoked: true });
    expect(withRevoked).toHaveLength(1);
  });
});

describe("CredentialVerifier", () => {
  let verifier: CredentialVerifier;
  beforeEach(() => {
    verifier = new CredentialVerifier({
      trustedIssuers: [TRUSTED_ISSUER],
      clockSkewMs: 1_000,
      clock: () => NOW,
    });
  });

  it("rejects attestation from an unknown issuer", async () => {
    const att = buildAttestation({
      issuer: { ...TRUSTED_ISSUER, id: "someone-else" },
    });
    const res = await verifier.verifyAttestation(att);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toEqual("issuer-not-trusted");
  });

  it("rejects attestation past expiresAt", async () => {
    const att = buildAttestation({ expiresAt: NOW - 60_000 });
    const res = await verifier.verifyAttestation(att);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toEqual("expired");
  });

  it("rejects a revoked attestation", async () => {
    const att = buildAttestation();
    const revoked: Attestation = {
      ...att,
      revokedAt: NOW - 10_000,
      revocationReason: "test",
    };
    const res = await verifier.verifyAttestation(revoked);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toEqual("revoked");
  });

  it("rejects an attestation signed by the wrong key (real secp256k1)", async () => {
    const att = buildAttestation({ signWith: OTHER_PRIV });
    const res = await verifier.verifyAttestation(att);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toEqual("signature-invalid");
  });

  it("accepts a valid attestation from a trusted issuer", async () => {
    const att = buildAttestation();
    const res = await verifier.verifyAttestation(att);
    expect(res.valid).toBe(true);
    expect(res.errorCode).toBeUndefined();
  });

  it("rejects an attestation whose UID has been tampered with", async () => {
    const att = buildAttestation();
    const tampered: Attestation = {
      ...att,
      uid: `0x${"ff".repeat(32)}` as `0x${string}`,
    };
    const res = await verifier.verifyAttestation(tampered);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toEqual("signature-invalid");
  });
});

describe("Presentation flow", () => {
  let manager: CredentialManager;
  let verifier: CredentialVerifier;
  const subjectPriv: `0x${string}` = `0x${"33".repeat(32)}` as `0x${string}`;

  beforeEach(() => {
    manager = new CredentialManager({ clock: () => NOW });
    verifier = new CredentialVerifier({
      trustedIssuers: [TRUSTED_ISSUER],
      clockSkewMs: 1_000,
      clock: () => NOW,
    });
  });

  function buildRequest(
    overrides: Partial<PresentationRequest> = {}
  ): PresentationRequest {
    return {
      requesterId: "cruzible",
      requesterName: "Cruzible",
      requiredClaims: [{ schemaId: SCHEMA_KYC_STATUS }],
      nonce: `0x${"11".repeat(16)}` as `0x${string}`,
      challenge: `0x${"22".repeat(32)}` as `0x${string}`,
      issuedAt: NOW - 1_000,
      expiresAt: NOW + 60_000,
      ...overrides,
    };
  }

  it("verifies a presentation whose nonce + challenge match the request", async () => {
    const cred = wrap(buildAttestation());
    await manager.storeCredential(cred);
    const request = buildRequest();
    const pres = await manager.buildPresentation(
      request,
      [cred.attestation.uid],
      subjectPriv
    );
    const res = await verifier.verifyPresentation(pres, request);
    expect(res.valid).toBe(true);
  });

  it("rejects when the nonce echoed in the presentation does not match", async () => {
    const cred = wrap(buildAttestation());
    await manager.storeCredential(cred);
    const request = buildRequest();
    const pres = await manager.buildPresentation(
      request,
      [cred.attestation.uid],
      subjectPriv
    );
    const tampered: Presentation = {
      ...pres,
      nonce: `0x${"ff".repeat(16)}` as `0x${string}`,
    };
    const res = await verifier.verifyPresentation(tampered, request);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toEqual("nonce-mismatch");
  });

  it("rejects an expired presentation request", async () => {
    const cred = wrap(buildAttestation());
    await manager.storeCredential(cred);
    const request = buildRequest({ expiresAt: NOW - 60_000 });
    await expect(
      manager.buildPresentation(request, [cred.attestation.uid], subjectPriv)
    ).rejects.toThrow();
  });

  it("rejects a presentation whose predicate is not satisfied", async () => {
    const cred = wrap(buildAttestation());
    await manager.storeCredential(cred);
    const request = buildRequest({
      requiredClaims: [
        {
          schemaId: SCHEMA_KYC_STATUS,
          predicate: { field: "level", op: "eq", value: "institutional" },
        },
      ],
    });
    const pres = await manager.buildPresentation(
      request,
      [cred.attestation.uid],
      subjectPriv
    );
    const res = await verifier.verifyPresentation(pres, request);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toEqual("predicate-unsatisfied");
  });
});

describe("getPayload", () => {
  it("returns the typed payload for each known schema", () => {
    const kyc = buildAttestation();
    const payload = getPayload(kyc, SCHEMA_KYC_STATUS);
    expect(payload.level).toEqual("enhanced");
    expect(payload.sanctionsChecked).toBe(true);
  });

  it("throws when the schema does not match", () => {
    const kyc = buildAttestation();
    expect(() => getPayload(kyc, SCHEMA_JURISDICTION)).toThrow(/schema/);
  });
});

describe("Issuer registry", () => {
  it("getIssuer returns a known issuer and undefined for an unknown one", () => {
    const known = getIssuer("sumsub-global");
    expect(known?.id).toEqual("sumsub-global");
    expect(getIssuer("nope-not-here")).toBeUndefined();
  });

  it("listIssuersByRole filters correctly", () => {
    const kycProviders = listIssuersByRole("kyc-provider");
    expect(kycProviders.length).toBeGreaterThanOrEqual(2);
    for (const i of kycProviders) expect(i.role).toEqual("kyc-provider");
  });

  it("listIssuersByJurisdiction filters by ISO code", () => {
    const ae = listIssuersByJurisdiction("AE");
    for (const i of ae) expect(i.jurisdiction.toUpperCase()).toEqual("AE");
    const us = listIssuersByJurisdiction("us");
    expect(us.length).toBeGreaterThan(0);
  });

  it("isPlaceholderIssuer flags seed issuers in bootstrap mode", () => {
    for (const i of listAllIssuers()) {
      expect(isPlaceholderIssuer(i)).toBe(true);
    }
  });
});

describe("Selective disclosure & ZK commitment stubs", () => {
  let verifier: CredentialVerifier;
  beforeEach(() => {
    verifier = new CredentialVerifier({
      trustedIssuers: [TRUSTED_ISSUER],
      clockSkewMs: 1_000,
      clock: () => NOW,
    });
  });

  it("returns valid with a warning when a selective-disclosure proof is present", async () => {
    const att = buildAttestation();
    const cred: VerifiableCredential = {
      attestation: att,
      selectiveDisclosureProof: {
        disclosedFields: ["level"],
        concealedFieldHashes: ["0x" + "ab".repeat(32)],
        merkleRoot: `0x${"cd".repeat(32)}` as `0x${string}`,
        merkleSiblings: [`0x${"ef".repeat(32)}` as `0x${string}`],
      },
    };
    const res = await verifier.verifyCredential(cred);
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.includes("selective-disclosure"))).toBe(
      true
    );
  });

  it("returns valid:true with a warning for a ZK commitment stub", async () => {
    const att = buildAttestation();
    const cred: VerifiableCredential = {
      attestation: att,
      zkCommitment: {
        scheme: "poseidon-v1",
        commitment: `0x${"55".repeat(32)}` as `0x${string}`,
        circuitId: "aethel-kyc-eu-accred-v1",
      },
    };
    const res = await verifier.verifyCredential(cred);
    expect(res.valid).toBe(true);
    expect(res.warnings.some((w) => w.includes("zk-commitment"))).toBe(true);
  });
});

describe("Canonical encoding", () => {
  it("sorts object keys deterministically", () => {
    const a = canonicalJson({ b: 2, a: 1 });
    const b = canonicalJson({ a: 1, b: 2 });
    expect(a).toEqual(b);
    expect(a).toEqual('{"a":1,"b":2}');
  });

  it("rejects BigInt inputs", () => {
    expect(() => canonicalJson({ x: 10n })).toThrow(/BigInt/);
  });
});
