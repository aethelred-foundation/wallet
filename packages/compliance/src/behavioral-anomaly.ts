/**
 * BehavioralAnomalyEngine — per-subject AML behavioural monitoring.
 *
 * Screening catches *who* you transact with; behavioural monitoring catches
 * *how* — the patterns that signal structuring, account takeover, or money
 * laundering even when every counterparty looks clean. This engine keeps an
 * online statistical baseline per subject (Welford's algorithm, O(1) memory
 * for mean/variance) and scores each new transaction against it plus a set of
 * classic AML heuristics:
 *
 *   - **structuring** — amounts deliberately kept just under a reporting
 *     threshold (e.g. < $10k CTR), especially repeated within a window.
 *   - **amount-spike** — amount > N standard deviations above the subject's
 *     own historical mean (z-score, once enough history exists).
 *   - **new-counterparty** — first time sending to this destination.
 *   - **dormancy-reactivation** — long-idle account suddenly active.
 *   - **rapid-repeat** — several near-identical transfers in a short window.
 *
 * It is composable: {@link anomalyStage} wraps it as an
 * {@link AuthorizationStage} for the pre-signing pipeline. `assess()` is a
 * pure read; `record()` updates the baseline — so the pipeline can assess
 * before authorizing and record after, or do both at once.
 */

import type { AuthorizationStage } from "./authorization-pipeline";

export type AnomalyFlag =
  | "structuring"
  | "amount-spike"
  | "new-counterparty"
  | "dormancy-reactivation"
  | "rapid-repeat";

export type AnomalyDecision = "allow" | "review" | "block";

export interface AnomalyConfig {
  /** Reporting threshold (USD) for structuring detection. Default 10000 (CTR). */
  reportingThresholdUsd: number;
  /** A txn within this fraction *below* the threshold is a structuring signal. Default 0.1. */
  structuringBandPct: number;
  /** z-score above which an amount is anomalous vs the subject baseline. Default 3. */
  amountZThreshold: number;
  /** Idle window (ms) after which reactivation is flagged. Default 90 days. */
  dormancyMs: number;
  /** Min observations before z-score baselining applies. Default 5. */
  minObservations: number;
  /** Rapid-repeat window (ms). Default 1 hour. */
  rapidRepeatWindowMs: number;
  /** Aggregate score → review / block thresholds. */
  reviewScore: number;
  blockScore: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  reportingThresholdUsd: 10_000,
  structuringBandPct: 0.1,
  amountZThreshold: 3,
  dormancyMs: 90 * 24 * 60 * 60 * 1000,
  minObservations: 5,
  rapidRepeatWindowMs: 60 * 60 * 1000,
  reviewScore: 40,
  blockScore: 80,
};

export interface AnomalyAssessment {
  readonly subjectId: string;
  readonly score: number; // 0–100
  readonly decision: AnomalyDecision;
  readonly flags: AnomalyFlag[];
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface AnomalyObservation {
  readonly subjectId: string;
  readonly amountUsd: number;
  readonly counterparty: string;
  readonly at?: number;
}

interface SubjectBaseline {
  count: number;
  mean: number;
  m2: number; // Welford running sum of squared deltas
  counterparties: Set<string>;
  lastSeenAt: number;
  recent: { amount: number; counterparty: string; at: number }[];
}

/** Per-flag score contributions. Tuned so any single strong signal reviews, two block. */
const FLAG_WEIGHTS: Record<AnomalyFlag, number> = {
  structuring: 45,
  "amount-spike": 40,
  "new-counterparty": 20,
  "dormancy-reactivation": 25,
  "rapid-repeat": 30,
};

export class BehavioralAnomalyEngine {
  private readonly config: AnomalyConfig;
  private readonly subjects = new Map<string, SubjectBaseline>();

  constructor(config: Partial<AnomalyConfig> = {}) {
    this.config = { ...DEFAULT_ANOMALY_CONFIG, ...config };
    if (this.config.reviewScore >= this.config.blockScore) {
      throw new Error("reviewScore must be < blockScore");
    }
  }

  /** Score a transaction against the subject's baseline. Does NOT mutate state. */
  assess(obs: AnomalyObservation): AnomalyAssessment {
    const at = obs.at ?? Date.now();
    const b = this.subjects.get(obs.subjectId);
    const flags: AnomalyFlag[] = [];
    const detail: Record<string, unknown> = {};
    const { config } = this;

    // structuring — just below the reporting threshold
    const band = config.reportingThresholdUsd * (1 - config.structuringBandPct);
    if (obs.amountUsd >= band && obs.amountUsd < config.reportingThresholdUsd) {
      flags.push("structuring");
      detail.structuringBand = [Math.round(band), config.reportingThresholdUsd];
      // repeated structuring within the window is a much stronger signal
      const priorInBand = b
        ? b.recent.filter((r) => at - r.at <= config.dormancyMs && r.amount >= band && r.amount < config.reportingThresholdUsd).length
        : 0;
      if (priorInBand >= 1) detail.repeatedStructuring = priorInBand + 1;
    }

    if (b && b.count > 0) {
      // new counterparty
      if (!b.counterparties.has(obs.counterparty)) {
        flags.push("new-counterparty");
      }
      // amount-spike (z-score) once we have enough history
      if (b.count >= config.minObservations) {
        const variance = b.m2 / (b.count - 1);
        const std = Math.sqrt(Math.max(variance, 0));
        if (std > 0) {
          const z = (obs.amountUsd - b.mean) / std;
          detail.amountZ = Number(z.toFixed(2));
          if (z > config.amountZThreshold) flags.push("amount-spike");
        }
      }
      // dormancy reactivation
      if (at - b.lastSeenAt > config.dormancyMs) {
        flags.push("dormancy-reactivation");
        detail.idleMs = at - b.lastSeenAt;
      }
      // rapid repeat — near-identical transfer recently
      const repeat = b.recent.filter(
        (r) => at - r.at <= config.rapidRepeatWindowMs && r.counterparty === obs.counterparty && Math.abs(r.amount - obs.amountUsd) < 1e-6,
      ).length;
      if (repeat >= 1) {
        flags.push("rapid-repeat");
        detail.rapidRepeatCount = repeat + 1;
      }
    }

    let score = flags.reduce((s, f) => s + FLAG_WEIGHTS[f], 0);
    if (detail.repeatedStructuring) score += 30; // escalate repeated structuring toward block
    score = Math.min(100, score);

    const decision: AnomalyDecision =
      score >= config.blockScore ? "block" : score >= config.reviewScore ? "review" : "allow";

    return { subjectId: obs.subjectId, score, decision, flags, detail };
  }

  /** Fold a transaction into the subject's baseline (Welford update). */
  record(obs: AnomalyObservation): void {
    const at = obs.at ?? Date.now();
    let b = this.subjects.get(obs.subjectId);
    if (!b) {
      b = { count: 0, mean: 0, m2: 0, counterparties: new Set(), lastSeenAt: at, recent: [] };
      this.subjects.set(obs.subjectId, b);
    }
    // Welford online mean/variance
    b.count += 1;
    const delta = obs.amountUsd - b.mean;
    b.mean += delta / b.count;
    b.m2 += delta * (obs.amountUsd - b.mean);

    b.counterparties.add(obs.counterparty);
    b.lastSeenAt = at;
    b.recent.push({ amount: obs.amountUsd, counterparty: obs.counterparty, at });
    // keep the recent window bounded
    const cutoff = at - Math.max(this.config.dormancyMs, this.config.rapidRepeatWindowMs);
    b.recent = b.recent.filter((r) => r.at >= cutoff).slice(-200);
  }

  /** Assess then record — the common pipeline path. */
  assessAndRecord(obs: AnomalyObservation): AnomalyAssessment {
    const assessment = this.assess(obs);
    this.record(obs);
    return assessment;
  }

  /** Inspect a subject's current baseline (mean/stddev/counterparties). */
  baselineFor(subjectId: string): { count: number; mean: number; std: number; counterparties: number } | undefined {
    const b = this.subjects.get(subjectId);
    if (!b) return undefined;
    const std = b.count > 1 ? Math.sqrt(Math.max(b.m2 / (b.count - 1), 0)) : 0;
    return { count: b.count, mean: b.mean, std, counterparties: b.counterparties.size };
  }
}

/**
 * Wrap a {@link BehavioralAnomalyEngine} as an authorization-pipeline stage.
 * By default it assesses *and* records (so the baseline keeps learning);
 * pass `{ record: false }` for a pure read (e.g. a what-if check).
 */
export function anomalyStage(engine: BehavioralAnomalyEngine, opts: { record?: boolean } = {}): AuthorizationStage {
  return {
    name: "behavioral-anomaly",
    evaluate(context) {
      const obs: AnomalyObservation = {
        subjectId: context.subjectId ?? "unknown-subject",
        amountUsd: context.amountUsd,
        counterparty: context.destinationAddress,
      };
      const assessment = opts.record === false ? engine.assess(obs) : engine.assessAndRecord(obs);
      return {
        stage: "behavioral-anomaly",
        decision: assessment.decision,
        reason: assessment.flags.length ? `anomalies: ${assessment.flags.join(", ")}` : "within baseline",
        detail: { score: assessment.score, flags: assessment.flags, ...assessment.detail },
      };
    },
  };
}
