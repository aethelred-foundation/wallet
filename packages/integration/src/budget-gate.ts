/**
 * `AgentBudgetGate` — thin adapter that exposes the on-chain
 * `AgentBudget.canSpend` predicate as an intent-router `PaymentGate`.
 *
 * Why this bridge exists: intent-router and agent-budget were designed
 * with the same contract shape (async policy evaluator returning
 * `{ allowed, failedRuleIds, evaluation }`) but different native
 * types. Rather than force one package to take a hard dep on the
 * other, the adapter lives here — every downstream consumer that
 * wants budget-gated payment intents composes this one import.
 *
 * Composition behaviour:
 *
 *   - Only evaluates for `payment` intents (transfer / swap are
 *     passed through — budget enforcement lives in the spend tx,
 *     not the intent routing).
 *   - Resolves the session key address from the intent's creator.
 *     Callers use either the smart-account owner address OR a
 *     separately-granted session key — the gate asks the budget
 *     contract whichever the creator is.
 *   - Treats on-chain `canSpend` denial as a gate rejection with the
 *     reason code mapped through to `failedRuleIds` so intent-router's
 *     audit trail carries the exact on-chain cause.
 */

import type { BudgetClient } from "@aethelred/wallet-agent-budget";
import type {
  Intent,
  PaymentGate,
  PaymentGateResult,
} from "@aethelred/wallet-intent-router";

export interface AgentBudgetGateConfig {
  readonly budgetClient: BudgetClient;
  /**
   * Derive the session key address from the intent. Default:
   * `intent.envelope.creator`. Advanced callers override if they
   * separate the session key from the intent's creator (e.g. a
   * smart-account owner signing on behalf of a scoped session key).
   */
  readonly sessionKeyFor?: (intent: Intent) => `0x${string}`;
  /**
   * Derive the amount-to-spend from the intent. Default: the
   * `maxAmount` of a payment intent. Callers who want to enforce a
   * tighter-than-max preflight (e.g. against the solver's expected
   * quote) override.
   */
  readonly amountFor?: (intent: Intent) => bigint;
}

export class AgentBudgetGate implements PaymentGate {
  private readonly budgetClient: BudgetClient;
  private readonly sessionKeyFor: (intent: Intent) => `0x${string}`;
  private readonly amountFor: (intent: Intent) => bigint;

  constructor(config: AgentBudgetGateConfig) {
    this.budgetClient = config.budgetClient;
    this.sessionKeyFor = config.sessionKeyFor ?? ((intent) => intent.envelope.creator);
    this.amountFor =
      config.amountFor ??
      ((intent) => {
        if (intent.body.kind !== "payment") {
          throw new Error(
            `AgentBudgetGate.amountFor called on non-payment intent (${intent.body.kind})`,
          );
        }
        return BigInt(intent.body.maxAmount);
      });
  }

  async evaluate(intent: Intent): Promise<PaymentGateResult> {
    // Non-payment intents pass through — budget enforcement for
    // transfer/swap happens in the spend transaction itself.
    if (intent.body.kind !== "payment") {
      return { allowed: true, evaluation: null };
    }
    const sessionKey = this.sessionKeyFor(intent);
    const amount = this.amountFor(intent);
    const result = await this.budgetClient.canSpend(sessionKey, amount);
    if (result.ok) return { allowed: true, evaluation: null };
    return {
      allowed: false,
      failedRuleIds: [`agent-budget:${result.reason}`],
      evaluation: null,
    };
  }
}
