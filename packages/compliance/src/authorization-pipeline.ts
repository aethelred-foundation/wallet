/**
 * TransactionAuthorizationPipeline — the enforced pre-signing decision.
 *
 * Individually, the compliance primitives (live screening, travel-rule
 * interop, policy, velocity) are gates. A *wallet* needs them composed into
 * one ordered, fail-closed, audited decision that runs before every
 * signature. This pipeline is that composition: it runs a configurable,
 * ordered set of {@link AuthorizationStage}s, aggregates them by severity
 * (block ≻ review ≻ allow), and emits a single {@link AuthorizationResult}.
 *
 * Design properties that make it production-grade:
 *
 *   - **Decoupled.** Stages are injected. The pipeline imports no policy or
 *     audit package — callers pass stages and an `onDecision` audit hook.
 *     This keeps the compliance package free of upstream deps and lets every
 *     stage be unit-tested in isolation.
 *   - **Fail-closed.** A stage that throws is treated as `block` (or `review`
 *     if configured) — you never silently pass a transaction because a
 *     screening provider timed out.
 *   - **Tier-aware strictness.** `escalateReviewToBlock` turns every `review`
 *     into a hard `block` — the correct posture for a Sovereign-tier vault
 *     where "needs a human" should halt, not warn.
 *   - **Full or fast.** `collect-all` runs every stage for a complete audit
 *     trail; `fail-fast` short-circuits on the first block for latency.
 *   - **Auditable.** Every decision (with its ordered stage results) is handed
 *     to `onDecision` for the tamper-evident chain.
 *
 * The pre-built adapters ({@link screeningStage}, {@link travelRuleStage},
 * {@link policyStage}) wrap the existing gates so a caller assembles a
 * pipeline in a few lines.
 */

import type { LiveScreeningGate } from "./live-screening";
import type { TravelRuleData } from "./types";
import { TravelRuleInteropEngine, TravelRuleInteropError, type TravelRuleProtocol } from "./travel-rule-interop";

export type AuthorizationDecision = "allow" | "review" | "block";

const SEVERITY: Record<AuthorizationDecision, number> = { allow: 0, review: 1, block: 2 };

function moreSevere(a: AuthorizationDecision, b: AuthorizationDecision): AuthorizationDecision {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

export interface AuthorizationStageResult {
  readonly stage: string;
  readonly decision: AuthorizationDecision;
  readonly reason: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface AuthorizationResult {
  /** Aggregate decision — the most severe stage outcome. */
  readonly decision: AuthorizationDecision;
  readonly blocked: boolean;
  readonly requiresReview: boolean;
  /** Ordered per-stage results (the audit trail). */
  readonly stages: AuthorizationStageResult[];
  readonly evaluatedAt: number;
}

export type CustodyTier = "personal" | "enterprise" | "sovereign";

/** Everything a stage might need to reach a decision. */
export interface AuthorizationContext {
  readonly transactionId: string;
  readonly destinationAddress: `0x${string}`;
  readonly amountUsd: number;
  readonly tier: CustodyTier;
  /** Originating account/subject — keys behavioral baselining. */
  readonly subjectId?: string;
  /** Present when the transfer is in scope for the Travel Rule. */
  readonly travelRuleRecord?: TravelRuleData;
  /** Free-form extra signals for custom stages. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** A single ordered check. Pure-ish: no side effects beyond reading collaborators. */
export interface AuthorizationStage {
  readonly name: string;
  evaluate(context: AuthorizationContext): Promise<AuthorizationStageResult> | AuthorizationStageResult;
}

export interface PipelineConfig {
  /** "collect-all" (default) runs every stage; "fail-fast" stops at first block. */
  readonly mode?: "collect-all" | "fail-fast";
  /** What a thrown stage maps to. Fail-closed default: "block". */
  readonly onStageError?: "block" | "review";
  /** Escalate any "review" to "block" (Sovereign-tier strictness). */
  readonly escalateReviewToBlock?: boolean;
  /** Audit hook — receives every decision for the tamper-evident chain. */
  readonly onDecision?: (context: AuthorizationContext, result: AuthorizationResult) => void;
}

/** Thrown by {@link TransactionAuthorizationPipeline.authorizeOrThrow} on block. */
export class AuthorizationBlockedError extends Error {
  readonly result: AuthorizationResult;
  constructor(result: AuthorizationResult) {
    const blocking = result.stages.filter((s) => s.decision === "block").map((s) => `${s.stage}: ${s.reason}`);
    super(`Transaction authorization blocked — ${blocking.join("; ") || "policy"}`);
    this.name = "AuthorizationBlockedError";
    this.result = result;
  }
}

export class TransactionAuthorizationPipeline {
  private readonly stages: AuthorizationStage[];
  private readonly mode: "collect-all" | "fail-fast";
  private readonly onStageError: "block" | "review";
  private readonly escalateReviewToBlock: boolean;
  private readonly onDecision?: PipelineConfig["onDecision"];

  constructor(stages: AuthorizationStage[], config: PipelineConfig = {}) {
    if (stages.length === 0) throw new Error("AuthorizationPipeline requires at least one stage");
    const names = stages.map((s) => s.name);
    if (new Set(names).size !== names.length) throw new Error("AuthorizationPipeline stage names must be unique");
    this.stages = stages;
    this.mode = config.mode ?? "collect-all";
    this.onStageError = config.onStageError ?? "block";
    this.escalateReviewToBlock = config.escalateReviewToBlock ?? false;
    this.onDecision = config.onDecision;
  }

  /** Run the pipeline and return the aggregate decision (never throws on a block). */
  async authorize(context: AuthorizationContext): Promise<AuthorizationResult> {
    const stages: AuthorizationStageResult[] = [];
    let aggregate: AuthorizationDecision = "allow";

    for (const stage of this.stages) {
      let result: AuthorizationStageResult;
      try {
        result = await stage.evaluate(context);
      } catch (cause) {
        result = {
          stage: stage.name,
          decision: this.onStageError,
          reason: `stage error (fail-closed): ${cause instanceof Error ? cause.message : String(cause)}`,
        };
      }
      stages.push(result);
      aggregate = moreSevere(aggregate, result.decision);
      if (this.mode === "fail-fast" && aggregate === "block") break;
    }

    if (this.escalateReviewToBlock && aggregate === "review") {
      aggregate = "block";
    }

    const result: AuthorizationResult = {
      decision: aggregate,
      blocked: aggregate === "block",
      requiresReview: aggregate === "review",
      stages,
      evaluatedAt: Date.now(),
    };
    this.onDecision?.(context, result);
    return result;
  }

  /**
   * Enforcement entry point for the signing pipeline: throws
   * {@link AuthorizationBlockedError} if blocked, otherwise returns the
   * result (which may still be `review` — surface that to the approver).
   */
  async authorizeOrThrow(context: AuthorizationContext): Promise<AuthorizationResult> {
    const result = await this.authorize(context);
    if (result.blocked) throw new AuthorizationBlockedError(result);
    return result;
  }
}

/* ─── Pre-built stage adapters ──────────────────────────────────── */

/** Wrap a {@link LiveScreeningGate} as a pipeline stage. */
export function screeningStage(gate: LiveScreeningGate): AuthorizationStage {
  return {
    name: "screening",
    async evaluate(context) {
      const outcome = await gate.evaluate(context.destinationAddress);
      return {
        stage: "screening",
        decision: outcome.decision, // ScreeningDecision is allow|review|block
        reason: outcome.reason,
        detail: { riskScore: outcome.score?.riskScore, provider: outcome.score?.provider },
      };
    },
  };
}

/**
 * Wrap a {@link TravelRuleInteropEngine} as a pipeline stage. A transfer in
 * scope (`travelRuleRecord` present) whose IVMS101 payload is incomplete is
 * routed to `review` (collect the missing data) rather than silently passed.
 */
export function travelRuleStage(engine: TravelRuleInteropEngine, protocol: TravelRuleProtocol): AuthorizationStage {
  return {
    name: "travel-rule",
    evaluate(context) {
      if (!context.travelRuleRecord) {
        return { stage: "travel-rule", decision: "allow", reason: "not in Travel Rule scope" };
      }
      try {
        engine.prepareEnvelope(context.travelRuleRecord, protocol);
        return { stage: "travel-rule", decision: "allow", reason: "IVMS101 payload complete" };
      } catch (cause) {
        if (cause instanceof TravelRuleInteropError) {
          return { stage: "travel-rule", decision: "review", reason: `IVMS101 incomplete: ${cause.missing.join(", ")}`, detail: { missing: cause.missing } };
        }
        throw cause;
      }
    },
  };
}

/** Policy-engine outcomes, mapped to authorization decisions by {@link policyStage}. */
export type PolicyOutcome = "allow" | "warn" | "approval-required" | "deny";

/**
 * Wrap an injected policy evaluation as a stage (keeps this package free of a
 * `@aethelred/wallet-policy` dependency). `deny → block`, `approval-required →
 * review`, `warn`/`allow → allow` (warn carries its reason through).
 */
export function policyStage(
  evaluate: (context: AuthorizationContext) => { outcome: PolicyOutcome; reason?: string } | Promise<{ outcome: PolicyOutcome; reason?: string }>,
): AuthorizationStage {
  return {
    name: "policy",
    async evaluate(context) {
      const { outcome, reason } = await evaluate(context);
      const decision: AuthorizationDecision = outcome === "deny" ? "block" : outcome === "approval-required" ? "review" : "allow";
      return { stage: "policy", decision, reason: reason ?? outcome };
    },
  };
}
