/**
 * TEE (Trusted Execution Environment) attestation primitives.
 *
 * These types model the evidence surface an autonomous agent must present to
 * prove that it is running approved code inside an approved hardware-backed
 * execution environment. They are the data-plane contracts consumed by
 * {@link ../attestation-verifier.AttestationVerifier} and
 * {@link ../agent-delegation.AgentDelegationManager}.
 *
 * The module is deliberately transport- and SDK-agnostic: it describes the
 * shape of a quote and the claims an operator must inspect, but leaves the
 * cryptographic verification to platform-specific SDKs (Intel DCAP,
 * AMD SEV-SNP attestation, AWS Nitro Enclaves attestation document verifier,
 * GCP Confidential Space, Azure Attestation, etc.) that production deployments
 * pin to their hardware root-of-trust.
 *
 * Design goals:
 *   - Provide a stable type surface that survives platform SDK churn.
 *   - Capture every field an auditor will look at in a post-incident review.
 *   - Make it impossible to accept a quote without explicitly opting into a
 *     platform, a minimum security version, and an expected code measurement.
 *   - Expose an explicit {@link TeeQuoteError} taxonomy so verifiers never
 *     have to surface untyped `Error` messages to compliance tooling.
 *
 * @packageDocumentation
 */

/**
 * TEE platform vendors supported by the attestation verifier surface.
 *
 * `software-simulated` is intentionally included so that integration tests and
 * reference environments can exercise the full pipeline without real silicon.
 * Production deployments MUST reject `software-simulated` via the verifier's
 * `allowedPlatforms` option; it exists only for local development.
 *
 * @example
 * ```ts
 * const allowed: TeePlatform[] = ["intel-tdx", "amd-sev-snp", "aws-nitro"];
 * ```
 */
export type TeePlatform =
  | "intel-tdx"
  | "intel-sgx"
  | "amd-sev-snp"
  | "aws-nitro"
  | "azure-cvm"
  | "gcp-cvm"
  | "software-simulated";

/**
 * Platform-specific measurement values embedded inside a {@link TeeQuote}.
 *
 * Different silicon uses different names for the same concepts:
 *   - `codeHash` corresponds to Intel MRENCLAVE (SGX) / MRTD (TDX) /
 *     AMD LaunchDigest / AWS Nitro PCR0.
 *   - `configHash` corresponds to Intel SGX `MRSIGNER` + config ID combined
 *     measurement, AMD SEV-SNP Report's `FAMILY_ID`/`IMAGE_ID` pair, or
 *     AWS Nitro PCR2 (instance configuration).
 *   - `platformSecurityVersion` captures the attestable platform version,
 *     e.g. SGX SVN, TDX TEE_TCB_SVN, AMD SEV-SNP `CURRENT_TCB`, Nitro document
 *     version.
 *
 * Additional claims a platform may expose are passed through
 * `extraClaims` untouched so auditors can inspect them without needing the
 * verifier to be re-released whenever a new field is standardised.
 *
 * @example
 * ```ts
 * const measurements: TeeMeasurements = {
 *   codeHash: "0x" + "ab".repeat(32),
 *   configHash: "0x" + "cd".repeat(32),
 *   platformSecurityVersion: "0.5.1",
 *   extraClaims: { cpuSvn: "0x0a0b0c" },
 * };
 * ```
 */
export interface TeeMeasurements {
  /**
   * Hash of the enclave code image
   * (Intel MRENCLAVE / MRTD, AMD LaunchDigest, Nitro PCR0).
   */
  codeHash: `0x${string}`;
  /**
   * Hash of the enclave configuration / launch parameters
   * (MRSIGNER composite, SEV-SNP family+image id, Nitro PCR2).
   */
  configHash: `0x${string}`;
  /**
   * Attestable platform / TCB security version.
   *
   * Interpretation is platform-specific — verifiers compare against
   * `minPlatformVersion[platform]` using an ordered string comparison, so
   * operators SHOULD use a zero-padded semver-like representation for new
   * deployments.
   */
  platformSecurityVersion: string;
  /**
   * Free-form additional claims (debug flags, CPU SVN, boot loader hash,
   * launch-time policy id, etc.). Surfaces as warnings in the verifier when
   * known-risky flags are present.
   */
  extraClaims?: Record<string, string>;
}

/**
 * Raw attestation quote plus the metadata a verifier needs to reason about
 * its freshness and provenance.
 *
 * The `quote` field carries the opaque platform-specific binary blob as a
 * hex string. Production deployments pass this blob to a platform SDK which
 * validates the silicon signature chain (endorsement key -> platform CA ->
 * root CA). The type surface here deliberately does not constrain the blob's
 * inner format because every vendor ships their own ASN.1 / CBOR encoding.
 *
 * @example
 * ```ts
 * const quote: TeeQuote = {
 *   platform: "intel-tdx",
 *   version: "4.0",
 *   quote: "0x0102...",
 *   measurements: { ... },
 *   generatedAt: Date.now(),
 *   nonce: "0x" + "00".repeat(32),
 * };
 * ```
 */
export interface TeeQuote {
  /** TEE platform that produced the quote. */
  platform: TeePlatform;
  /**
   * Format version for the attestation quote structure
   * (e.g. Intel DCAP quote version, Nitro attestation document version).
   */
  version: string;
  /** Hex-encoded attestation blob (platform-specific binary). */
  quote: `0x${string}`;
  /** Measurement values the quote attests to. */
  measurements: TeeMeasurements;
  /** Unix ms when the quote was generated by the TEE. */
  generatedAt: number;
  /**
   * Nonce the verifier challenged with. The TEE MUST bind this into the
   * quote (typically the user-data field). The verifier compares this to the
   * nonce it generated at session open to defeat replay.
   */
  nonce: `0x${string}`;
}

/**
 * Agent identity together with its attestation bundle.
 *
 * This is the document a delegating principal (the `subjectId`) inspects
 * before opening a delegation session. The verifier uses the triple
 * `(approvedCodeHash, quote.measurements.codeHash, agentSignature)` to prove
 * that the delegated key is controlled by the exact code that was vetted.
 *
 * `modelIdentifier` carries the name/version string of the customer's
 * autonomous agent model — an opaque data string captured for audit. The
 * field exists so incident responders can filter sessions by agent model
 * when a drift is suspected; verification logic does NOT branch on its
 * value.
 *
 * @example
 * ```ts
 * const attested: AttestedAgent = {
 *   agentId: "mid-01",
 *   modelIdentifier: "example-agent-1.0",
 *   approvedCodeHash: "0x" + "ab".repeat(32),
 *   quote,
 *   agentSignature: "0x" + "ff".repeat(64),
 * };
 * ```
 */
export interface AttestedAgent {
  /** Unique agent id — matches {@link ./types.MachineIdentity}.`id`. */
  agentId: string;
  /**
   * Opaque model name/version the agent is running.
   *
   * This is free-form customer data (e.g. a vendor model tag) that the
   * verifier records but does not interpret. Treat the string as
   * untrusted — never use it to branch security decisions.
   */
  modelIdentifier: string;
  /** Pinned code hash the agent MUST be running. */
  approvedCodeHash: `0x${string}`;
  /** Quote presented by the agent. */
  quote: TeeQuote;
  /** Signature of the quote by the agent's delegation key. */
  agentSignature: `0x${string}`;
}

/**
 * Revocation reason codes.
 *
 * Used for both the revocation record stored in {@link RevocationRecord} and
 * in the verifier error taxonomy. Adding a new reason is a MAJOR surface
 * change — downstream audit dashboards pivot on these values.
 */
export type RevocationReason =
  | "operator-initiated"
  | "model-drift-detected"
  | "measurement-mismatch"
  | "quote-expired"
  | "platform-compromised"
  | "policy-violation";

/**
 * Immutable record documenting why a delegation session was revoked.
 *
 * The `actor` field is either a human/organisation `subjectId` that pressed
 * the revoke button, or the literal string `"system"` for auto-revoke flows
 * (e.g. drift detection). Capturing this distinction explicitly is required
 * for post-incident review.
 *
 * @example
 * ```ts
 * const record: RevocationRecord = {
 *   agentId: "mid-01",
 *   reason: "model-drift-detected",
 *   at: Date.now(),
 *   actor: "system",
 *   detail: "codeHash changed mid-session",
 * };
 * ```
 */
export interface RevocationRecord {
  /** Agent whose delegation was revoked. */
  agentId: string;
  /** Revocation reason code. */
  reason: RevocationReason;
  /** Unix ms when the revocation was applied. */
  at: number;
  /**
   * Principal that initiated the revocation.
   *
   * Either a subject id (human-initiated) or the literal `"system"` for
   * automated revocations.
   */
  actor: string;
  /** Free-form detail captured at revocation time. */
  detail?: string;
}

/**
 * Structured result of attestation verification.
 *
 * The type is designed so callers can persist the result verbatim in an
 * audit trail: every field is either a primitive or a string literal, and
 * the `warnings` list is guaranteed to be non-nullable (empty array when
 * clean) to simplify downstream serialisation.
 *
 * @example
 * ```ts
 * if (!result.valid) {
 *   logger.warn("attestation rejected", { code: result.errorCode, detail: result.errorDetail });
 * } else {
 *   logger.info("attestation accepted", { platform: result.attestedPlatform, warnings: result.warnings });
 * }
 * ```
 */
export interface AttestationVerificationResult {
  /** `true` iff every structural + cryptographic check passed. */
  valid: boolean;
  /** Machine-readable error code when `valid === false`. */
  errorCode?:
    | "quote-malformed"
    | "nonce-mismatch"
    | "code-hash-mismatch"
    | "platform-unsupported"
    | "signature-invalid"
    | "quote-expired"
    | "platform-compromised";
  /** Human-readable detail explaining the error code. */
  errorDetail?: string;
  /** Unix ms when verification was performed. */
  verifiedAt: number;
  /** Platform that vouched for the attestation, when valid. */
  attestedPlatform?: TeePlatform;
  /**
   * Warnings that do not fail verification but auditors MUST review.
   *
   * Examples: debug flags present in extra claims, platform security version
   * close to the configured minimum, stale generated-at clock skew within
   * tolerance, etc.
   */
  warnings: string[];
}

/**
 * Typed error thrown when a quote is malformed at the transport/parsing
 * layer (e.g. a hex field is not valid hex, a required measurement is
 * missing). Distinct from {@link AttestationError}, which represents a
 * verification policy failure rather than a structural parse failure.
 *
 * @example
 * ```ts
 * throw new TeeQuoteError("codeHash must be 0x-prefixed hex");
 * ```
 */
export class TeeQuoteError extends Error {
  /** Stable, machine-readable class name for serialisation. */
  readonly name = "TeeQuoteError" as const;
  constructor(message: string) {
    super(message);
    // Restore the prototype chain for reliable `instanceof` across realms.
    Object.setPrototypeOf(this, TeeQuoteError.prototype);
  }
}

/**
 * Typed error surfaced by the verifier when an attestation is rejected for
 * a policy reason (nonce mismatch, code hash mismatch, platform not
 * allowed, platform compromised, etc.).
 *
 * Carries the same {@link AttestationVerificationResult.errorCode} value
 * that the verifier returns so that consumers can convert thrown errors
 * into structured results without string-matching the message.
 *
 * @example
 * ```ts
 * try {
 *   verifier.assertValid(attested, expectedNonce);
 * } catch (error) {
 *   if (error instanceof AttestationError) {
 *     metrics.increment("tee.rejected", { code: error.code });
 *   }
 *   throw error;
 * }
 * ```
 */
export class AttestationError extends Error {
  /** Stable, machine-readable class name for serialisation. */
  readonly name = "AttestationError" as const;
  /**
   * Error code matching the verifier result taxonomy.
   *
   * @see AttestationVerificationResult.errorCode
   */
  readonly code: NonNullable<AttestationVerificationResult["errorCode"]>;
  constructor(
    code: NonNullable<AttestationVerificationResult["errorCode"]>,
    message: string,
  ) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, AttestationError.prototype);
  }
}

/**
 * Typed error thrown by {@link ../agent-delegation.AgentDelegationManager}
 * when a delegation operation fails (session not found, expired, call not
 * allow-listed, spend cap exceeded, drift detected, etc.).
 *
 * @example
 * ```ts
 * throw new DelegationError("session-expired", "session opened 10m ago, max age 600s");
 * ```
 */
export class DelegationError extends Error {
  /** Stable, machine-readable class name for serialisation. */
  readonly name = "DelegationError" as const;
  /** Error code (stable strings — see the delegation manager). */
  readonly code:
    | "session-not-found"
    | "session-expired"
    | "session-revoked"
    | "call-not-allowed"
    | "spend-cap-exceeded"
    | "attestation-required"
    | "attestation-stale"
    | "measurement-drift"
    | "attestation-invalid";
  constructor(
    code: DelegationError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
    Object.setPrototypeOf(this, DelegationError.prototype);
  }
}

/**
 * Cheap structural guard for the `0x${string}` branded hex type.
 *
 * Accepts any string of the form `0x` followed by an even number of hex
 * digits. Does NOT enforce length (the expected size is platform-specific);
 * length is checked at the call site where it matters.
 *
 * Exported so the verifier and the delegation manager can share the same
 * predicate without duplicating the regex.
 *
 * @example
 * ```ts
 * if (!isHexString(measurements.codeHash)) throw new TeeQuoteError("codeHash malformed");
 * ```
 */
export function isHexString(value: unknown): value is `0x${string}` {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length % 2 === 0 &&
    /^0x[0-9a-fA-F]*$/.test(value)
  );
}

/**
 * Normalise a `0x`-prefixed hex string to lower-case for stable comparison.
 *
 * The return type is `Lowercase<string>` — callers should treat the result
 * as a key only, not as a display value.
 *
 * @example
 * ```ts
 * normalizeHex("0xAbCd") // "0xabcd"
 * ```
 */
export function normalizeHex(value: `0x${string}`): `0x${Lowercase<string>}` {
  return value.toLowerCase() as `0x${Lowercase<string>}`;
}

/**
 * Constant-time equality check for two `0x`-prefixed hex strings.
 *
 * Always inspects every byte of the longer input, regardless of where the
 * first mismatch occurs, so timing side channels cannot be used to learn
 * the expected hash. Returns `false` immediately when lengths differ
 * because length disclosure of a SHA-256 hash is not sensitive (all hashes
 * are 32 bytes).
 *
 * This is the primitive used to compare `AttestedAgent.approvedCodeHash`
 * against `quote.measurements.codeHash` — the single most security-critical
 * comparison in the delegation surface.
 *
 * @example
 * ```ts
 * if (!constantTimeHexEqual(a, b)) throw new AttestationError("code-hash-mismatch", "drift");
 * ```
 */
export function constantTimeHexEqual(
  a: `0x${string}`,
  b: `0x${string}`,
): boolean {
  if (a.length !== b.length) return false;
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  let accumulator = 0;
  for (let i = 0; i < left.length; i += 1) {
    accumulator |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return accumulator === 0;
}

/**
 * Known-risky claim keys that the verifier surfaces as warnings.
 *
 * Each entry documents the platform-specific semantics so operators reading
 * the audit log can answer "why was this warning raised" without consulting
 * every vendor's documentation. Extend with care — compliance dashboards
 * pivot on these keys.
 */
export const RISKY_EXTRA_CLAIM_KEYS = Object.freeze({
  /** Intel SGX: enclave debug flag set at build time. */
  debug: "Enclave built with SGX_DEBUG attribute",
  /** AMD SEV-SNP: platform launched with debug flag. */
  "sev-snp-debug": "SEV-SNP platform reports DEBUG policy flag",
  /** AWS Nitro: document signed by the testing root, not production. */
  "nitro-test-root": "Nitro quote signed by a testing root certificate",
  /** Intel TDX: launched in the reduced-security debug configuration. */
  "tdx-debug": "TDX report produced in DEBUG mode",
} as const);

/**
 * Sentinel code hashes that must never appear in production.
 *
 * All-zeros indicates an uninitialised measurement, and the explicit
 * `0xdeadbeef...` pattern is commonly used by test harnesses. The verifier
 * rejects these outright with a `code-hash-mismatch` result even if
 * `approvedCodeHash` is (accidentally) set to the same value, because that
 * itself is a sign of misconfiguration.
 */
export const FORBIDDEN_CODE_HASHES: ReadonlyArray<`0x${string}`> = Object.freeze([
  `0x${"00".repeat(32)}` as `0x${string}`,
  `0x${"ff".repeat(32)}` as `0x${string}`,
  `0xdeadbeef${"00".repeat(28)}` as `0x${string}`,
]);
