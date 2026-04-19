package xyz.aethelred.wallet.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import xyz.aethelred.wallet.core.services.WorkflowService
import xyz.aethelred.wallet.ui.components.RiskLevel
import xyz.aethelred.wallet.ui.screens.PendingApprovalUi
import javax.inject.Inject

/**
 * Feeds [xyz.aethelred.wallet.ui.screens.ApprovalsListScreen] from the
 * in-memory [WorkflowService]. A later iteration backs this via Room.
 */
@HiltViewModel
public class ApprovalsViewModel @Inject constructor(
    private val workflowService: WorkflowService,
) : ViewModel() {

    /** UI state holder. */
    public data class UiState(
        public val approvals: List<PendingApprovalUi> = emptyList(),
    )

    private val _state = MutableStateFlow(UiState())
    public val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            workflowService.workflows.collect { workflows ->
                _state.update {
                    it.copy(
                        approvals = workflows.map { wf ->
                            val approved = wf.responses.count { r -> r.approved }
                            PendingApprovalUi(
                                id = wf.id,
                                originator = wf.originator,
                                summary = wf.intentSummary,
                                quorumApproved = approved,
                                quorumRequired = wf.quorumPolicy.approversRequired,
                                riskLevel = deriveRisk(wf.quorumPolicy.approversRequired),
                            )
                        },
                    )
                }
            }
        }
    }

    /** Forward an approver's response to the service. */
    public fun respond(workflowId: String, approverId: String, approved: Boolean) {
        viewModelScope.launch {
            workflowService.respond(workflowId, approverId, approved)
        }
    }

    private fun deriveRisk(required: Int): RiskLevel = when {
        required >= 3 -> RiskLevel.High
        required == 2 -> RiskLevel.Medium
        else -> RiskLevel.Low
    }
}
