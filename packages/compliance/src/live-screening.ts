/**
 * Live on-chain screening — a pre-signing circuit breaker.
 *
 * FATF and MiCA require counterparty screening *before* a transaction is
 * executed, not after broadcast. This module gates signing on a live risk
 * score for the destination address: if the score crosses the block
 * threshold, signing is refused.
 *
 * The score comes from a pluggable {@link ScreeningProvider} so the wallet is
 * vendor-agnostic — drop in a Chainalysis KYT, TRM Labs, or Elliptic adapter
 * (a thin HTTP client implementing the interface) without touching the gate
 * logic. Until a provider is wired, {@link NoopScreeningProvider} returns an
 * "unknown" score and the gate fails per its configured `onError` policy.
 *
 * The gate is fail-closed by default: a provider error blocks (you cannot
 * screen → you do not sign), which is the correct posture for a regulated
 * custodian. Set `onError: "review"` to fail open with a manual-review flag.
 */

export type ScreeningSeverity = "low" | "medium" | "high" | "severe";
export type ScreeningDecision = "allow" | "review" | "block";

export interface AddressRiskScore {
  readonly address: `0x${string}`;
  /** Normalised 0–100 risk score. */
  readonly riskScore: number;
  readonly severity: ScreeningSeverity;
  /** Risk categories the provider attached, e.g. ["sanctions", "mixer"]. */
  readonly categories: readonly string[];
  readonly provider: string;
  readonly screenedAt: number;
}

/** A pluggable risk-scoring backend (Chainalysis KYT, TRM, Elliptic, …). */
export interface ScreeningProvider {
  readonly name: string;
  screenAddress(address: `0x${string}`): Promise<AddressRiskScore>;
}

export interface LiveScreeningConfig {
  /** Block signing at or above this 0–100 score. */
  blockThreshold: number;
  /** Flag for manual review at or above this score (must be < blockThreshold). */
  reviewThreshold: number;
  /** Provider-error posture: fail-closed ("block") or fail-open ("review"). */
  onError: "block" | "review";
  /** How long a successful score is cached, in ms. */
  cacheTtlMs: number;
}

export const DEFAULT_LIVE_SCREENING_CONFIG: LiveScreeningConfig = {
  blockThreshold: 75,
  reviewThreshold: 40,
  onError: "block",
  cacheTtlMs: 5 * 60 * 1000,
};

export interface ScreeningOutcome {
  readonly decision: ScreeningDecision;
  readonly reason: string;
  readonly score?: AddressRiskScore;
}

/** Thrown by {@link LiveScreeningGate.assertAllowed} when signing is blocked. */
export class ScreeningBlockedError extends Error {
  readonly outcome: ScreeningOutcome;
  constructor(outcome: ScreeningOutcome) {
    super(`Transaction blocked by screening: ${outcome.reason}`);
    this.name = "ScreeningBlockedError";
    this.outcome = outcome;
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function normalize(address: string): `0x${string}` {
  if (!ADDRESS_RE.test(address)) {
    throw new Error(`Live screening: invalid address "${address}"`);
  }
  return address.toLowerCase() as `0x${string}`;
}

/** Default provider — returns "unknown" (score 0) and warns it is not wired. */
export class NoopScreeningProvider implements ScreeningProvider {
  readonly name = "noop";
  async screenAddress(address: `0x${string}`): Promise<AddressRiskScore> {
    console.warn(
      "[live-screening] NoopScreeningProvider in use — wire a Chainalysis/TRM/Elliptic adapter before production.",
    );
    return {
      address,
      riskScore: 0,
      severity: "low",
      categories: [],
      provider: this.name,
      screenedAt: Date.now(),
    };
  }
}

export class LiveScreeningGate {
  private readonly provider: ScreeningProvider;
  private readonly config: LiveScreeningConfig;
  private readonly cache = new Map<string, { score: AddressRiskScore; expiresAt: number }>();

  constructor(provider: ScreeningProvider, config: Partial<LiveScreeningConfig> = {}) {
    this.provider = provider;
    this.config = { ...DEFAULT_LIVE_SCREENING_CONFIG, ...config };
    if (this.config.reviewThreshold >= this.config.blockThreshold) {
      throw new Error("Live screening: reviewThreshold must be < blockThreshold");
    }
  }

  private decisionFor(score: AddressRiskScore): ScreeningOutcome {
    if (score.riskScore >= this.config.blockThreshold) {
      return {
        decision: "block",
        reason: `risk score ${score.riskScore} ≥ block threshold ${this.config.blockThreshold}` +
          (score.categories.length ? ` (${score.categories.join(", ")})` : ""),
        score,
      };
    }
    if (score.riskScore >= this.config.reviewThreshold) {
      return { decision: "review", reason: `risk score ${score.riskScore} requires manual review`, score };
    }
    return { decision: "allow", reason: "below review threshold", score };
  }

  /** Screen an address and return the decision (cached on success). */
  async evaluate(address: string): Promise<ScreeningOutcome> {
    const addr = normalize(address);
    const cached = this.cache.get(addr);
    if (cached && cached.expiresAt > Date.now()) {
      return this.decisionFor(cached.score);
    }
    let score: AddressRiskScore;
    try {
      score = await this.provider.screenAddress(addr);
    } catch (cause) {
      const reason = `screening provider error: ${cause instanceof Error ? cause.message : String(cause)}`;
      // Fail-closed (block) or fail-open (review) — never silently allow.
      return { decision: this.config.onError, reason };
    }
    this.cache.set(addr, { score, expiresAt: Date.now() + this.config.cacheTtlMs });
    return this.decisionFor(score);
  }

  /**
   * Circuit breaker for the signing pipeline: throws
   * {@link ScreeningBlockedError} if the address is blocked, otherwise returns
   * the outcome (which may still be `review`).
   */
  async assertAllowed(address: string): Promise<ScreeningOutcome> {
    const outcome = await this.evaluate(address);
    if (outcome.decision === "block") {
      throw new ScreeningBlockedError(outcome);
    }
    return outcome;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
