package xyz.aethelred.wallet.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import xyz.aethelred.wallet.core.audit.AuditCapture
import xyz.aethelred.wallet.core.audit.AuditEventKind
import xyz.aethelred.wallet.core.policy.PolicyEngine
import xyz.aethelred.wallet.ui.components.RiskLevel
import javax.inject.Inject

/**
 * View-model backing [xyz.aethelred.wallet.ui.screens.ApprovalScreen].
 *
 * On construction it feeds a pretend intent into the local [PolicyEngine]
 * and surfaces the verdict + risk badge. In production the intent is
 * supplied by the connect layer / WalletConnect bridge via a saved-state
 * handle; the scaffold keeps everything in-memory for now.
 */
@HiltViewModel
public class ApprovalViewModel @Inject constructor(
    private val policyEngine: PolicyEngine,
    private val auditCapture: AuditCapture,
) : ViewModel() {

    /**
     * UI snapshot for the approval sheet.
     *
     * @property originator Human-readable app / agent name that issued
     *                      the request.
     * @property intentSummary One-line description of what the signing
     *                         request would do.
     * @property policyAllowed The verdict from [PolicyEngine].
     * @property policyReasons Bullet reasons behind the verdict, shown
     *                         under the summary.
     * @property riskLevel Severity badge rendered in the top-right corner.
     */
    public data class UiState(
        public val originator: String,
        public val intentSummary: String,
        public val policyAllowed: Boolean,
        public val policyReasons: List<String>,
        public val riskLevel: RiskLevel,
    )

    private val _state: MutableStateFlow<UiState> = MutableStateFlow(evaluateSeed())
    public val state: StateFlow<UiState> = _state.asStateFlow()

    /** User hit Approve. Emits an audit event; downstream signer picks up. */
    public fun approve() {
        viewModelScope.launch {
            auditCapture.record(
                kind = AuditEventKind.APPROVAL_DECIDED,
                detail = mapOf("decision" to "approve"),
            )
        }
    }

    /** User hit Reject. Emits an audit event so the denial is auditable too. */
    public fun reject() {
        viewModelScope.launch {
            auditCapture.record(
                kind = AuditEventKind.APPROVAL_DECIDED,
                detail = mapOf("decision" to "reject"),
            )
        }
    }

    private fun evaluateSeed(): UiState {
        val verdict = policyEngine.evaluate(
            originator = "demo.app",
            intent = "eth_sendTransaction",
            amount = 0.05,
        )
        return UiState(
            originator = "demo.app",
            intentSummary = "Transfer 0.05 ETH on Ethereum Mainnet",
            policyAllowed = verdict.allowed,
            policyReasons = verdict.reasons,
            riskLevel = verdict.riskLevel,
        )
    }
}
