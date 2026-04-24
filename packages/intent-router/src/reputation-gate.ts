/**
 * Reputation-backed `PaymentGate` adapters — one per intent kind.
 *
 * All three gates satisfy the router's `PaymentGate` contract by
 * calling the reputation package's machinery under the hood. The
 * difference between them is **where the VC gate spec comes from**:
 *
 *   - `ReputationPaymentGate` — spec rides on
 *     `intent.body.extra.vcGate` (counterparty-declared; the
 *     merchant's policy embedded in the x402 PaymentRequirement).
 *
 *   - `ReputationTransferGate` — spec comes from GATE CONFIG
 *     (operator-declared; the wallet owner's "which agents can
 *     transfer at all" policy).
 *
 *   - `ReputationSwapGate` — spec comes from GATE CONFIG
 *     (operator-declared; the wallet owner's "which agents can
 *     execute swaps at all" policy).
 *
 * The payment variant uses counterparty policy because x402's whole
 * premise is receiver-declared access control. Transfer and swap
 * have no counterparty policy channel — they're sovereign-wallet
 * operations — so the gate's spec is config-time.
 *
 * Callers that don't need VC gating on transfer/swap simply don't
 * instantiate these. The router accepts a single `paymentGate`;
 * dispatch across multiple gates (one per intent kind) requires
 * composing them yourself, which we punt to
 * `composeGatesByIntentKind` below — a 10-line helper that keeps
 * multiple gate instances behind the router's single-gate contract.
 */

import type { PaymentRequirement } from "@aethelred/wallet-x402";
import {
  evaluatePayment,
  gateFromSerialized,
  ReputationAggregator,
  VcGate,
  type ERC8004Resolver,
  type GateCredentialSource,
  type ReputationSignal,
  type ReputationSignalSource,
  type SerializedVcGate,
  type VcGateContext,
  type VcGateEvaluation,
} from "@aethelred/wallet-reputation";

import type { Intent, IntentKind } from "./types";
import type { PaymentGate, PaymentGateResult } from "./router";
import { IntentRouterError } from "./errors";

// ─── Payment gate (existing) ───────────────────────────────────

export interface ReputationPaymentGateConfig {
  readonly resolver: ERC8004Resolver;
  readonly credentialSource: GateCredentialSource;
  readonly signalSource?: ReputationSignalSource;
  readonly aggregator?: ReputationAggregator;
  /** Optional clock override (passed through to evaluatePayment). */
  readonly now?: () => number;
}

export class ReputationPaymentGate implements PaymentGate {
  constructor(private readonly config: ReputationPaymentGateConfig) {}

  async evaluate(intent: Intent): Promise<PaymentGateResult> {
    if (intent.body.kind !== "payment") {
      throw new IntentRouterError(
        "intent-unsupported-kind",
        `ReputationPaymentGate only supports payment intents, got "${intent.body.kind}"`,
      );
    }
    const requirement = projectToRequirement(intent);
    const result = await evaluatePayment({
      requirement,
      agentControlAddress: intent.envelope.creator,
      resolver: this.config.resolver,
      credentialSource: this.config.credentialSource,
      signalSource: this.config.signalSource,
      aggregator: this.config.aggregator,
      now: this.config.now,
    });
    return {
      allowed: result.allowed,
      failedRuleIds: result.evaluation?.failedRuleIds,
      evaluation: result.evaluation,
    };
  }
}

// ─── Config-time gate config (shared by transfer + swap) ───────

/**
 * Shared config shape for operator-policy gates. The `gate` is a
 * serialised VC policy the operator declares once at construction;
 * every intent of the relevant kind is evaluated against it.
 */
export interface ReputationOperatorGateConfig {
  /**
   * The operator's wallet-level policy. Same wire format as the
   * merchant-declared gate in payment intents, but lives in config
   * instead of the intent body.
   */
  readonly gate: SerializedVcGate;
  readonly resolver: ERC8004Resolver;
  readonly credentialSource: GateCredentialSource;
  readonly signalSource?: ReputationSignalSource;
  readonly aggregator?: ReputationAggregator;
  readonly now?: () => number;
}

// Aliases for readability — same shape, different semantic name
// at the call site.
export type ReputationTransferGateConfig = ReputationOperatorGateConfig;
export type ReputationSwapGateConfig = ReputationOperatorGateConfig;

// ─── Transfer gate ─────────────────────────────────────────────

export class ReputationTransferGate implements PaymentGate {
  constructor(private readonly config: ReputationTransferGateConfig) {}

  async evaluate(intent: Intent): Promise<PaymentGateResult> {
    if (intent.body.kind !== "transfer") {
      throw new IntentRouterError(
        "intent-unsupported-kind",
        `ReputationTransferGate only supports transfer intents, got "${intent.body.kind}"`,
      );
    }
    return evaluateAgentAgainstConfiguredGate({
      agentControlAddress: intent.envelope.creator,
      config: this.config,
    });
  }
}

// ─── Swap gate ─────────────────────────────────────────────────

export class ReputationSwapGate implements PaymentGate {
  constructor(private readonly config: ReputationSwapGateConfig) {}

  async evaluate(intent: Intent): Promise<PaymentGateResult> {
    if (intent.body.kind !== "swap") {
      throw new IntentRouterError(
        "intent-unsupported-kind",
        `ReputationSwapGate only supports swap intents, got "${intent.body.kind}"`,
      );
    }
    return evaluateAgentAgainstConfiguredGate({
      agentControlAddress: intent.envelope.creator,
      config: this.config,
    });
  }
}

// ─── Dispatch helper: one gate per intent kind ─────────────────

/**
 * Compose per-kind gates behind the router's single `paymentGate`
 * slot. Dispatch happens by `intent.body.kind`. Intent kinds without
 * a registered gate default to `allowed: true` (no-op pass-through).
 *
 * Lets operators wire, e.g.:
 *
 * ```ts
 * const paymentGate = composeGatesByIntentKind({
 *   payment: new ReputationPaymentGate({ ... }),
 *   transfer: new ReputationTransferGate({ ... }),
 *   swap: new ReputationSwapGate({ ... }),
 * });
 * new IntentRouter({ registry, paymentGate });
 * ```
 *
 * A single gate can cover all three kinds this way without the
 * router itself growing a kind-indexed gate map.
 */
export function composeGatesByIntentKind(
  gates: Partial<Record<IntentKind, PaymentGate>>,
): PaymentGate {
  return {
    async evaluate(intent: Intent): Promise<PaymentGateResult> {
      const gate = gates[intent.body.kind];
      if (!gate) {
        return { allowed: true, evaluation: null };
      }
      return gate.evaluate(intent);
    },
  };
}

// ─── Internals ─────────────────────────────────────────────────

/**
 * Shared choreography: resolve agent → load VCs + signals →
 * aggregate reputation → build context → evaluate the configured
 * gate. Factored out of the transfer/swap gates so both apply the
 * same fail-closed semantics the reputation bridge uses for
 * unregistered agents.
 *
 * Kept in this package (not reputation) because it consumes the
 * intent-router's PaymentGateResult shape and because the
 * reputation package already exports a narrower
 * requirement-specific `evaluatePayment`. Factoring a unified
 * `evaluateAgent` into reputation is a follow-up refactor we
 * explicitly defer to keep this PR narrow.
 */
async function evaluateAgentAgainstConfiguredGate(params: {
  readonly agentControlAddress: `0x${string}`;
  readonly config: ReputationOperatorGateConfig;
}): Promise<PaymentGateResult> {
  const { agentControlAddress, config } = params;
  const now = config.now ?? (() => Date.now());
  const aggregator = config.aggregator ?? new ReputationAggregator({ now });

  const gate: VcGate = gateFromSerialized(config.gate);
  const agent = await config.resolver.resolveByControlAddress(agentControlAddress);

  // Fail-closed path: no ERC-8004 registration → synthesise a
  // revoked placeholder so gate rules like `require-registered-
  // agent` short-circuit deterministically, matching
  // evaluatePayment's unregistered-agent semantics.
  if (!agent) {
    const synthAgentId = toAgentIdFromAddress(agentControlAddress);
    const reputation = aggregator.aggregate(synthAgentId, []);
    const placeholderAgent = {
      agentId: synthAgentId,
      controlAddress: agentControlAddress,
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
      trustedIssuers: config.credentialSource.listTrustedIssuers(),
      reputation,
      now: now(),
    };
    const evaluation = await gate.evaluate(context);
    return {
      allowed: evaluation.allowed,
      failedRuleIds: evaluation.failedRuleIds,
      evaluation,
    };
  }

  // Registered-agent path: load VCs + external signals, auto-add
  // VC-attestation signals, aggregate reputation, build context,
  // evaluate. Mirrors evaluatePayment's fast path.
  const [credentials, signals] = await Promise.all([
    config.credentialSource.listVerifiedCredentials(agent.agentId),
    (
      config.signalSource ?? { async loadSignalsForAgent() { return []; } }
    ).loadSignalsForAgent(agent.agentId),
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
    trustedIssuers: config.credentialSource.listTrustedIssuers(),
    reputation,
    now: now(),
  };
  const evaluation: VcGateEvaluation = await gate.evaluate(context);
  return {
    allowed: evaluation.allowed,
    failedRuleIds: evaluation.failedRuleIds,
    evaluation,
  };
}

/**
 * Synth agent id for unregistered addresses: left-pad the 20-byte
 * control address to 32 bytes. Same convention evaluatePayment
 * uses, so audit pipelines see consistent ids across all three
 * gates' unregistered-agent evaluations.
 */
function toAgentIdFromAddress(address: `0x${string}`): `0x${string}` {
  const hex = address.slice(2).toLowerCase();
  return ("0x" + "00".repeat(12) + hex) as `0x${string}`;
}

/**
 * Project a `PaymentIntent` to the x402 `PaymentRequirement` shape.
 * The reputation bridge inspects only the fields relevant to its
 * evaluation (extra.vcGate, resource, asset) so we stub the rest.
 */
function projectToRequirement(intent: Intent): PaymentRequirement {
  if (intent.body.kind !== "payment") {
    throw new IntentRouterError(
      "intent-unsupported-kind",
      `projectToRequirement requires a payment intent`,
    );
  }
  return {
    scheme: "exact",
    network: "base-mainnet",
    maxAmountRequired: intent.body.maxAmount,
    resource: intent.body.resource,
    description: intent.body.description ?? "",
    payTo: intent.body.merchant,
    maxTimeoutSeconds: Math.max(
      1,
      Math.floor((intent.envelope.deadline - Date.now()) / 1000),
    ),
    asset: intent.body.asset,
    extra: intent.body.extra,
  } as PaymentRequirement;
}
