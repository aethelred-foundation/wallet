/**
 * `ReputationPaymentGate` — adapter that satisfies the router's
 * `PaymentGate` contract by calling the reputation package's
 * `evaluatePayment` under the hood.
 *
 * Use this when your router executes `payment` intents and you want
 * them gated by the same receiver-declared VC policies the x402
 * facilitator uses. The adapter bridges the shapes: it projects a
 * `PaymentIntent` to a minimal `PaymentRequirement` the reputation
 * bridge can evaluate.
 *
 * Callers that don't use VC gates simply don't pass a `paymentGate`
 * to the router — no coupling, no cost.
 */

import type { PaymentRequirement } from "@aethelred/wallet-x402";
import {
  evaluatePayment,
  type ERC8004Resolver,
  type GateCredentialSource,
  type ReputationAggregator,
  type ReputationSignalSource,
} from "@aethelred/wallet-reputation";

import type { Intent } from "./types";
import type { PaymentGate, PaymentGateResult } from "./router";
import { IntentRouterError } from "./errors";

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
    // The gate doesn't branch on network; any placeholder works.
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
