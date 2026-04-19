package xyz.aethelred.wallet.core.policy

import xyz.aethelred.wallet.ui.components.RiskLevel
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Policy verdict returned by [PolicyEngine.evaluate].
 *
 * @property allowed Whether the signing request passes policy.
 * @property reasons Human-readable bullet list shown in the Approval UI.
 * @property riskLevel Severity badge shown alongside the verdict.
 */
public data class PolicyVerdict(
    public val allowed: Boolean,
    public val reasons: List<String>,
    public val riskLevel: RiskLevel,
)

/**
 * Stub policy engine that mirrors the semantics of
 * `packages/policy/src/engine.ts`. The mobile wallet ships with this
 * conservative rule-set as a backstop — the full rule evaluator runs in
 * the control-plane, and this class will eventually make an authenticated
 * call out to that service. Until then the following heuristics are
 * enforced locally:
 *
 *  * `eth_sendTransaction` over 10 ETH → deny + high risk.
 *  * `eth_sign` / `personal_sign` → medium risk (user must confirm).
 *  * All other methods → low risk, allowed.
 */
@Singleton
public class PolicyEngine @Inject constructor() {

    /**
     * Convenience that builds a [PolicyContext] from simple arguments.
     * Used by [xyz.aethelred.wallet.viewmodel.ApprovalViewModel] in the
     * scaffold; production callers construct a full context themselves.
     */
    public fun evaluate(originator: String, intent: String, amount: Double?): PolicyVerdict {
        val ctx = PolicyContext(
            originator = originator,
            intent = intent,
            amountUsd = amount,
            chainId = 1,
            timestampMs = System.currentTimeMillis(),
        )
        return evaluate(ctx)
    }

    /** Full-context evaluator. */
    public fun evaluate(context: PolicyContext): PolicyVerdict {
        val reasons = mutableListOf<String>()

        // High-value transaction backstop.
        val amount = context.amountUsd
        if (context.intent == "eth_sendTransaction" && amount != null && amount >= HIGH_VALUE_USD) {
            reasons += "Amount exceeds mobile-wallet auto-approval ceiling."
            return PolicyVerdict(
                allowed = false,
                reasons = reasons,
                riskLevel = RiskLevel.High,
            )
        }

        // Raw-message signing ramps up risk so the user sees a warning.
        if (context.intent == "eth_sign" || context.intent == "personal_sign") {
            reasons += "Raw message signing is treated as elevated-risk."
            return PolicyVerdict(
                allowed = true,
                reasons = reasons,
                riskLevel = RiskLevel.Medium,
            )
        }

        reasons += "No policy rule blocks this request."
        return PolicyVerdict(
            allowed = true,
            reasons = reasons,
            riskLevel = RiskLevel.Low,
        )
    }

    private companion object {
        private const val HIGH_VALUE_USD = 10_000.0
    }
}
