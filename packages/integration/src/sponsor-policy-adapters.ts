/**
 * Sponsor-policy composition adapters.
 *
 * The paymaster-sponsor evaluates a `SponsorPolicy` before signing
 * approval. These adapters let operators compose policy from the
 * reputation + agent-budget packages without bespoke glue:
 *
 *   - `ReputationSponsorPolicy` — wraps a `VcGate` and evaluates it
 *     against the requesting agent's reputation/credentials.
 *     Denies sponsorship when the gate denies.
 *
 *   - `BudgetSponsorPolicy` — runs `BudgetClient.canSpend` for the
 *     sponsor-computed USDC amount. Denies when the agent's on-chain
 *     budget wouldn't cover the spend. This is the sponsor-side
 *     defense against an agent sponsoring more than its budget
 *     permits on-chain.
 *
 * Both compose into `CompositeSponsorPolicy` alongside the built-in
 * rate-limit, blocklist, and kill-switch policies shipped in the
 * paymaster-sponsor package.
 */

import type { BudgetClient } from "@aethelred/wallet-agent-budget";
import type {
  PolicyContext,
  PolicyResult,
  SponsorPolicy,
} from "@aethelred/wallet-paymaster-sponsor";
import type {
  ERC8004Resolver,
  GateCredentialSource,
  ReputationAggregator,
  VcGate,
} from "@aethelred/wallet-reputation";

// ─── ReputationSponsorPolicy ─────────────────────────────

export interface ReputationSponsorPolicyConfig {
  readonly gate: VcGate;
  readonly resolver: ERC8004Resolver;
  readonly credentials: GateCredentialSource;
  readonly aggregator: ReputationAggregator;
  /** Clock override for deterministic testing. */
  readonly now?: () => number;
}

/**
 * Sponsor denies approval when the agent can't satisfy the receiver's
 * VC gate. Note this is the SPONSOR's gate, not the merchant's —
 * operators typically require KYC / not-revoked / minimum-reputation
 * before spending USDC on behalf of any agent.
 */
export class ReputationSponsorPolicy implements SponsorPolicy {
  readonly id = "reputation-gate";

  constructor(private readonly config: ReputationSponsorPolicyConfig) {}

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    const now = this.config.now ? this.config.now() : ctx.now;
    const agent = await this.config.resolver.resolveByControlAddress(
      ctx.request.agentId,
    );
    if (!agent) {
      return {
        allowed: false,
        reasonCode: "policy-denied",
        reason: `agent ${ctx.request.agentId} not registered in ERC-8004`,
        details: { deniedBy: this.id, cause: "unregistered" },
      };
    }
    const credentials = await this.config.credentials.listVerifiedCredentials(
      agent.agentId,
    );
    const reputation = this.config.aggregator.aggregate(agent.agentId, []);
    const evaluation = await this.config.gate.evaluate({
      agent,
      credentials,
      trustedIssuers: this.config.credentials.listTrustedIssuers(),
      reputation,
      now,
    });
    if (evaluation.allowed) return { allowed: true };
    return {
      allowed: false,
      reasonCode: "policy-denied",
      reason: `reputation gate denied: ${evaluation.failedRuleIds.join(", ")}`,
      details: {
        deniedBy: this.id,
        failedRuleIds: [...evaluation.failedRuleIds],
      },
    };
  }
}

// ─── BudgetSponsorPolicy ─────────────────────────────────

export interface BudgetSponsorPolicyConfig {
  readonly budgetClient: BudgetClient;
  /**
   * Resolve the session key to check against. Default: the
   * request's agentId (which is typically the smart-account /
   * session-key address).
   */
  readonly sessionKeyFor?: (agentId: `0x${string}`) => `0x${string}`;
}

/**
 * Sponsor denies when the agent's on-chain AgentBudget wouldn't
 * permit the computed USDC spend. Prevents an agent from using the
 * sponsor to circumvent its own on-chain spending cap — the
 * sponsor side-channel has to honour the same budget.
 */
export class BudgetSponsorPolicy implements SponsorPolicy {
  readonly id = "agent-budget";
  private readonly sessionKeyFor: (agentId: `0x${string}`) => `0x${string}`;

  constructor(private readonly config: BudgetSponsorPolicyConfig) {
    this.sessionKeyFor = config.sessionKeyFor ?? ((id) => id);
  }

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    const sessionKey = this.sessionKeyFor(ctx.request.agentId);
    const result = await this.config.budgetClient.canSpend(
      sessionKey,
      ctx.computedUsdcCost,
    );
    if (result.ok) return { allowed: true };
    return {
      allowed: false,
      reasonCode: "policy-denied",
      reason: `agent budget rejected sponsored spend: ${result.reason}`,
      details: { deniedBy: this.id, budgetReason: result.reason },
    };
  }
}
