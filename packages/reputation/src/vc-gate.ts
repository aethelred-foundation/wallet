/**
 * `VcGate` — the receiver-side policy evaluator.
 *
 * A receiver (merchant, facilitator, x402 resource owner) declares a
 * set of `VcGateRule`s that every incoming payment MUST satisfy. The
 * gate evaluates the rules against a `VcGateContext` populated by the
 * bridge and emits a structured `VcGateEvaluation`.
 *
 * Two combinators ship:
 *
 *   - `VcGate.all([...])` — every rule must pass (most common).
 *   - `VcGate.any([...])` — at least one rule must pass (fallback
 *     chains, e.g. "any of these three KYC providers is acceptable").
 *
 * Rules are pure: they take a context, return a result. The gate
 * owns all I/O ordering and result aggregation. This keeps rules
 * trivially testable and lets receivers compose custom rules without
 * wiring an async pipeline.
 *
 * A rule's id is the foreign key into audit storage. When a gate
 * denies a payment, the x402 facilitator returns the failed rule ids
 * (not the full rules — they may leak the receiver's policy) so the
 * agent can correct and retry with the specific missing credential.
 */

import type {
  VcGateContext,
  VcGateEvaluation,
  VcGateRule,
  VcGateRuleResult,
} from "./types";
import { VcGateDeniedError } from "./errors";

export class VcGate {
  private readonly rules: ReadonlyArray<VcGateRule>;
  private readonly combinator: "all" | "any";

  private constructor(rules: ReadonlyArray<VcGateRule>, combinator: "all" | "any") {
    if (rules.length === 0) {
      throw new Error("VcGate requires at least one rule");
    }
    // Reject duplicate rule ids — audit pivots would collide.
    const ids = new Set<string>();
    for (const rule of rules) {
      if (ids.has(rule.id)) {
        throw new Error(`VcGate: duplicate rule id "${rule.id}"`);
      }
      ids.add(rule.id);
    }
    this.rules = rules;
    this.combinator = combinator;
  }

  /** Every rule must pass. */
  static all(rules: ReadonlyArray<VcGateRule>): VcGate {
    return new VcGate(rules, "all");
  }

  /** At least one rule must pass. */
  static any(rules: ReadonlyArray<VcGateRule>): VcGate {
    return new VcGate(rules, "any");
  }

  /**
   * Evaluate every rule against the context.
   *
   * Returns an evaluation record regardless of outcome; the caller
   * inspects `evaluation.allowed` and decides whether to `throw new
   * VcGateDeniedError`. We prefer not to throw unconditionally so
   * UIs can show "fix these N things" without parsing an exception.
   */
  async evaluate(context: VcGateContext): Promise<VcGateEvaluation> {
    const results: VcGateRuleResult[] = [];
    const failedRuleIds: string[] = [];

    for (const rule of this.rules) {
      let result: VcGateRuleResult;
      try {
        result = await rule.evaluate(context);
      } catch (cause) {
        // Never let a faulty rule bypass the gate silently. Turn the
        // exception into a structured failure so the aggregate
        // evaluation stays consistent.
        const message =
          cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "rule threw";
        result = {
          ruleId: rule.id,
          passed: false,
          explanation: `Rule "${rule.id}" threw: ${message}`,
          details: { thrown: true },
        };
      }

      results.push(result);
      if (!result.passed) {
        failedRuleIds.push(rule.id);
        if (this.combinator === "all") {
          // Short-circuit: the decision is already denied.
          break;
        }
      } else if (this.combinator === "any") {
        // Short-circuit: one success is enough.
        break;
      }
    }

    const allowed =
      this.combinator === "all" ? failedRuleIds.length === 0 : results.some((r) => r.passed);

    return {
      allowed,
      results,
      failedRuleIds,
      evaluatedAt: context.now,
      combinator: this.combinator,
      reputation: context.reputation,
    };
  }

  /**
   * Convenience: evaluate + throw on denial. Used by callers that
   * prefer exception flow (x402 facilitator inside the verify
   * pipeline) — same underlying evaluation shape, just a different
   * surface.
   */
  async assertAllowed(context: VcGateContext): Promise<VcGateEvaluation> {
    const evaluation = await this.evaluate(context);
    if (!evaluation.allowed) {
      throw new VcGateDeniedError(
        evaluation.failedRuleIds,
        `VcGate denied payment: ${evaluation.failedRuleIds.join(", ")}`,
      );
    }
    return evaluation;
  }

  /** Ordered rule ids — useful for audit logs that want to record the policy. */
  get ruleIds(): ReadonlyArray<string> {
    return this.rules.map((r) => r.id);
  }

  get combinatorKind(): "all" | "any" {
    return this.combinator;
  }
}
