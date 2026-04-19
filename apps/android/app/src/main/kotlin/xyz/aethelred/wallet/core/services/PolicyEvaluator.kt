package xyz.aethelred.wallet.core.services

import xyz.aethelred.wallet.core.policy.PolicyContext
import xyz.aethelred.wallet.core.policy.PolicyEngine
import xyz.aethelred.wallet.core.policy.PolicyVerdict
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Context object passed to the UI from the signing origin (WalletConnect
 * session, DeepLink, local Send), so the evaluator can build a
 * [PolicyContext] without the UI reaching into every field manually.
 */
public data class SigningRequestContext(
    public val originator: String,
    public val intent: String,
    public val chainId: Long,
    public val amountUsd: Double?,
    public val toAddress: String? = null,
    public val data: String? = null,
)

/**
 * Policy service facade.
 *
 * Wraps the local [PolicyEngine] with a [SigningRequestContext] builder
 * so screens can hand over a single typed request instead of a half-dozen
 * primitive arguments. The control-plane's remote evaluator is expected
 * to slot in here once the base URL lands in BuildConfig.
 */
@Singleton
public class PolicyEvaluator @Inject constructor(
    private val engine: PolicyEngine,
) {

    /**
     * Evaluate [request]. Returns a [PolicyVerdict]; callers render the
     * verdict via [xyz.aethelred.wallet.ui.components.RiskBadge].
     */
    public fun evaluate(request: SigningRequestContext): PolicyVerdict {
        val context = PolicyContext(
            originator = request.originator,
            intent = request.intent,
            amountUsd = request.amountUsd,
            chainId = request.chainId,
            timestampMs = System.currentTimeMillis(),
        )
        return engine.evaluate(context)
    }

    /**
     * Quick helper for deny-or-allow booleans in list views that don't
     * have room for the full verdict block.
     */
    public fun isAllowed(request: SigningRequestContext): Boolean =
        evaluate(request).allowed
}
