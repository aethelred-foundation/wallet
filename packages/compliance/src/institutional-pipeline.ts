/**
 * buildInstitutionalAuthorizationPipeline — the one-call integration entry
 * point for the enforced pre-signing gate.
 *
 * Assembling the {@link TransactionAuthorizationPipeline} by hand means
 * wiring stage order, fail-closed posture, and per-tier strictness correctly
 * every time. This factory encodes the institutional defaults so the signing
 * worker (or any caller) gets a best-practice pipeline in one line:
 *
 *   const pipeline = buildInstitutionalAuthorizationPipeline("sovereign", {
 *     screening: new LiveScreeningGate(aggregatingProvider),
 *     anomaly: new BehavioralAnomalyEngine(),
 *     travelRule: { engine, protocol: "trisa" },
 *     policy: (ctx) => evaluatePolicy(ctx),
 *     onDecision: (ctx, r) => auditCapture.record(...),
 *   });
 *   await pipeline.authorizeOrThrow(context); // before signing
 *
 * Defaults that matter:
 *   - **Stage order** screening → anomaly → travel-rule → policy (cheapest,
 *     most-categorical checks first; policy last so it sees the rest).
 *   - **Always fail-closed** (`onStageError: "block"`).
 *   - **Tier strictness**: Sovereign escalates every `review` to a hard
 *     `block` (a human-in-the-loop signal halts rather than warns);
 *     Enterprise/Personal keep `review` as a reviewable outcome.
 *
 * Each dependency is optional — omit one and its stage is skipped — so a
 * deployment can light up controls incrementally as vendors are wired.
 */

import {
  TransactionAuthorizationPipeline,
  screeningStage,
  travelRuleStage,
  policyStage,
  type AuthorizationStage,
  type AuthorizationContext,
  type CustodyTier,
  type PipelineConfig,
  type PolicyOutcome,
} from "./authorization-pipeline";
import { anomalyStage, type BehavioralAnomalyEngine } from "./behavioral-anomaly";
import type { LiveScreeningGate } from "./live-screening";
import type { TravelRuleInteropEngine, TravelRuleProtocol } from "./travel-rule-interop";

export interface InstitutionalPipelineDeps {
  /** Live screening gate (wrap an AggregatingScreeningProvider for multi-vendor). */
  readonly screening?: LiveScreeningGate;
  /** Behavioural anomaly engine for per-subject AML monitoring. */
  readonly anomaly?: BehavioralAnomalyEngine;
  /** Travel-rule interop + the protocol to emit on. */
  readonly travelRule?: { readonly engine: TravelRuleInteropEngine; readonly protocol: TravelRuleProtocol };
  /** Policy evaluation (inject your @aethelred/wallet-policy call). */
  readonly policy?: (
    context: AuthorizationContext,
  ) => { outcome: PolicyOutcome; reason?: string } | Promise<{ outcome: PolicyOutcome; reason?: string }>;
  /** Audit hook — receives every decision for the tamper-evident chain. */
  readonly onDecision?: PipelineConfig["onDecision"];
}

/** Assemble the recommended enforced authorization pipeline for a custody tier. */
export function buildInstitutionalAuthorizationPipeline(
  tier: CustodyTier,
  deps: InstitutionalPipelineDeps,
): TransactionAuthorizationPipeline {
  const stages: AuthorizationStage[] = [];
  if (deps.screening) stages.push(screeningStage(deps.screening));
  if (deps.anomaly) stages.push(anomalyStage(deps.anomaly));
  if (deps.travelRule) stages.push(travelRuleStage(deps.travelRule.engine, deps.travelRule.protocol));
  if (deps.policy) stages.push(policyStage(deps.policy));

  if (stages.length === 0) {
    throw new Error("buildInstitutionalAuthorizationPipeline: provide at least one stage dependency");
  }

  return new TransactionAuthorizationPipeline(stages, {
    // Always fail-closed: a control that can't run must not silently pass.
    onStageError: "block",
    // Sovereign vaults treat "needs a human" as a hard stop.
    escalateReviewToBlock: tier === "sovereign",
    onDecision: deps.onDecision,
  });
}
