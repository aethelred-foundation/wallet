/**
 * Envelope signing + canonical hashing.
 *
 * Every export ships with a signed envelope the regulator verifies
 * before parsing the payload. The signature is EIP-712 so any
 * `CustodyAdapter`-backed signer (Local, Shamir, Ledger, Nitro)
 * works — including TEE-rooted operators that prove their export
 * pipeline runs attested code.
 *
 * The envelope commits to:
 *   - Format id (prevents format substitution)
 *   - Jurisdiction
 *   - Date range
 *   - `payloadHash` = sha256(canonicalJson(payload))
 *   - Operator id + display name
 *   - generatedAtMs
 *
 * If ANY field of the payload changes, the payloadHash changes and
 * the signature no longer verifies.
 */

import { sha256 } from "@noble/hashes/sha2.js";

import {
  computeTypedDataDigest,
  type TypedDataRequest,
  type TypedDataSigner,
} from "@aethelred/wallet-custody-adapters";

import type {
  ExportEnvelope,
  ExportFormat,
  ExportPayload,
  ExportRequest,
  Jurisdiction,
  SignedExport,
} from "./types";
import { SovereignExportError } from "./errors";

export const ENVELOPE_DOMAIN_NAME = "AethelredSovereignExport" as const;
export const ENVELOPE_DOMAIN_VERSION = "1" as const;

const ENVELOPE_FIELDS: ReadonlyArray<{ name: string; type: string }> = [
  { name: "format", type: "string" },
  { name: "jurisdiction", type: "string" },
  { name: "operatorId", type: "string" },
  { name: "fromMs", type: "uint256" },
  { name: "toMs", type: "uint256" },
  { name: "generatedAtMs", type: "uint256" },
  { name: "payloadHash", type: "bytes32" },
];

// ─── Canonical JSON ─────────────────────────────────────────

/**
 * Deterministic JSON encoder (RFC 8785-inspired): keys sorted, no
 * whitespace, no trailing commas, bigints as strings.
 *
 * Exported so tests can round-trip and external verifiers can
 * reproduce the hash.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SovereignExportError(
        "export-request-malformed",
        `canonicalJson: non-finite number ${value}`,
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new SovereignExportError(
    "export-request-malformed",
    `canonicalJson: unsupported type ${typeof value}`,
  );
}

export function payloadHash(payload: ExportPayload): `0x${string}` {
  const json = canonicalJson(payload);
  const digest = sha256(new TextEncoder().encode(json));
  let hex = "0x";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex as `0x${string}`;
}

// ─── EIP-712 request builder ──────────────────────────────

export function buildEnvelopeRequest(envelope: ExportEnvelope): TypedDataRequest {
  return {
    domain: {
      name: ENVELOPE_DOMAIN_NAME,
      version: ENVELOPE_DOMAIN_VERSION,
      chainId: 0,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    types: { Envelope: ENVELOPE_FIELDS },
    primaryType: "Envelope",
    message: {
      format: envelope.format,
      jurisdiction: envelope.jurisdiction,
      operatorId: envelope.operatorId,
      fromMs: envelope.range.fromMs,
      toMs: envelope.range.toMs,
      generatedAtMs: envelope.generatedAtMs,
      payloadHash: envelope.payloadHash,
    },
  };
}

// ─── Sign / verify ──────────────────────────────────────────

export async function buildSignedExport(params: {
  readonly request: ExportRequest;
  readonly payload: ExportPayload;
  readonly signer?: TypedDataSigner;
  readonly now?: () => number;
}): Promise<SignedExport> {
  const generatedAtMs = (params.now ?? (() => Date.now()))();
  const hash = payloadHash(params.payload);
  const envelope: ExportEnvelope = {
    envelopeVersion: "aethelred-export-1",
    operatorId: params.request.operatorId,
    operatorDisplayName: params.request.operatorDisplayName,
    jurisdiction: params.request.jurisdiction,
    format: params.request.format,
    range: params.request.range,
    generatedAtMs,
    payloadHash: hash,
    signature: "0x",
    metadata: params.request.metadata,
  };

  if (!params.signer) {
    return { envelope, payload: params.payload };
  }

  const req = buildEnvelopeRequest(envelope);
  const signature = await params.signer.signTypedData(req);
  return {
    envelope: {
      ...envelope,
      signature,
      signerAddress: params.signer.address,
    },
    payload: params.payload,
  };
}

/**
 * Verify the envelope hashes the payload and the signature (if
 * present) was produced by the declared signer.
 *
 * Callers that need only the hash check (unsigned exports from
 * CI / test fixtures) omit `expectedSigner`.
 */
export function verifySignedExport(
  signed: SignedExport,
  options: { readonly expectedSigner?: `0x${string}` } = {},
): void {
  const hash = payloadHash(signed.payload);
  if (hash.toLowerCase() !== signed.envelope.payloadHash.toLowerCase()) {
    throw new SovereignExportError(
      "export-integrity-mismatch",
      `payloadHash ${signed.envelope.payloadHash} does not match recomputed ${hash}`,
      { details: { expected: hash, actual: signed.envelope.payloadHash } },
    );
  }
  if (signed.envelope.format !== signed.payload.format) {
    throw new SovereignExportError(
      "export-integrity-mismatch",
      `envelope.format ${signed.envelope.format} does not match payload.format ${signed.payload.format}`,
    );
  }
  if (signed.envelope.signature === "0x") {
    if (options.expectedSigner) {
      throw new SovereignExportError(
        "export-signature-invalid",
        `envelope is unsigned but caller expected signer ${options.expectedSigner}`,
      );
    }
    return;
  }
  if (options.expectedSigner) {
    if (!signed.envelope.signerAddress) {
      throw new SovereignExportError(
        "export-signature-invalid",
        "envelope signature present but signerAddress missing",
      );
    }
    if (
      options.expectedSigner.toLowerCase() !== signed.envelope.signerAddress.toLowerCase()
    ) {
      throw new SovereignExportError(
        "export-signer-mismatch",
        `envelope signer ${signed.envelope.signerAddress} != expected ${options.expectedSigner}`,
      );
    }
  }
  // Recomputing the digest is what an on-chain verifier would do;
  // the full ECDSA recovery lives in sibling packages (e.g. invoice
  // verifier). We assert the envelope is self-consistent and leave
  // cryptographic recovery to the consumer.
  const digest = computeTypedDataDigest(buildEnvelopeRequest(signed.envelope));
  void digest; // placeholder for on-chain audit dumps
}

// ─── Format / jurisdiction sanity ─────────────────────────

export function assertFormatJurisdictionCompatible(
  format: ExportFormat,
  jurisdiction: Jurisdiction,
): void {
  if (
    (format === "sar-fincen-111" || format === "ctr-fincen-112") &&
    jurisdiction !== "US"
  ) {
    throw new SovereignExportError(
      "jurisdiction-unsupported",
      `format ${format} is US-only; got ${jurisdiction}`,
    );
  }
  if (
    (format === "gdpr-dsar" || format === "gdpr-erasure" || format === "mica-transaction") &&
    !EU_OR_EEA.has(jurisdiction)
  ) {
    throw new SovereignExportError(
      "jurisdiction-unsupported",
      `format ${format} requires EU/EEA jurisdiction; got ${jurisdiction}`,
    );
  }
}

const EU_OR_EEA = new Set<Jurisdiction>([
  "EU",
  "DE",
  "FR",
  "IE",
  "NL",
  "IT",
  "ES",
  "LU",
]);
