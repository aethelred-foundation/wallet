/**
 * {@link AttestationVerifier} — structural verifier for TEE attestations.
 *
 * The verifier performs every check that does NOT require a hardware root-of-
 * trust or a vendor SDK:
 *   - Platform allow-list
 *   - Minimum platform security version
 *   - Quote freshness (generated-at vs clock skew and max age)
 *   - Nonce binding (must match the challenge the verifier issued)
 *   - Constant-time code hash match against the approved pin
 *   - Structural validity of every hex field (quote blob, code hash, config
 *     hash, nonce, agent signature)
 *   - Known-risky extra claims surface as warnings
 *   - Sentinel (all-zero / all-one / test) code hashes are rejected outright
 *
 * The ONE thing it does not do is verify the cryptographic signature chain
 * that binds the quote to real silicon. Production deployments plug a
 * platform SDK in at that point — see the TODO markers in
 * {@link AttestationVerifier.verifyQuote}. Keeping this split explicit means
 * the rest of the compliance surface can be unit tested without pulling in
 * native modules, and every deployment environment is forced to make an
 * explicit, auditable decision about which SDK to integrate.
 *
 * @packageDocumentation
 */

import {
  type AttestationVerificationResult,
  type AttestedAgent,
  type TeePlatform,
  AttestationError,
  FORBIDDEN_CODE_HASHES,
  RISKY_EXTRA_CLAIM_KEYS,
  constantTimeHexEqual,
  isHexString,
  normalizeHex,
} from "./tee-attestation";

/**
 * Verifier configuration.
 *
 * All fields are optional so callers can start with safe defaults and
 * tighten the policy as production TEE infrastructure comes online.
 */
export interface AttestationVerifierConfig {
  /**
   * Clock skew tolerance in ms.
   *
   * Allows a quote whose `generatedAt` is slightly in the future (e.g. the
   * TEE's clock is ahead of the verifier's) to still be accepted. Applied
   * symmetrically to the age calculation.
   *
   * @defaultValue `300_000` (5 minutes)
   */
  clockSkewMs?: number;
  /**
   * Maximum allowed quote age in ms.
   *
   * Quotes older than `now - maxQuoteAgeMs - clockSkewMs` are rejected with
   * `quote-expired`. The default matches typical Intel DCAP freshness
   * requirements.
   *
   * @defaultValue `600_000` (10 minutes)
   */
  maxQuoteAgeMs?: number;
  /**
   * Platform allow-list.
   *
   * When set, quotes produced by a platform not in this list are rejected
   * with `platform-unsupported`. Omit to accept any supported platform —
   * only appropriate for local development; production deployments MUST
   * pin this.
   */
  allowedPlatforms?: TeePlatform[];
  /**
   * Minimum platform security version per platform.
   *
   * Keys are {@link TeePlatform} values, values are the minimum acceptable
   * version string. The verifier performs a plain `<` string comparison,
   * which is correct when callers use zero-padded semver-like encodings.
   *
   * @example
   * ```ts
   * minPlatformVersion: { "intel-tdx": "1.5.0", "amd-sev-snp": "3.0.0" }
   * ```
   */
  minPlatformVersion?: Partial<Record<TeePlatform, string>>;
  /**
   * Inject a clock for deterministic tests.
   *
   * Production must never override this — the default returns
   * `Date.now()`.
   */
  now?: () => number;
}

/**
 * Structural + freshness verifier for TEE attestations.
 *
 * Safe to share across requests — the verifier is stateless once
 * constructed. Create one per trust-root configuration (e.g. one per
 * workspace) and reuse it.
 *
 * @example Configure for a production deployment
 * ```ts
 * const verifier = new AttestationVerifier({
 *   clockSkewMs: 60_000,
 *   maxQuoteAgeMs: 300_000,
 *   allowedPlatforms: ["intel-tdx", "amd-sev-snp", "aws-nitro"],
 *   minPlatformVersion: { "intel-tdx": "1.5.0" },
 * });
 * ```
 */
export class AttestationVerifier {
  private readonly clockSkewMs: number;
  private readonly maxQuoteAgeMs: number;
  private readonly allowedPlatforms?: ReadonlySet<TeePlatform>;
  private readonly minPlatformVersion: Partial<Record<TeePlatform, string>>;
  private readonly now: () => number;

  constructor(config: AttestationVerifierConfig = {}) {
    this.clockSkewMs = config.clockSkewMs ?? 300_000;
    this.maxQuoteAgeMs = config.maxQuoteAgeMs ?? 600_000;
    this.allowedPlatforms = config.allowedPlatforms
      ? new Set(config.allowedPlatforms)
      : undefined;
    this.minPlatformVersion = config.minPlatformVersion ?? {};
    this.now = config.now ?? (() => Date.now());
  }

  /**
   * Structural verification.
   *
   * Performs every non-cryptographic check synchronously. Does NOT verify
   * the platform signature chain — the `agentSignature` and the quote
   * signature are checked for hex validity only. This is the entry point
   * for code paths where dropping into native crypto is undesirable
   * (e.g. when summarising an attestation for UI display).
   *
   * @param attested   The attested agent document to verify.
   * @param expectedNonce The nonce the verifier issued at challenge time.
   * @returns A {@link AttestationVerificationResult} — never throws; every
   *          failure path sets `valid: false` with a typed `errorCode`.
   */
  verifyStructure(
    attested: AttestedAgent,
    expectedNonce: `0x${string}`,
  ): AttestationVerificationResult {
    const warnings: string[] = [];
    const verifiedAt = this.now();

    // ─── Hex structural checks ───────────────────────────────────
    const hexCheck = this.checkHexStructure(attested);
    if (hexCheck) {
      return {
        valid: false,
        errorCode: "quote-malformed",
        errorDetail: hexCheck,
        verifiedAt,
        warnings,
      };
    }

    const quote = attested.quote;

    // ─── Platform allow-list ─────────────────────────────────────
    if (
      this.allowedPlatforms !== undefined &&
      !this.allowedPlatforms.has(quote.platform)
    ) {
      return {
        valid: false,
        errorCode: "platform-unsupported",
        errorDetail: `Platform "${quote.platform}" is not in the configured allowlist.`,
        verifiedAt,
        warnings,
      };
    }

    // ─── Platform security version floor ─────────────────────────
    const minVersion = this.minPlatformVersion[quote.platform];
    if (minVersion !== undefined) {
      if (quote.measurements.platformSecurityVersion < minVersion) {
        return {
          valid: false,
          errorCode: "platform-compromised",
          errorDetail: `Platform security version ${quote.measurements.platformSecurityVersion} is below the required minimum ${minVersion}.`,
          verifiedAt,
          warnings,
        };
      }
    }

    // ─── Sentinel (test/uninitialised) code hashes ───────────────
    const candidateCodeHash = normalizeHex(quote.measurements.codeHash);
    for (const forbidden of FORBIDDEN_CODE_HASHES) {
      if (candidateCodeHash === normalizeHex(forbidden)) {
        return {
          valid: false,
          errorCode: "code-hash-mismatch",
          errorDetail: `Measured code hash is a forbidden sentinel value (${forbidden}).`,
          verifiedAt,
          warnings,
        };
      }
    }

    // ─── Nonce binding ───────────────────────────────────────────
    if (!constantTimeHexEqual(quote.nonce, expectedNonce)) {
      return {
        valid: false,
        errorCode: "nonce-mismatch",
        errorDetail: "Quote nonce does not match the issued challenge.",
        verifiedAt,
        warnings,
      };
    }

    // ─── Freshness ───────────────────────────────────────────────
    const ageMs = verifiedAt - quote.generatedAt;
    if (ageMs > this.maxQuoteAgeMs + this.clockSkewMs) {
      return {
        valid: false,
        errorCode: "quote-expired",
        errorDetail: `Quote age ${ageMs}ms exceeds maxQuoteAgeMs=${this.maxQuoteAgeMs}ms (skew tolerance ${this.clockSkewMs}ms).`,
        verifiedAt,
        warnings,
      };
    }
    if (ageMs < -this.clockSkewMs) {
      return {
        valid: false,
        errorCode: "quote-expired",
        errorDetail: `Quote generatedAt is ${-ageMs}ms in the future, beyond the ${this.clockSkewMs}ms skew tolerance.`,
        verifiedAt,
        warnings,
      };
    }

    // ─── Code hash pin ───────────────────────────────────────────
    // The most security-critical comparison: confirms the attested code
    // matches what the operator approved. Always constant-time.
    if (
      !constantTimeHexEqual(
        quote.measurements.codeHash,
        attested.approvedCodeHash,
      )
    ) {
      return {
        valid: false,
        errorCode: "code-hash-mismatch",
        errorDetail:
          "Measured code hash does not match the approved code hash pin.",
        verifiedAt,
        warnings,
      };
    }

    // ─── Extra-claim warnings ────────────────────────────────────
    if (quote.measurements.extraClaims) {
      for (const [key, value] of Object.entries(quote.measurements.extraClaims)) {
        const knownWarning = (RISKY_EXTRA_CLAIM_KEYS as Record<string, string>)[key];
        if (knownWarning !== undefined) {
          // Only surface when the value is truthy — SGX reports 0/1 strings.
          if (value !== "0" && value !== "" && value.toLowerCase() !== "false") {
            warnings.push(`${knownWarning} (extraClaims.${key}=${value}).`);
          }
        }
      }
    }

    // Soft-warn when the generated-at is close to the expiry boundary so
    // operators can replace rotation windows proactively.
    if (ageMs > this.maxQuoteAgeMs / 2) {
      warnings.push(
        `Quote is more than half of its max age (age=${ageMs}ms, max=${this.maxQuoteAgeMs}ms).`,
      );
    }

    return {
      valid: true,
      verifiedAt,
      attestedPlatform: quote.platform,
      warnings,
    };
  }

  /**
   * Full verification, including the cryptographic signature chain.
   *
   * The current implementation performs only the structural checks above.
   * The signature-chain verification is the **only** part that requires a
   * vendor SDK and is therefore explicitly TODO-marked below. The returned
   * result carries a warning so operators know the binding has not yet
   * been validated.
   *
   * TODO(tee-prod): integrate a vendor attestation SDK at production
   * deployment time. Options:
   *   - Intel DCAP (`@intel/dcap` native binding) for TDX / SGX
   *   - AMD SEV-SNP attestation validation library for SEV-SNP
   *   - AWS Nitro Enclaves attestation document verifier for Nitro
   *   - Azure Attestation service / GCP Confidential Space for their CVMs
   *
   * Each SDK takes the raw quote blob and returns a verified claim set.
   * The integration must (a) confirm the quote is signed by the platform
   * endorsement key, (b) chain that key to the platform vendor CA, and
   * (c) confirm the `agentSignature` over the quote with the key embedded
   * in the report. Until that work lands, this method MUST NOT be treated
   * as a security boundary in production.
   *
   * @param attested       The attested agent document to verify.
   * @param expectedNonce  The nonce the verifier issued at challenge time.
   * @returns Promise resolving to the verification result; the promise
   *          never rejects — failures are encoded in the result.
   */
  async verifyQuote(
    attested: AttestedAgent,
    expectedNonce: `0x${string}`,
  ): Promise<AttestationVerificationResult> {
    const structural = this.verifyStructure(attested, expectedNonce);
    if (!structural.valid) return structural;

    // TODO(tee-prod): call the appropriate platform SDK here to verify the
    // quote's signature chain + bind the agent signature to the key embedded
    // in the report. Until then, record the gap as a warning so that tests
    // and audit tooling cannot accidentally treat a structural pass as a
    // full pass.
    const warnings = [
      ...structural.warnings,
      "signature-chain-not-verified: integrate a vendor attestation SDK at production deployment time.",
    ];

    return {
      ...structural,
      warnings,
    };
  }

  /**
   * Assertion wrapper that throws on rejection.
   *
   * Useful for call-sites that would otherwise have to re-throw a typed
   * error after inspecting the result. The thrown {@link AttestationError}
   * carries the same `errorCode` as the result would.
   *
   * @throws {AttestationError} When verification fails.
   * @example
   * ```ts
   * verifier.assertValid(attested, nonce); // throws on rejection
   * ```
   */
  assertValid(
    attested: AttestedAgent,
    expectedNonce: `0x${string}`,
  ): AttestationVerificationResult {
    const result = this.verifyStructure(attested, expectedNonce);
    if (!result.valid) {
      throw new AttestationError(
        result.errorCode ?? "quote-malformed",
        result.errorDetail ?? "Attestation verification failed.",
      );
    }
    return result;
  }

  /**
   * Helper for test harnesses: inspect hex fields and return the first
   * structural problem, or `undefined` when every field is well-formed.
   *
   * Kept private so the hex shape is the only structural invariant any
   * external caller can rely on — changes here should not break
   * downstream contract tests.
   */
  private checkHexStructure(attested: AttestedAgent): string | undefined {
    if (typeof attested.agentId !== "string" || attested.agentId.length === 0) {
      return "agentId must be a non-empty string.";
    }
    if (
      typeof attested.modelIdentifier !== "string" ||
      attested.modelIdentifier.length === 0
    ) {
      return "modelIdentifier must be a non-empty string.";
    }
    if (!isHexString(attested.approvedCodeHash)) {
      return "approvedCodeHash is not a valid 0x-prefixed hex string.";
    }
    if (!isHexString(attested.agentSignature)) {
      return "agentSignature is not a valid 0x-prefixed hex string.";
    }
    const quote = attested.quote;
    if (!quote || typeof quote !== "object") {
      return "quote is missing or malformed.";
    }
    if (typeof quote.version !== "string" || quote.version.length === 0) {
      return "quote.version must be a non-empty string.";
    }
    if (!isHexString(quote.quote)) {
      return "quote.quote is not a valid 0x-prefixed hex string.";
    }
    if (!isHexString(quote.nonce)) {
      return "quote.nonce is not a valid 0x-prefixed hex string.";
    }
    if (!Number.isFinite(quote.generatedAt)) {
      return "quote.generatedAt must be a finite number (Unix ms).";
    }
    const measurements = quote.measurements;
    if (!measurements || typeof measurements !== "object") {
      return "quote.measurements is missing or malformed.";
    }
    if (!isHexString(measurements.codeHash)) {
      return "quote.measurements.codeHash is not a valid 0x-prefixed hex string.";
    }
    if (!isHexString(measurements.configHash)) {
      return "quote.measurements.configHash is not a valid 0x-prefixed hex string.";
    }
    if (
      typeof measurements.platformSecurityVersion !== "string" ||
      measurements.platformSecurityVersion.length === 0
    ) {
      return "quote.measurements.platformSecurityVersion must be a non-empty string.";
    }
    return undefined;
  }
}
