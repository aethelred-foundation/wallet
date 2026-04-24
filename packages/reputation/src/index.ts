/**
 * `@aethelred/wallet-reputation` — ERC-8004 + reputation + VC gates.
 *
 * The bridge package the x402 facilitator calls during the `verify`
 * step to decide whether an incoming payment from an autonomous
 * agent satisfies the receiver's declared policy. Receivers declare
 * gates by dropping a `SerializedVcGate` into
 * `PaymentRequirement.extra.vcGate`; everything else is plumbing:
 *
 *     import { evaluatePayment } from "@aethelred/wallet-reputation";
 *     const result = await evaluatePayment({
 *       requirement,           // x402 PaymentRequirement
 *       agentControlAddress,   // from the signed authorization
 *       resolver,              // ERC-8004 registry
 *       credentialSource,      // verified-VC store
 *     });
 *     if (!result.allowed) return 402(result.evaluation.failedRuleIds);
 *
 * @packageDocumentation
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  AgentIdentity,
  ERC8004Resolver,
  ReputationScore,
  ReputationSignal,
  ReputationTier,
  ReputationWeights,
  VcGateContext,
  VcGateEvaluation,
  VcGateRule,
  VcGateRuleResult,
  SerializedVcGate,
  SerializedVcGateDirective,
  // Upstream re-exports so callers don't double-dep credentials.
  Attestation,
  Issuer,
  IssuerRole,
  SchemaId,
  VerifiableCredential,
} from "./types";
export {
  DEFAULT_REPUTATION_WEIGHTS,
  DEFAULT_TIER_BANDS,
  defaultTierForScore,
  defaultScoreForTier,
} from "./types";

// ─── Errors ──────────────────────────────────────────────────────
export { ReputationError, VcGateDeniedError } from "./errors";
export type { ReputationErrorCode } from "./errors";

// ─── ERC-8004 resolvers ─────────────────────────────────────────
export {
  InMemoryERC8004Resolver,
  CachingERC8004Resolver,
} from "./erc8004-resolver";
export type { CachingERC8004ResolverConfig } from "./erc8004-resolver";

// ─── Reputation aggregator ──────────────────────────────────────
export {
  ReputationAggregator,
  aggregateReputation,
  canonicalOrder,
} from "./reputation-aggregator";
export type { ReputationAggregatorConfig } from "./reputation-aggregator";

// ─── VC gate + rule factories ───────────────────────────────────
export { VcGate } from "./vc-gate";
export {
  requireRegisteredAgent,
  requireNotRevoked,
  requireVcOfSchema,
  requireFreshVc,
  requireMinReputation,
  requireMinTier,
  customRule,
} from "./gate-rules";
export type { RequireVcOptions } from "./gate-rules";

// ─── x402 bridge + generic agent evaluator ───────────────────────
export {
  evaluatePayment,
  evaluateAgent,
  extractGate,
  gateFromSerialized,
  ruleFromDirective,
  EmptySignalSource,
} from "./x402-bridge";
export type {
  EvaluatePaymentOptions,
  EvaluatePaymentResult,
  EvaluateAgentOptions,
  EvaluateAgentResult,
  GateCredentialSource,
  ReputationSignalSource,
} from "./x402-bridge";
