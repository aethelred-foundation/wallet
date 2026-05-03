/**
 * Reference {@link LiabilityAttestor} implementation that fetches a
 * custodian's liability snapshot from a signed JSON HTTP feed.
 *
 * Why this exists:
 *   The {@link LiabilityAttestor} contract is intentionally pluggable —
 *   each tier-1 custodian (Fireblocks, Komainu, BlockDaemon, Hextrust)
 *   has its own oracle / signed API and downstream operators write
 *   bespoke implementations against vendor SDKs. But many vendors
 *   already expose a standard pattern: a public HTTPS endpoint that
 *   returns a JSON snapshot of `{slaStatus, insuranceCoverage,
 *   attestedAt, oracleId, signature}` signed by their key. This
 *   attestor consumes that pattern directly so an operator can wire
 *   real liability data without writing any code beyond passing a URL.
 *
 *   It also doubles as a teaching reference for custom attestors —
 *   the failure-handling, signature verification, and freshness
 *   gating logic here is the same shape every production attestor
 *   needs.
 *
 * Design contract reminders (from the {@link LiabilityAttestor} doc):
 *   - **Never throw** — any failure (network, parse, signature,
 *     freshness) returns `null` so the upstream
 *     {@link captureLiabilitySnapshot} marks the event
 *     `liabilityUnknown: true`. This is what keeps transaction
 *     liveness independent of the oracle.
 *   - Implementations may apply their own internal timeout. This
 *     attestor uses the configured `timeoutMs` (default 5s) via
 *     `AbortController`.
 */

import type {
  CustodianLiabilityAttestation,
  CustodianSlaStatus,
  LiabilityAttestor,
} from "./liability-attestation";

// ─── Public types ──────────────────────────────────────────────────

/**
 * Pluggable signature verifier. Returns `true` iff `signature` is a
 * valid signature over `payload` for the oracle named in `oracleId`.
 *
 * Implementations typically pin a known oracle public key per
 * {@link oracleId} and reject any signature that doesn't recover to
 * it. The attestor calls this AFTER parsing the JSON but BEFORE
 * returning the attestation, so the verification is the gate between
 * "we got bytes" and "we got trustworthy bytes."
 *
 * Returning `false` (or throwing) causes the attestor to return
 * `null`. Throwing is allowed because the attestor wraps the call
 * in try/catch — verifier authors can surface programming errors
 * without breaking the attestor's never-throw contract.
 */
export interface OracleSignatureVerifier {
  verify(input: {
    readonly oracleId: string;
    readonly payload: Uint8Array;
    readonly signature: `0x${string}`;
  }): Promise<boolean> | boolean;
}

/**
 * Always-true verifier. Use when the feed is served over a
 * pre-established trust path (e.g., mTLS to a known endpoint) and
 * the JSON itself doesn't carry a signature. Trades cryptographic
 * verification for transport-layer trust — operators document the
 * rationale in their compliance posture.
 */
export const PASSTHROUGH_VERIFIER: OracleSignatureVerifier = {
  verify: () => true,
};

/**
 * Always-false verifier. Useful in tests to confirm the attestor
 * returns `null` (and thus produces `liabilityUnknown: true` events)
 * when verification fails.
 */
export const REJECT_ALL_VERIFIER: OracleSignatureVerifier = {
  verify: () => false,
};

/**
 * `fetch`-compatible function shape. Lets tests inject a fake fetch
 * without monkey-patching `globalThis.fetch`. Default at construction
 * time is `globalThis.fetch.bind(globalThis)` when available.
 */
export type FetchLike = (
  input: string,
  init?: { readonly signal?: AbortSignal },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}>;

export interface JsonFeedLiabilityAttestorConfig {
  readonly custodianId: string;
  /** Fully-qualified URL of the signed JSON feed. */
  readonly feedUrl: string;
  /** Signature verifier — see {@link OracleSignatureVerifier}. */
  readonly verifier: OracleSignatureVerifier;
  /**
   * Per-fetch timeout in milliseconds. Default 5_000. The attestor
   * aborts the fetch and returns `null` past this deadline.
   */
  readonly timeoutMs?: number;
  /**
   * Maximum age of `attestedAt` before the attestor rejects the
   * snapshot as stale. Default 10 minutes. Set 0 to disable freshness
   * gating (NOT recommended for production).
   */
  readonly maxAgeMs?: number;
  /**
   * Custom fetch implementation. Defaults to global `fetch` when
   * available; tests inject a fake.
   */
  readonly fetch?: FetchLike;
  /**
   * Clock for deterministic tests. Defaults to `Date.now`.
   */
  readonly now?: () => number;
}

// ─── Implementation ──────────────────────────────────────────────

/**
 * Fetches a {@link CustodianLiabilityAttestation} from a signed JSON
 * feed. Wraps the entire pipeline in fail-graceful error handling so
 * the attestor never throws upward — every failure mode lands as a
 * silent `null` return.
 */
export class JsonFeedLiabilityAttestor implements LiabilityAttestor {
  readonly custodianId: string;
  private readonly feedUrl: string;
  private readonly verifier: OracleSignatureVerifier;
  private readonly timeoutMs: number;
  private readonly maxAgeMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(config: JsonFeedLiabilityAttestorConfig) {
    this.custodianId = config.custodianId;
    this.feedUrl = config.feedUrl;
    this.verifier = config.verifier;
    this.timeoutMs = config.timeoutMs ?? 5_000;
    this.maxAgeMs = config.maxAgeMs ?? 10 * 60 * 1_000;
    this.fetchImpl =
      config.fetch ??
      (typeof globalThis.fetch === "function"
        ? (globalThis.fetch.bind(globalThis) as FetchLike)
        : () => Promise.reject(new Error("no global fetch available")));
    this.now = config.now ?? Date.now;
  }

  async fetchAttestation(): Promise<CustodianLiabilityAttestation | null> {
    let body: string;
    try {
      body = await this.fetchWithTimeout();
    } catch {
      return null;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      return null;
    }

    const parsed = parseAttestationJson(raw);
    if (parsed === null) return null;

    // Freshness gate: reject snapshots that are too old. Stale data
    // is worse than no data — it gives the auditor a misleading
    // record of the custodian's recent state.
    if (this.maxAgeMs > 0) {
      const age = this.now() - parsed.attestedAt;
      if (age > this.maxAgeMs || age < 0) return null;
    }

    // Signature verification. The payload signed is the canonical-
    // JSON bytes of the attestation EXCLUDING the signature itself —
    // standard pattern. Verifier wrapped in try/catch so a buggy
    // implementation can't break our never-throw contract.
    if (parsed.signature !== undefined) {
      try {
        const payloadBytes = canonicalAttestationBytes(parsed);
        const ok = await this.verifier.verify({
          oracleId: parsed.oracleId,
          payload: payloadBytes,
          signature: parsed.signature,
        });
        if (!ok) return null;
      } catch {
        return null;
      }
    }

    return parsed;
  }

  /**
   * Wrap `fetchImpl` with an `AbortController` that cancels at
   * `timeoutMs`. Throws (caught by caller) on network error, non-2xx
   * status, or timeout.
   */
  private async fetchWithTimeout(): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.feedUrl, {
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`feed responded ${res.status}`);
      }
      return await res.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ─── JSON parsing + canonicalization ──────────────────────────────

/**
 * Parse a feed-response JSON object into a
 * {@link CustodianLiabilityAttestation}, or `null` if the shape is
 * invalid.
 *
 * Required fields: `custodianId`, `slaStatus`, `insuranceCoverage`,
 * `insuranceCurrency`, `attestedAt`, `oracleId`. Optional:
 * `signature`. Unknown extra fields are tolerated (forward-compat).
 *
 * `insuranceCoverage` is accepted as either a number, a numeric
 * string, or a "<digits>n" bigint-string (matching the canonical
 * format used elsewhere in this module). Stored as bigint internally.
 */
function parseAttestationJson(
  raw: unknown,
): CustodianLiabilityAttestation | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.custodianId !== "string") return null;
  if (typeof r.insuranceCurrency !== "string") return null;
  if (typeof r.attestedAt !== "number" || !Number.isFinite(r.attestedAt)) {
    return null;
  }
  if (typeof r.oracleId !== "string") return null;

  const slaStatus = parseSlaStatus(r.slaStatus);
  if (slaStatus === null) return null;

  const coverage = parseCoverageBigint(r.insuranceCoverage);
  if (coverage === null) return null;

  let signature: `0x${string}` | undefined;
  if (typeof r.signature === "string") {
    if (!/^0x[0-9a-fA-F]+$/.test(r.signature)) return null;
    signature = r.signature as `0x${string}`;
  } else if (r.signature !== undefined && r.signature !== null) {
    return null;
  }

  return {
    custodianId: r.custodianId,
    slaStatus,
    insuranceCoverage: coverage,
    insuranceCurrency: r.insuranceCurrency,
    attestedAt: r.attestedAt,
    oracleId: r.oracleId,
    ...(signature !== undefined ? { signature } : {}),
  };
}

function parseSlaStatus(value: unknown): CustodianSlaStatus | null {
  if (value === "operational" || value === "degraded" || value === "unavailable") {
    return value;
  }
  return null;
}

function parseCoverageBigint(value: unknown): bigint | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value === "string") {
    const trimmed = value.endsWith("n") ? value.slice(0, -1) : value;
    if (!/^[0-9]+$/.test(trimmed)) return null;
    return BigInt(trimmed);
  }
  if (typeof value === "bigint") {
    return value >= 0n ? value : null;
  }
  return null;
}

/**
 * Canonical bytes of the attestation EXCLUDING the signature field —
 * the input the oracle signs. Stable-key JSON with bigint coercion
 * matching the rest of the module.
 */
function canonicalAttestationBytes(
  attestation: CustodianLiabilityAttestation,
): Uint8Array {
  const { signature: _signature, ...rest } = attestation;
  void _signature;
  return new TextEncoder().encode(stableStringify(rest));
}

function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "bigint") return JSON.stringify(`${value}n`);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}
