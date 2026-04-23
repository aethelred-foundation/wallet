/**
 * `@aethelred/wallet-reputation` — type surface.
 *
 * Three concerns, three type families:
 *
 *   1. **Agent identity (ERC-8004)** — `AgentIdentity`, `ERC8004Resolver`.
 *      Resolve an agent's on-chain address to its registered identity and
 *      any attached attestations. Modelled after the draft ERC-8004
 *      agent-registry standard; the resolver is pluggable so callers can
 *      point at a real on-chain contract, a local cache, or an in-memory
 *      fixture for tests.
 *
 *   2. **Reputation signals + score** — `ReputationSignal`,
 *      `ReputationScore`. Aggregation is deterministic: given the same
 *      inputs, every verifier computes the same score. The score is
 *      deliberately a plain number (0..1000) plus a tier band so gate
 *      rules can write `requireMinReputation(600)` or
 *      `requireMinTier("trusted")` depending on their preferred
 *      ergonomics.
 *
 *   3. **VC gate rules** — `VcGateRule`, `VcGateEvaluation`. A receiver
 *      declares the constraints an incoming agent MUST satisfy (valid
 *      KYC VC from an approved issuer, minimum reputation tier, no
 *      sanctions hits, etc.). The gate evaluator runs each rule against
 *      a `VcGateContext` and emits a structured evaluation record that
 *      serialises cleanly to audit storage.
 *
 * We keep the contracts minimal and pluggable on purpose: the
 * `credentials` package already owns attestation parsing and signature
 * verification; this package only composes those primitives into
 * payment-gating decisions.
 *
 * @packageDocumentation
 */

import type {
  Attestation,
  Issuer,
  IssuerRole,
  SchemaId,
  VerifiableCredential,
} from "@aethelred/wallet-credentials";

// ─── Agent identity (ERC-8004) ──────────────────────────────────

/**
 * Agent identity as modelled by the ERC-8004 draft registry.
 *
 * ERC-8004 registers agents as first-class on-chain entities with:
 *   - A canonical agent id (32-byte selector).
 *   - A control address that holds the agent's funds.
 *   - An owner/operator address allowed to rotate policy.
 *   - A `policyRoot` (32 bytes) committing to the policy bundle the
 *     agent operates under — delegation limits, spend caps, allow-
 *     lists.
 *   - A `reputationRoot` (32 bytes) committing to the reputation
 *     signals the agent has accumulated.
 *
 * The fields mirror the draft spec verbatim — if it drifts before
 * finalisation, this type is the one place we update.
 */
export interface AgentIdentity {
  /**
   * Canonical agent id. Deterministic `keccak256(controlAddress || salt)`
   * so the same agent always hashes to the same id across re-registrations.
   */
  readonly agentId: `0x${string}`;
  /** Control address: where the agent's wallet + signing key live. */
  readonly controlAddress: `0x${string}`;
  /** Owner/operator address allowed to rotate the agent's policy root. */
  readonly operatorAddress: `0x${string}`;
  /** Keccak commitment to the policy bundle the agent runs under. */
  readonly policyRoot: `0x${string}`;
  /** Keccak commitment to the reputation signals ledger. */
  readonly reputationRoot: `0x${string}`;
  /** Unix ms when the agent was registered on-chain. */
  readonly registeredAt: number;
  /** Whether the operator has revoked this identity. */
  readonly revoked: boolean;
  /** Optional operator-set revocation reason (for audit). */
  readonly revocationReason?: string;
  /**
   * Optional human-readable metadata URI (IPFS / HTTPS). Off-chain
   * callers MAY resolve this; on-chain gating logic MUST NOT depend
   * on its contents (untrusted data).
   */
  readonly metadataUri?: string;
}

/**
 * Resolver for ERC-8004 agent identities.
 *
 * Two concrete implementations ship:
 *
 *   - `InMemoryERC8004Resolver` for tests + dev.
 *   - `CachingERC8004Resolver` — wraps any resolver with an LRU + TTL.
 *
 * Production callers plug a viem/ethers-backed resolver that calls the
 * real on-chain contract. The interface stays chain-agnostic so the
 * same reputation engine drives Base, Ethereum, Arbitrum, Polygon,
 * etc. without branching.
 */
export interface ERC8004Resolver {
  /**
   * Resolve an agent by its control address (the `from` field of an
   * x402 payment authorisation). Returns `null` if the address is not
   * registered as an agent — gate rules typically fail-closed on
   * `null` via `requireRegisteredAgent()`.
   */
  resolveByControlAddress(controlAddress: `0x${string}`): Promise<AgentIdentity | null>;

  /**
   * Resolve by canonical agent id — useful when the caller already
   * knows the id (e.g. it came back in a previous lookup and was
   * cached).
   */
  resolveByAgentId(agentId: `0x${string}`): Promise<AgentIdentity | null>;

  /**
   * List attestation UIDs the on-chain registry has recorded for this
   * agent. The resolver is responsible for deduping; the reputation
   * aggregator hydrates each UID against the `credentials` store.
   */
  listAttestationUids(agentId: `0x${string}`): Promise<ReadonlyArray<`0x${string}`>>;

  /**
   * Whether the agent is known-good. An agent whose `revoked` flag is
   * `true` MUST be rejected by every gate — this convenience helper
   * lets callers short-circuit the full resolution path.
   */
  isRevoked(agentId: `0x${string}`): Promise<boolean>;
}

// ─── Reputation signals + score ─────────────────────────────────

/**
 * A single input that contributes to an agent's reputation score.
 *
 * Every signal carries enough metadata that the aggregator's
 * transparency report can explain the resulting score line-by-line:
 * "+100 for KYC VC from Sumsub (role=kyc-provider)", "-200 for fraud
 * report from OFAC-screen on 2025-12-04", etc.
 */
export type ReputationSignal =
  | {
      readonly kind: "vc-attestation";
      /** Schema of the backing VC. */
      readonly schemaId: SchemaId;
      /** Role the issuer holds (kyc-provider, vasp-registrar, ...). */
      readonly issuerRole: IssuerRole;
      /** Issuer id (audit-only; does NOT change the weight). */
      readonly issuerId: string;
      /** Weight contribution; can be positive or negative. */
      readonly weight: number;
      /** VC expiry millis; `undefined` means non-expiring. */
      readonly expiresAt?: number;
    }
  | {
      readonly kind: "payment-success";
      /** Number of successful x402 payments observed. */
      readonly count: number;
      /** Average weight contribution per payment (capped externally). */
      readonly weight: number;
    }
  | {
      readonly kind: "fraud-report";
      /** Source id of the report. */
      readonly sourceId: string;
      /** Negative weight (aggregator caps). */
      readonly weight: number;
      /** Unix ms of the report. */
      readonly reportedAt: number;
    }
  | {
      readonly kind: "revocation";
      /** Attestation UID that was revoked. */
      readonly attestationUid: `0x${string}`;
      readonly weight: number;
      readonly revokedAt: number;
    }
  | {
      readonly kind: "tee-attestation-drift";
      /** Code hash the agent's TEE last presented. */
      readonly codeHash: `0x${string}`;
      readonly weight: number;
      readonly observedAt: number;
    };

/** Bands that group raw scores into ergonomic tier buckets for UX. */
export type ReputationTier = "unknown" | "basic" | "trusted" | "verified" | "elite";

/**
 * Structured aggregation output.
 *
 * `transparency` is an ordered list of every signal that contributed
 * to `score` plus its weight. Auditors and end-users can read this
 * record and reconstruct the computation deterministically.
 */
export interface ReputationScore {
  /** Bounded integer score in `[0, 1000]`. */
  readonly score: number;
  /** Convenience tier label derived from `score`. */
  readonly tier: ReputationTier;
  /** Signals that contributed, in the order they were applied. */
  readonly transparency: ReadonlyArray<{
    readonly signal: ReputationSignal;
    readonly appliedWeight: number;
    readonly cumulativeScore: number;
  }>;
  /** Unix ms the score was computed. */
  readonly computedAt: number;
  /** Agent id the score was computed for. */
  readonly agentId: `0x${string}`;
}

/**
 * Tunable weights for the aggregator. Operators who prefer different
 * product economics (e.g. enterprise KYC-only vs. growth-friendly
 * payment-history-weighted) override these at construction time.
 *
 * Defaults encode the conservative posture: KYC and VASP licences
 * carry the most weight, payment history carries modest weight,
 * fraud reports carry a heavy negative.
 */
export interface ReputationWeights {
  /** Starting score before any signals apply. Default: 500. */
  readonly baseline: number;
  /** Weight for a valid KYC VC. Default: +120. */
  readonly kycVc: number;
  /** Weight for a valid AML / sanctions-clear VC. Default: +80. */
  readonly amlVc: number;
  /** Weight for an accredited-investor VC. Default: +60. */
  readonly accreditedInvestorVc: number;
  /** Weight for a VASP licence VC. Default: +200. */
  readonly vaspLicenseVc: number;
  /** Weight per successful payment, capped at `successPaymentCap`. */
  readonly successPaymentPer: number;
  /** Max sum of successful-payment contributions. Default: +100. */
  readonly successPaymentCap: number;
  /** Weight for each fraud report. Default: -300. */
  readonly fraudReport: number;
  /** Weight for each attestation revocation. Default: -150. */
  readonly revocation: number;
  /** Weight for a TEE code-hash drift event. Default: -250. */
  readonly teeDrift: number;
  /** Score floor. Default: 0. */
  readonly floor: number;
  /** Score ceiling. Default: 1000. */
  readonly ceiling: number;
}

export const DEFAULT_REPUTATION_WEIGHTS: ReputationWeights = Object.freeze({
  baseline: 500,
  kycVc: 120,
  amlVc: 80,
  accreditedInvestorVc: 60,
  vaspLicenseVc: 200,
  successPaymentPer: 2,
  successPaymentCap: 100,
  fraudReport: -300,
  revocation: -150,
  teeDrift: -250,
  floor: 0,
  ceiling: 1000,
});

/**
 * Ergonomic tier bands over the raw score. Tuned so the default
 * baseline (500) lands in `basic` — agents with nothing but a default
 * registration don't accidentally qualify for `trusted`.
 *
 * Operators who want different banding override `tierForScore` at
 * aggregator construction.
 */
export const DEFAULT_TIER_BANDS: ReadonlyArray<{
  readonly min: number;
  readonly tier: ReputationTier;
}> = Object.freeze([
  { min: 900, tier: "elite" },
  { min: 750, tier: "verified" },
  { min: 600, tier: "trusted" },
  { min: 300, tier: "basic" },
  { min: 0, tier: "unknown" },
]);

// ─── VC gate rules ──────────────────────────────────────────────

/**
 * Context a gate rule runs against.
 *
 * Populated by `VcGate.evaluate` from the resolver, the credentials
 * store, and the reputation aggregator. Each rule inspects whichever
 * fields it needs; rules do NOT perform I/O themselves (keeps them
 * pure, composable, and easy to test).
 */
export interface VcGateContext {
  readonly agent: AgentIdentity;
  readonly credentials: ReadonlyArray<VerifiableCredential>;
  readonly trustedIssuers: ReadonlyArray<Issuer>;
  readonly reputation: ReputationScore;
  /** Unix ms at which the gate is running — enables "credential must be < 30 days old" predicates. */
  readonly now: number;
}

/**
 * Result of a single rule.
 *
 * `passed === false` does not automatically deny the whole gate; that
 * decision depends on whether the gate combinator is `all` (any
 * failure denies) or `any` (any success allows). The explanation
 * string is mandatory on failure and optional on success — audit
 * logs always want a clear "why denied" line.
 */
export interface VcGateRuleResult {
  readonly ruleId: string;
  readonly passed: boolean;
  readonly explanation: string;
  /** Optional structured detail for audit pivots. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * A single composable gate rule.
 *
 * Rules are plain functions; the gate manages ordering, short-circuit
 * behaviour, and result aggregation. Built-in rules live in
 * `gate-rules.ts`; receivers write their own by implementing this
 * interface.
 */
export interface VcGateRule {
  /** Stable id. Surfaces in `VcGateEvaluation.results[*].ruleId` + error codes. */
  readonly id: string;
  /** Short human-readable description. */
  readonly description: string;
  evaluate(context: VcGateContext): VcGateRuleResult | Promise<VcGateRuleResult>;
}

/**
 * Aggregate gate result. Serialises cleanly to JSON for audit storage.
 */
export interface VcGateEvaluation {
  /** `true` iff the gate's combinator accepted the rule set. */
  readonly allowed: boolean;
  /** Per-rule results in evaluation order. */
  readonly results: ReadonlyArray<VcGateRuleResult>;
  /** Ids of the rules that failed. */
  readonly failedRuleIds: ReadonlyArray<string>;
  /** Unix ms when the gate finished evaluating. */
  readonly evaluatedAt: number;
  /**
   * Which combinator applied — "all" means every rule must pass;
   * "any" means one success accepts the gate (used for fallback
   * paths where any KYC issuer is acceptable).
   */
  readonly combinator: "all" | "any";
  /** Snapshot of the reputation score used. */
  readonly reputation: ReputationScore;
}

/**
 * Raw on-the-wire shape for a gate embedded in x402
 * `PaymentRequirements.extra.vcGate`.
 *
 * We model a minimal JSON form so x402 facilitators can parse it
 * without importing the full gate-rules module. Each entry is a
 * typed directive the bridge layer translates into a concrete
 * `VcGateRule` via `gate-rules.ts` helpers.
 */
export type SerializedVcGateDirective =
  | { readonly type: "require-registered-agent" }
  | { readonly type: "require-not-revoked" }
  | {
      readonly type: "require-vc";
      readonly schemaId: SchemaId;
      /** Optional issuer role the VC must originate from. */
      readonly issuerRole?: IssuerRole;
      /** Optional issuer id allow-list (exact match). */
      readonly issuerIds?: ReadonlyArray<string>;
    }
  | {
      readonly type: "require-min-reputation";
      readonly minScore: number;
    }
  | {
      readonly type: "require-min-tier";
      readonly minTier: ReputationTier;
    }
  | {
      readonly type: "require-fresh-vc";
      readonly schemaId: SchemaId;
      /** Max age in milliseconds. */
      readonly maxAgeMs: number;
    };

export interface SerializedVcGate {
  /** Default: "all". */
  readonly combinator?: "all" | "any";
  readonly directives: ReadonlyArray<SerializedVcGateDirective>;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Public helper: translate a raw score into a tier band using the
 * default banding. Operators who use custom bands reimplement at the
 * call site.
 */
export function defaultTierForScore(score: number): ReputationTier {
  for (const band of DEFAULT_TIER_BANDS) {
    if (score >= band.min) return band.tier;
  }
  return "unknown";
}

/**
 * Minimum score required for a given tier under `DEFAULT_TIER_BANDS`.
 * Used by `requireMinTier()` so operators writing gate rules don't
 * have to remember the exact numeric thresholds.
 */
export function defaultScoreForTier(tier: ReputationTier): number {
  const band = DEFAULT_TIER_BANDS.find((b) => b.tier === tier);
  if (!band) {
    throw new Error(`defaultScoreForTier: unknown tier "${tier}"`);
  }
  return band.min;
}

// Re-export upstream types we lean on so consumers don't need to take
// a second dep on `@aethelred/wallet-credentials` just to write a rule.
export type { Attestation, Issuer, IssuerRole, SchemaId, VerifiableCredential };
