/**
 * `ReputationAggregator` — deterministic reputation scoring.
 *
 * Inputs: a set of `ReputationSignal`s (VCs, payment events, fraud
 * reports, TEE drift events, revocations).
 *
 * Output: a `ReputationScore` with a transparency report that
 * enumerates every signal applied, in order, with its weight and the
 * running cumulative score. Auditors reconstruct the score from the
 * transparency record; no hidden state.
 *
 * Determinism requirements:
 *
 *   1. Same inputs → same score. No clock reads except the one
 *      `computedAt` timestamp baked into the output.
 *   2. Signal ordering is stable and declared — we sort signals into
 *      canonical order before applying weights so the caller cannot
 *      shuffle signals to game the cumulative-score trace.
 *   3. Rounding is fixed (no floating point — score is always
 *      integer).
 *   4. Bounds are applied AFTER accumulation so intermediate negative
 *      steps still show up in the transparency report, not silently
 *      clamped.
 *
 * The aggregator is a pure function wrapped in a class only so
 * callers can stash tuned `ReputationWeights` and a custom
 * `tierForScore` function at construction. For callers that want a
 * one-shot computation, `aggregateReputation()` is also exported.
 */

import { assertNever } from "@aethelred/wallet-observability";

import {
  DEFAULT_REPUTATION_WEIGHTS,
  defaultTierForScore,
  type ReputationScore,
  type ReputationSignal,
  type ReputationTier,
  type ReputationWeights,
} from "./types";

export interface ReputationAggregatorConfig {
  /** Weight overrides. Missing fields fall back to defaults. */
  readonly weights?: Partial<ReputationWeights>;
  /** Override the default tier banding. */
  readonly tierForScore?: (score: number) => ReputationTier;
  /**
   * Clock override, primarily for tests. The aggregator only reads
   * the clock once per `aggregate()` call — the value gets stamped
   * into `ReputationScore.computedAt`.
   */
  readonly now?: () => number;
}

export class ReputationAggregator {
  private readonly weights: ReputationWeights;
  private readonly tierForScore: (score: number) => ReputationTier;
  private readonly now: () => number;

  constructor(config: ReputationAggregatorConfig = {}) {
    this.weights = { ...DEFAULT_REPUTATION_WEIGHTS, ...(config.weights ?? {}) };
    this.tierForScore = config.tierForScore ?? defaultTierForScore;
    this.now = config.now ?? (() => Date.now());

    // Defensive: ceiling must not be below floor.
    if (this.weights.ceiling < this.weights.floor) {
      throw new Error(
        `ReputationAggregator: weights.ceiling (${this.weights.ceiling}) must be >= weights.floor (${this.weights.floor})`,
      );
    }
  }

  /**
   * Compute the aggregate score for an agent from a list of signals.
   *
   * Signals are normalised (see `canonicalOrder`) before weights are
   * applied so the transparency trace is stable across callers.
   */
  aggregate(
    agentId: `0x${string}`,
    signals: ReadonlyArray<ReputationSignal>,
  ): ReputationScore {
    const ordered = canonicalOrder(signals);

    let running = this.weights.baseline;
    // Track successful-payment contribution separately so we can cap
    // it once without re-walking the list.
    let paymentContribution = 0;

    const transparency: Array<{
      signal: ReputationSignal;
      appliedWeight: number;
      cumulativeScore: number;
    }> = [];

    for (const signal of ordered) {
      const rawWeight = this.weightFor(signal);
      let appliedWeight = rawWeight;

      if (signal.kind === "payment-success") {
        // Cap the TOTAL payment contribution, not each individual
        // signal. Multiple payment-success signals (e.g. one per
        // network) all feed into the same cap.
        const remaining = this.weights.successPaymentCap - paymentContribution;
        appliedWeight = clamp(rawWeight, -Infinity, Math.max(remaining, 0));
        paymentContribution += appliedWeight;
      }

      running += appliedWeight;
      transparency.push({
        signal,
        appliedWeight,
        cumulativeScore: running,
      });
    }

    const bounded = clamp(running, this.weights.floor, this.weights.ceiling);

    return {
      agentId,
      score: bounded,
      tier: this.tierForScore(bounded),
      transparency,
      computedAt: this.now(),
    };
  }

  /**
   * Weight the aggregator assigns to a single signal. Exposed mainly
   * for unit tests that want to assert a particular signal produces
   * a particular weight.
   */
  weightFor(signal: ReputationSignal): number {
    switch (signal.kind) {
      case "vc-attestation":
        return this.weightForVc(signal.issuerRole, signal.weight);
      case "payment-success":
        return clamp(
          signal.count * this.weights.successPaymentPer,
          0,
          this.weights.successPaymentCap,
        );
      case "fraud-report":
        return this.weights.fraudReport;
      case "revocation":
        return this.weights.revocation;
      case "tee-attestation-drift":
        return this.weights.teeDrift;
      default: {
        // Exhaustiveness guard. If a new signal kind is added and we
        // forget to handle it here, TS will fail the assignment rather
        // than silently returning 0 and understating risk.
        assertNever(signal);
      }
    }
  }

  // ─── Private ────────────────────────────────────────────────

  private weightForVc(role: string, caller: number): number {
    // If the signal carries an explicit `weight`, honour it (some
    // advanced callers precompute per-VC weights from verifier
    // results). Otherwise, fall back to the role-based defaults.
    if (caller !== 0 && Number.isFinite(caller)) return caller;

    switch (role) {
      case "kyc-provider":
        return this.weights.kycVc;
      case "aml-provider":
        return this.weights.amlVc;
      case "accredited-investor-verifier":
        return this.weights.accreditedInvestorVc;
      case "vasp-registrar":
        return this.weights.vaspLicenseVc;
      case "chain-analytics":
        return this.weights.amlVc;
      default:
        return 0;
    }
  }
}

/**
 * One-shot helper for callers that don't need to retain an
 * aggregator instance.
 */
export function aggregateReputation(
  agentId: `0x${string}`,
  signals: ReadonlyArray<ReputationSignal>,
  config?: ReputationAggregatorConfig,
): ReputationScore {
  return new ReputationAggregator(config).aggregate(agentId, signals);
}

// ─── Ordering ───────────────────────────────────────────────────

/**
 * Deterministic signal ordering.
 *
 * We apply signals in a fixed order so the transparency trace is
 * reproducible regardless of caller-supplied ordering:
 *
 *   1. VC attestations (highest issuer-role weight first, then by
 *      issuerId/schemaId for stability)
 *   2. Payment successes (higher count first)
 *   3. Revocations (oldest first — older revocations deserve to be
 *      seen earlier in the trace)
 *   4. Fraud reports (oldest first)
 *   5. TEE drift events (oldest first)
 *
 * Exported for tests; not part of the public API.
 */
export function canonicalOrder(
  signals: ReadonlyArray<ReputationSignal>,
): ReadonlyArray<ReputationSignal> {
  const bucketed = {
    vc: [] as ReputationSignal[],
    payment: [] as ReputationSignal[],
    revocation: [] as ReputationSignal[],
    fraud: [] as ReputationSignal[],
    drift: [] as ReputationSignal[],
  };

  for (const s of signals) {
    switch (s.kind) {
      case "vc-attestation":
        bucketed.vc.push(s);
        break;
      case "payment-success":
        bucketed.payment.push(s);
        break;
      case "revocation":
        bucketed.revocation.push(s);
        break;
      case "fraud-report":
        bucketed.fraud.push(s);
        break;
      case "tee-attestation-drift":
        bucketed.drift.push(s);
        break;
    }
  }

  // Stable secondary ordering per bucket
  const roleOrder: Readonly<Record<string, number>> = {
    "vasp-registrar": 0,
    "kyc-provider": 1,
    "aml-provider": 2,
    "accredited-investor-verifier": 3,
    "chain-analytics": 4,
    self: 5,
  };

  bucketed.vc.sort((a, b) => {
    if (a.kind !== "vc-attestation" || b.kind !== "vc-attestation") return 0;
    const roleDiff = (roleOrder[a.issuerRole] ?? 99) - (roleOrder[b.issuerRole] ?? 99);
    if (roleDiff !== 0) return roleDiff;
    if (a.issuerId !== b.issuerId) return a.issuerId < b.issuerId ? -1 : 1;
    return a.schemaId < b.schemaId ? -1 : a.schemaId > b.schemaId ? 1 : 0;
  });

  bucketed.payment.sort((a, b) => {
    if (a.kind !== "payment-success" || b.kind !== "payment-success") return 0;
    return b.count - a.count;
  });

  bucketed.revocation.sort((a, b) => {
    if (a.kind !== "revocation" || b.kind !== "revocation") return 0;
    return a.revokedAt - b.revokedAt;
  });

  bucketed.fraud.sort((a, b) => {
    if (a.kind !== "fraud-report" || b.kind !== "fraud-report") return 0;
    return a.reportedAt - b.reportedAt;
  });

  bucketed.drift.sort((a, b) => {
    if (a.kind !== "tee-attestation-drift" || b.kind !== "tee-attestation-drift") return 0;
    return a.observedAt - b.observedAt;
  });

  return [
    ...bucketed.vc,
    ...bucketed.payment,
    ...bucketed.revocation,
    ...bucketed.fraud,
    ...bucketed.drift,
  ];
}

// ─── Helpers ────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return Math.trunc(n);
}
