/**
 * AggregatingScreeningProvider — institutional-grade multi-source risk.
 *
 * A single screening vendor is a single point of both failure and false
 * confidence. Institutions cross-reference several (Chainalysis + TRM +
 * Elliptic) and treat sanctions hits categorically, not numerically. This
 * provider does exactly that, while *being* a {@link ScreeningProvider} — so
 * it drops straight into {@link LiveScreeningGate} and the authorization
 * pipeline's `screeningStage` with no other change.
 *
 * Sophistication:
 *   - **Parallel multi-source** querying, tolerant of per-source failures.
 *   - **Quorum + fail-closed.** If fewer than `quorum` sources respond, the
 *     address scores the maximum (100) — you don't proceed on thin data.
 *   - **Weighted combination.** `max` (most conservative) or `weighted-mean`
 *     across source weights.
 *   - **Category overrides.** A matching category (default: `sanctions`)
 *     forces a floor score (default 100), so a sanctions hit blocks even if
 *     one vendor scored it low — categorical, not numeric.
 *   - **Union of categories** across all responding sources, for the audit
 *     trail.
 */

import type { AddressRiskScore, ScreeningProvider, ScreeningSeverity } from "./live-screening";

export interface WeightedScreeningSource {
  readonly provider: ScreeningProvider;
  /** Relative weight in `weighted-mean` combination. Default 1. */
  readonly weight?: number;
}

export interface RiskCategoryPolicy {
  /** Case-insensitive substring matched against a source's categories. */
  readonly category: string;
  /** Floor score (0–100) forced when the category is present. */
  readonly forceMinScore: number;
}

export interface AggregatingScreeningConfig {
  /** "max" (default, most conservative) or "weighted-mean". */
  readonly combine?: "max" | "weighted-mean";
  /** Minimum sources that must respond; below it → fail-closed score 100. */
  readonly quorum?: number;
  /** Category floors. Default: sanctions → 100. */
  readonly categoryPolicies?: RiskCategoryPolicy[];
}

const DEFAULT_CATEGORY_POLICIES: RiskCategoryPolicy[] = [{ category: "sanctions", forceMinScore: 100 }];

function severityForScore(score: number): ScreeningSeverity {
  if (score >= 75) return "severe";
  if (score >= 40) return "high";
  if (score >= 15) return "medium";
  return "low";
}

export class AggregatingScreeningProvider implements ScreeningProvider {
  readonly name: string;
  private readonly sources: WeightedScreeningSource[];
  private readonly combine: "max" | "weighted-mean";
  private readonly quorum: number;
  private readonly categoryPolicies: RiskCategoryPolicy[];

  constructor(sources: WeightedScreeningSource[], config: AggregatingScreeningConfig = {}) {
    if (sources.length === 0) throw new Error("AggregatingScreeningProvider needs at least one source");
    this.sources = sources;
    this.combine = config.combine ?? "max";
    this.quorum = config.quorum ?? 1;
    if (this.quorum < 1) throw new Error("quorum must be >= 1");
    this.categoryPolicies = config.categoryPolicies ?? DEFAULT_CATEGORY_POLICIES;
    this.name = `aggregating(${sources.length})`;
  }

  async screenAddress(address: `0x${string}`): Promise<AddressRiskScore> {
    const settled = await Promise.allSettled(this.sources.map((s) => s.provider.screenAddress(address)));

    const responded: { score: AddressRiskScore; weight: number }[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") responded.push({ score: r.value, weight: this.sources[i].weight ?? 1 });
    });

    // Quorum / fail-closed: too few sources → treat as maximum risk.
    if (responded.length < this.quorum) {
      return {
        address,
        riskScore: 100,
        severity: "severe",
        categories: ["screening-unavailable"],
        provider: `${this.name}:fail-closed`,
        screenedAt: Date.now(),
      };
    }

    let combined: number;
    if (this.combine === "max") {
      combined = Math.max(...responded.map((r) => r.score.riskScore));
    } else {
      const totalWeight = responded.reduce((sum, r) => sum + r.weight, 0);
      combined = responded.reduce((sum, r) => sum + r.score.riskScore * r.weight, 0) / totalWeight;
    }

    const categories = [...new Set(responded.flatMap((r) => r.score.categories))];

    // Category overrides — a matching category forces a floor score.
    for (const policy of this.categoryPolicies) {
      const needle = policy.category.toLowerCase();
      if (categories.some((c) => c.toLowerCase().includes(needle))) {
        combined = Math.max(combined, policy.forceMinScore);
      }
    }

    const riskScore = Math.round(Math.min(100, Math.max(0, combined)));
    return {
      address,
      riskScore,
      severity: severityForScore(riskScore),
      categories,
      provider: `${this.name}[${responded.length}/${this.sources.length}]`,
      screenedAt: Date.now(),
    };
  }
}
