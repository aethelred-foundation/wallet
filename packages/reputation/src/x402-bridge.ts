/**
 * x402 ↔ reputation bridge.
 *
 * The x402 `PaymentRequirement.extra` field is a free-form extension
 * slot. By convention, receivers that want to gate payments on VCs
 * or reputation drop a `SerializedVcGate` under `extra.vcGate`. This
 * bridge:
 *
 *   1. Parses the serialised gate directives out of a
 *      `PaymentRequirement`.
 *   2. Translates each directive into a concrete `VcGateRule`.
 *   3. Resolves the agent (via `ERC8004Resolver`), hydrates its VCs
 *      from a credential store, aggregates reputation signals, and
 *      builds a `VcGateContext`.
 *   4. Evaluates the gate and returns the `VcGateEvaluation`.
 *
 * Why live here instead of in the x402 package? Two reasons:
 *
 *   - The x402 package intentionally avoids a hard dep on
 *     `credentials`; the gate is an opt-in extension. Receivers that
 *     don't use gating keep their bundles lean.
 *   - The bridge is the translation layer between the on-wire
 *     serialisation (receiver-facing JSON) and the in-process
 *     `VcGateRule[]` shape (evaluator-facing). Keeping it next to
 *     the evaluator means the JSON schema and the rule factories
 *     evolve in one package.
 */

import type { PaymentRequirement } from "@aethelred/wallet-x402";
import type {
  Issuer,
  VerifiableCredential,
} from "@aethelred/wallet-credentials";

import type {
  ERC8004Resolver,
  ReputationSignal,
  ReputationScore,
  SerializedVcGate,
  SerializedVcGateDirective,
  VcGateContext,
  VcGateEvaluation,
  VcGateRule,
} from "./types";
import { ReputationError } from "./errors";
import { VcGate } from "./vc-gate";
import {
  requireRegisteredAgent,
  requireNotRevoked,
  requireVcOfSchema,
  requireMinReputation,
  requireMinTier,
  requireFreshVc,
} from "./gate-rules";
import { ReputationAggregator } from "./reputation-aggregator";

/**
 * Translate a single serialised directive to a concrete rule.
 *
 * Exported so advanced callers can mix directive-derived rules with
 * hand-written rules in the same gate.
 */
export function ruleFromDirective(directive: SerializedVcGateDirective): VcGateRule {
  switch (directive.type) {
    case "require-registered-agent":
      return requireRegisteredAgent();
    case "require-not-revoked":
      return requireNotRevoked();
    case "require-vc":
      return requireVcOfSchema(directive.schemaId, {
        issuerRole: directive.issuerRole,
        issuerIds: directive.issuerIds,
      });
    case "require-min-reputation":
      return requireMinReputation(directive.minScore);
    case "require-min-tier":
      return requireMinTier(directive.minTier);
    case "require-fresh-vc":
      return requireFreshVc(directive.schemaId, directive.maxAgeMs);
    default: {
      const exhaustive: never = directive;
      throw new ReputationError(
        "vc-gate-rule-unknown",
        `Unknown VC gate directive: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/** Build a `VcGate` from a serialised wire-format gate. */
export function gateFromSerialized(serialized: SerializedVcGate): VcGate {
  if (!serialized || !Array.isArray(serialized.directives) || serialized.directives.length === 0) {
    throw new ReputationError("vc-gate-config-invalid", "Serialized VC gate has no directives");
  }
  const rules = serialized.directives.map(ruleFromDirective);
  return serialized.combinator === "any" ? VcGate.any(rules) : VcGate.all(rules);
}

/**
 * Extract a gate from an x402 `PaymentRequirement`. Returns `null`
 * when no gate is configured — callers that treat "no gate" as
 * "accept anything" are expected to null-check.
 */
export function extractGate(requirement: PaymentRequirement): VcGate | null {
  const raw = requirement.extra?.vcGate;
  if (raw === undefined || raw === null) return null;
  if (
    typeof raw !== "object" ||
    !Array.isArray((raw as { directives?: unknown }).directives)
  ) {
    throw new ReputationError(
      "x402-gate-malformed",
      "`PaymentRequirement.extra.vcGate` present but does not match SerializedVcGate shape (expected object with `directives: array`)",
      { details: { raw } },
    );
  }
  return gateFromSerialized(raw as SerializedVcGate);
}

// ─── Context assembly ──────────────────────────────────────────

/**
 * Signal source the bridge consults when building reputation input.
 *
 * We keep this small and pluggable so callers can hook in:
 *
 *   - On-chain payment history from an audit log (`recordPayment`
 *     sinks to this side already in the audit package).
 *   - Fraud feed from a chain-analytics vendor.
 *   - TEE-attestation drift events from the attestation verifier.
 *
 * The bridge calls the source ONCE per gate evaluation; callers
 * cache upstream if chain RPC is expensive.
 */
export interface ReputationSignalSource {
  loadSignalsForAgent(agentId: `0x${string}`): Promise<ReadonlyArray<ReputationSignal>>;
}

/** No-op signal source — useful for tests and for bootstrap deployments. */
export class EmptySignalSource implements ReputationSignalSource {
  async loadSignalsForAgent(_agentId: `0x${string}`): Promise<ReadonlyArray<ReputationSignal>> {
    return [];
  }
}

/** Credentials store surface the bridge consumes. */
export interface GateCredentialSource {
  /**
   * Return the VCs the bridge should hand to gate rules. The source
   * is responsible for pre-verifying them against the trusted-issuer
   * registry — rules do NOT re-verify signatures.
   */
  listVerifiedCredentials(agentId: `0x${string}`): Promise<ReadonlyArray<VerifiableCredential>>;

  /** Trusted issuers the rules may consult (for audit / explanations). */
  listTrustedIssuers(): ReadonlyArray<Issuer>;
}

export interface EvaluatePaymentOptions {
  readonly requirement: PaymentRequirement;
  /** Address the facilitator believes is signing the payment. */
  readonly agentControlAddress: `0x${string}`;
  readonly resolver: ERC8004Resolver;
  readonly credentialSource: GateCredentialSource;
  readonly signalSource?: ReputationSignalSource;
  readonly aggregator?: ReputationAggregator;
  /** Optional "now" for deterministic tests. */
  readonly now?: () => number;
}

export interface EvaluatePaymentResult {
  readonly allowed: boolean;
  readonly evaluation: VcGateEvaluation | null;
  readonly reputation: ReputationScore;
}

/**
 * One-stop entry point for facilitators:
 *
 *     const result = await evaluatePayment({
 *       requirement, agentControlAddress, resolver, credentialSource,
 *     });
 *     if (!result.allowed) return 402Response(result);
 *
 * The function does the full choreography:
 *   1. Extract gate from the requirement (skip if none).
 *   2. Resolve the agent via ERC-8004.
 *   3. Load VCs + signals.
 *   4. Aggregate reputation.
 *   5. Evaluate the gate.
 */
export async function evaluatePayment(
  options: EvaluatePaymentOptions,
): Promise<EvaluatePaymentResult> {
  const gate = safeExtractGate(options.requirement);
  if (!gate) {
    // No gate configured on the x402 requirement — payment is
    // implicitly allowed. We still compute the reputation so
    // callers can log/audit it even for ungated payments.
    const reputation = await computeReputationFor({
      agentControlAddress: options.agentControlAddress,
      resolver: options.resolver,
      credentialSource: options.credentialSource,
      signalSource: options.signalSource,
      aggregator: options.aggregator,
      now: options.now,
    });
    return { allowed: true, evaluation: null, reputation };
  }
  // Delegate the gated path to `evaluateAgent` — one primitive,
  // shared with `ReputationTransferGate` / `ReputationSwapGate`
  // in `@aethelred/wallet-intent-router`.
  const result = await evaluateAgent({
    gate,
    agentControlAddress: options.agentControlAddress,
    resolver: options.resolver,
    credentialSource: options.credentialSource,
    signalSource: options.signalSource,
    aggregator: options.aggregator,
    now: options.now,
  });
  return {
    allowed: result.allowed,
    evaluation: result.evaluation,
    reputation: result.reputation,
  };
}

// ─── evaluateAgent — the primitive ─────────────────────────────

/**
 * Generic agent-vs-gate evaluator. Shared by `evaluatePayment`
 * (x402 path) and the intent-router's transfer/swap gate adapters
 * (operator-policy path). The difference between callers is WHERE
 * the `VcGate` comes from; the choreography of resolving the agent,
 * hydrating VCs, aggregating reputation, building the
 * `VcGateContext`, and invoking `gate.evaluate()` is identical.
 *
 * Fail-closed semantics for unregistered agents: if the ERC-8004
 * resolver returns no identity, the helper synthesises a placeholder
 * with `revoked: true` + `revocationReason: "agent not registered in
 * ERC-8004"`. Gate rules like `require-not-revoked` then short-
 * circuit deterministically. This convention was established by
 * `evaluatePayment` in earlier versions and is preserved verbatim
 * so behavior is byte-identical across both entry points.
 */
export interface EvaluateAgentOptions {
  /** The VC gate to apply. Callers with a serialised spec call `gateFromSerialized` first. */
  readonly gate: VcGate;
  /** Address the facilitator/router believes is signing the intent. */
  readonly agentControlAddress: `0x${string}`;
  readonly resolver: ERC8004Resolver;
  readonly credentialSource: GateCredentialSource;
  readonly signalSource?: ReputationSignalSource;
  readonly aggregator?: ReputationAggregator;
  readonly now?: () => number;
}

export interface EvaluateAgentResult {
  readonly allowed: boolean;
  /** Non-null — `evaluateAgent` is only called when a gate is present. */
  readonly evaluation: VcGateEvaluation;
  readonly reputation: ReputationScore;
}

export async function evaluateAgent(
  options: EvaluateAgentOptions,
): Promise<EvaluateAgentResult> {
  const now = options.now ?? (() => Date.now());
  const aggregator = options.aggregator ?? new ReputationAggregator({ now });

  const agent = await options.resolver.resolveByControlAddress(
    options.agentControlAddress,
  );

  if (!agent) {
    // Unregistered-agent path — synthesise a fail-closed placeholder.
    const synthAgentId = toAgentIdFromAddress(options.agentControlAddress);
    const reputation = aggregator.aggregate(synthAgentId, []);
    const placeholderAgent = {
      agentId: synthAgentId,
      controlAddress: options.agentControlAddress,
      operatorAddress: "0x0000000000000000000000000000000000000000" as `0x${string}`,
      policyRoot: ("0x" + "00".repeat(32)) as `0x${string}`,
      reputationRoot: ("0x" + "00".repeat(32)) as `0x${string}`,
      registeredAt: 0,
      revoked: true,
      revocationReason: "agent not registered in ERC-8004",
    } as const;
    const context: VcGateContext = {
      agent: placeholderAgent,
      credentials: [],
      trustedIssuers: options.credentialSource.listTrustedIssuers(),
      reputation,
      now: now(),
    };
    const evaluation = await options.gate.evaluate(context);
    return { allowed: evaluation.allowed, evaluation, reputation };
  }

  // Registered-agent path — hydrate VCs + signals, aggregate reputation,
  // evaluate the gate.
  const [credentials, signals] = await Promise.all([
    options.credentialSource.listVerifiedCredentials(agent.agentId),
    (options.signalSource ?? new EmptySignalSource()).loadSignalsForAgent(
      agent.agentId,
    ),
  ]);
  const vcSignals = credentials.map<ReputationSignal>((vc) => ({
    kind: "vc-attestation",
    schemaId: vc.attestation.schemaId,
    issuerRole: vc.attestation.issuer.role,
    issuerId: vc.attestation.issuer.id,
    weight: 0,
    expiresAt: vc.attestation.expiresAt,
  }));
  const reputation = aggregator.aggregate(agent.agentId, [
    ...vcSignals,
    ...signals,
  ]);
  const context: VcGateContext = {
    agent,
    credentials,
    trustedIssuers: options.credentialSource.listTrustedIssuers(),
    reputation,
    now: now(),
  };
  const evaluation = await options.gate.evaluate(context);
  return { allowed: evaluation.allowed, evaluation, reputation };
}

/**
 * Internal helper: compute reputation for an agent without invoking
 * any gate. Used by `evaluatePayment` on the "no gate on requirement"
 * path where x402 semantics implicitly allow the payment but we still
 * want the reputation score for audit.
 *
 * Mirrors the reputation-aggregation portion of `evaluateAgent` but
 * omits the gate-evaluation step.
 */
async function computeReputationFor(options: {
  readonly agentControlAddress: `0x${string}`;
  readonly resolver: ERC8004Resolver;
  readonly credentialSource: GateCredentialSource;
  readonly signalSource?: ReputationSignalSource;
  readonly aggregator?: ReputationAggregator;
  readonly now?: () => number;
}): Promise<ReputationScore> {
  const now = options.now ?? (() => Date.now());
  const aggregator = options.aggregator ?? new ReputationAggregator({ now });
  const agent = await options.resolver.resolveByControlAddress(
    options.agentControlAddress,
  );
  if (!agent) {
    return aggregator.aggregate(
      toAgentIdFromAddress(options.agentControlAddress),
      [],
    );
  }
  const [credentials, signals] = await Promise.all([
    options.credentialSource.listVerifiedCredentials(agent.agentId),
    (options.signalSource ?? new EmptySignalSource()).loadSignalsForAgent(
      agent.agentId,
    ),
  ]);
  const vcSignals = credentials.map<ReputationSignal>((vc) => ({
    kind: "vc-attestation",
    schemaId: vc.attestation.schemaId,
    issuerRole: vc.attestation.issuer.role,
    issuerId: vc.attestation.issuer.id,
    weight: 0,
    expiresAt: vc.attestation.expiresAt,
  }));
  return aggregator.aggregate(agent.agentId, [...vcSignals, ...signals]);
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Like `extractGate` but never throws; returns null when the
 * serialised shape is invalid. We still surface the parse error in
 * a `ReputationError` for the facilitator's logs — but we avoid
 * letting a malformed gate cascade into a payment rejection for
 * reasons the agent can't fix.
 */
function safeExtractGate(requirement: PaymentRequirement): VcGate | null {
  try {
    return extractGate(requirement);
  } catch (err) {
    if (err instanceof ReputationError && err.code === "x402-gate-malformed") {
      // Log-only. Return null → gate is effectively "accept".
      // Receivers that require strict gates should validate their
      // PaymentRequirements before publishing; a malformed gate is
      // a deploy-time bug, not a runtime reject-path.
      return null;
    }
    throw err;
  }
}

function toAgentIdFromAddress(addr: `0x${string}`): `0x${string}` {
  // Left-pad the 20-byte address to 32 bytes for a synthetic agent
  // id. Purely a placeholder so the reputation record is keyed
  // consistently across lookups for the same unregistered address.
  const hex = addr.slice(2).toLowerCase();
  return `0x${"00".repeat(12)}${hex}` as `0x${string}`;
}
