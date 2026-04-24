/**
 * PII redaction helpers.
 *
 * Each report type picks a `RedactionProfile` that matches regulator
 * expectations:
 *
 *   - `full-disclosure` — raw PII (SAR / CTR). Still replaces any
 *     fields listed in `alwaysRedacted`.
 *   - `subject-only` — keep PII for `privilegedSubject`, hash or
 *     truncate everything else (GDPR DSAR).
 *   - `hashed` — sha256 of every identifiable field + first 8 chars
 *     (GDPR erasure confirmation).
 *   - `pseudonymous` — hash subject commitments, keep amounts
 *     (MiCA transaction reporting).
 *
 * Functions here are pure — callers wire them into formatters that
 * transform payloads in a single pass.
 */

import { sha256 } from "@noble/hashes/sha2.js";

import type { RedactionPolicy } from "./types";

/** `0x`-prefixed 8-character short hash. */
export function hashField(value: string): string {
  const digest = sha256(new TextEncoder().encode(value));
  let hex = "0x";
  for (let i = 0; i < 4 && i < digest.length; i += 1) {
    hex += digest[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/** Truncate an email to `u***@domain.tld`. Returns input unchanged if no `@`. */
export function truncateEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local[0]}${"*".repeat(Math.max(2, local.length - 1))}${domain}`;
}

/** Truncate a 0x address to `0xabcd…ef01`. */
export function truncateAddress(address: `0x${string}` | string): string {
  if (!address.startsWith("0x") || address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Apply a `RedactionPolicy` to a value (by field name + value).
 * `fieldName` is dotted — e.g. `subjects.0.name`, `transactions.17.txHash`.
 * The caller walks the payload tree and invokes this for every leaf.
 */
export function applyRedaction(
  policy: RedactionPolicy,
  fieldName: string,
  value: unknown,
  context: { readonly subjectId?: string } = {},
): unknown {
  if (value === null || value === undefined) return value;

  const fieldLeaf = fieldName.split(".").slice(-1)[0];
  const always = policy.alwaysRedacted?.includes(fieldLeaf);
  if (always) return "[redacted]";

  if (policy.profile === "full-disclosure") return value;

  const isSensitive =
    SENSITIVE_FIELDS.has(fieldLeaf) || SENSITIVE_FIELDS.has(fieldName);

  if (!isSensitive) return value;

  switch (policy.profile) {
    case "subject-only": {
      if (context.subjectId && context.subjectId === policy.privilegedSubject) {
        return value;
      }
      return redactValue(value);
    }
    case "hashed":
    case "pseudonymous":
      return redactValue(value);
    default: {
      const exhaustive: never = policy.profile;
      void exhaustive;
      return redactValue(value);
    }
  }
}

/**
 * Applied to counterparty / non-privileged subject fields. Always
 * returns a typeof-stable shape: strings → redacted string, numbers
 * → truncated to two least-significant digits, everything else →
 * hashed string.
 */
function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.includes("@")) return truncateEmail(value);
    if (value.startsWith("0x")) return truncateAddress(value);
    return hashField(value);
  }
  if (typeof value === "number" || typeof value === "bigint") {
    // Regulators want amount ranges, not exact figures, for
    // counterparties. Return a bucket label instead of the number.
    return bucketizeAmount(typeof value === "bigint" ? value : BigInt(Math.floor(value)));
  }
  return hashField(JSON.stringify(value));
}

const SENSITIVE_FIELDS = new Set<string>([
  "name",
  "email",
  "phone",
  "address",
  "identifierValue",
  "passportNumber",
  "driversLicenseNumber",
  "taxId",
  "ssn",
  "counterpartyAddress",
  "counterparty",
  "sender",
  "receiver",
]);

function bucketizeAmount(n: bigint): string {
  if (n < 100n) return "< $1";
  if (n < 10_000n) return "$1–$100";
  if (n < 100_000n) return "$100–$1,000";
  if (n < 1_000_000n) return "$1,000–$10,000";
  if (n < 10_000_000n) return "$10,000–$100,000";
  if (n < 100_000_000n) return "$100,000–$1M";
  return "> $1M";
}

/**
 * Walk an arbitrary object, applying the redaction policy to every
 * leaf string/number/bigint value. Non-destructive: returns a new
 * object tree. Arrays preserve order; maps preserve keys.
 */
export function redactPayload<T>(
  policy: RedactionPolicy,
  payload: T,
  subjectId?: string,
): T {
  return walk(payload, "", policy, { subjectId }) as T;
}

function walk(
  value: unknown,
  path: string,
  policy: RedactionPolicy,
  ctx: { readonly subjectId?: string },
): unknown {
  if (Array.isArray(value)) {
    return value.map((v, i) => walk(v, `${path}.${i}`, policy, ctx));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const next = path ? `${path}.${k}` : k;
      out[k] = walk(v, next, policy, ctx);
    }
    return out;
  }
  return applyRedaction(policy, path, value, ctx);
}
