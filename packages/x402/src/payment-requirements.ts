/**
 * Parse + validate a 402 response body.
 *
 * The wire shape is JSON per the x402 spec; we validate it into a
 * typed `PaymentRequirementsResponse` and throw a structured
 * `PaymentRequirementError` on malformed input. The validation is
 * intentionally strict — a receiver that sends "99999999" as the
 * amount field (unexpected numeric string with too many digits)
 * should fail fast here, not silently overflow downstream.
 */

import type {
  AttestationRequirement,
  PaymentRequirement,
  PaymentRequirementsResponse,
} from "./types";
import { PaymentRequirementError } from "./errors";
import { asAddress } from "./address";
import { parsePaymentNetwork } from "./chain-config";

const MAX_AMOUNT_DECIMAL_DIGITS = 78; // uint256 max is ~78 decimal digits

/**
 * Parse JSON bytes into a validated `PaymentRequirementsResponse`.
 * Throws `PaymentRequirementError` with a specific code on any
 * structural failure.
 */
export function parsePaymentRequirements(raw: unknown): PaymentRequirementsResponse {
  if (typeof raw !== "object" || raw === null) {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      "402 body is not an object",
    );
  }
  const r = raw as Record<string, unknown>;
  if (r.x402Version !== 1) {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      `Unsupported x402Version: ${String(r.x402Version)}`,
    );
  }
  if (!Array.isArray(r.accepts) || r.accepts.length === 0) {
    throw new PaymentRequirementError(
      "no-acceptable-requirement",
      "402 body has no accepts[] entries",
    );
  }
  const accepts = r.accepts.map((req, i) => parseOneRequirement(req, i));

  return {
    x402Version: 1,
    accepts,
    error: typeof r.error === "string" ? r.error : undefined,
  };
}

function parseOneRequirement(raw: unknown, index: number): PaymentRequirement {
  if (typeof raw !== "object" || raw === null) {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      `accepts[${index}] is not an object`,
    );
  }
  const r = raw as Record<string, unknown>;

  const scheme = r.scheme;
  if (scheme !== "exact" && scheme !== "upto") {
    throw new PaymentRequirementError(
      "unsupported-scheme",
      `accepts[${index}].scheme "${String(scheme)}" is not supported`,
    );
  }
  if (scheme === "upto") {
    // v0.1 doesn't implement `upto` yet. Be explicit about the
    // rejection so consumers can fall through to another accepts entry.
    throw new PaymentRequirementError(
      "unsupported-scheme",
      `accepts[${index}].scheme "upto" is not implemented in this client`,
    );
  }

  const network = parsePaymentNetwork(r.network);
  if (!network) {
    throw new PaymentRequirementError(
      "unsupported-network",
      `accepts[${index}].network "${String(r.network)}" is not registered`,
    );
  }

  const maxAmountRequired = r.maxAmountRequired;
  if (typeof maxAmountRequired !== "string" || maxAmountRequired === "") {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      `accepts[${index}].maxAmountRequired must be a non-empty string`,
    );
  }
  if (!/^\d+$/.test(maxAmountRequired) || maxAmountRequired.length > MAX_AMOUNT_DECIMAL_DIGITS) {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      `accepts[${index}].maxAmountRequired is not a valid uint256 decimal`,
    );
  }

  if (typeof r.resource !== "string" || r.resource === "") {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      `accepts[${index}].resource must be a non-empty string`,
    );
  }
  if (typeof r.description !== "string") {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      `accepts[${index}].description is required (string)`,
    );
  }
  if (typeof r.maxTimeoutSeconds !== "number" || r.maxTimeoutSeconds <= 0) {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      `accepts[${index}].maxTimeoutSeconds must be a positive number`,
    );
  }

  const payTo = asAddress(r.payTo, `accepts[${index}].payTo`);
  const asset = asAddress(r.asset, `accepts[${index}].asset`);

  const attestation = parseAttestationRequirement(r.attestation, index);

  return {
    scheme: "exact",
    network,
    maxAmountRequired,
    resource: r.resource,
    description: r.description,
    mimeType: typeof r.mimeType === "string" ? r.mimeType : undefined,
    payTo,
    maxTimeoutSeconds: r.maxTimeoutSeconds,
    asset,
    extra:
      r.extra && typeof r.extra === "object"
        ? (r.extra as Record<string, unknown>)
        : undefined,
    attestation,
  };
}

function parseAttestationRequirement(
  raw: unknown,
  index: number,
): AttestationRequirement | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      `accepts[${index}].attestation is not an object`,
    );
  }
  const a = raw as Record<string, unknown>;
  if (!Array.isArray(a.allowedPlatforms) || a.allowedPlatforms.length === 0) {
    throw new PaymentRequirementError(
      "invalid-payment-requirement",
      `accepts[${index}].attestation.allowedPlatforms must be a non-empty array`,
    );
  }
  const validPlatforms = new Set([
    "intel-tdx",
    "amd-sev-snp",
    "aws-nitro",
    "gcp-confidential-space",
    "azure-attestation",
  ]);
  for (const p of a.allowedPlatforms) {
    if (typeof p !== "string" || !validPlatforms.has(p)) {
      throw new PaymentRequirementError(
        "invalid-payment-requirement",
        `accepts[${index}].attestation.allowedPlatforms has unknown entry "${String(p)}"`,
      );
    }
  }

  return {
    allowedPlatforms: a.allowedPlatforms as ReadonlyArray<AttestationRequirement["allowedPlatforms"][number]>,
    minSecurityVersion:
      a.minSecurityVersion && typeof a.minSecurityVersion === "object"
        ? (a.minSecurityVersion as Record<string, number>)
        : undefined,
    expectedMeasurements: Array.isArray(a.expectedMeasurements)
      ? (a.expectedMeasurements as AttestationRequirement["expectedMeasurements"])
      : undefined,
    maxAgeSeconds: typeof a.maxAgeSeconds === "number" ? a.maxAgeSeconds : undefined,
    perCallFreshness: a.perCallFreshness === true,
  };
}
