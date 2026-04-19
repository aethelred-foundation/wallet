package xyz.aethelred.wallet.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import xyz.aethelred.wallet.core.services.AuditService
import xyz.aethelred.wallet.core.audit.AuditEventKind
import javax.inject.Inject

/** ViewModel backing the onboarding flow. */
@HiltViewModel
public class OnboardingViewModel @Inject constructor(
    private val auditService: AuditService,
) : ViewModel() {

    /** UI state. */
    public data class UiState(
        public val acceptedTerms: Boolean = false,
        public val seedGenerated: Boolean = false,
        public val verified: Boolean = false,
        public val passkeyEnrolled: Boolean = false,
    )

    private val _state = MutableStateFlow(UiState())
    public val state: StateFlow<UiState> = _state.asStateFlow()

    /** Mark the user as having accepted the terms. */
    public fun acceptTerms() {
        _state.update { it.copy(acceptedTerms = true) }
    }

    /** Mark the seed as generated and emit an audit event. */
    public fun markSeedGenerated() {
        _state.update { it.copy(seedGenerated = true) }
        viewModelScope.launch {
            auditService.record(AuditEventKind.KEY_GENERATED)
        }
    }

    /** Mark verification as complete. */
    public fun markVerified() {
        _state.update { it.copy(verified = true) }
    }

    /** Mark the passkey as enrolled. */
    public fun markPasskeyEnrolled() {
        _state.update { it.copy(passkeyEnrolled = true) }
        viewModelScope.launch {
            auditService.record(AuditEventKind.CREDENTIAL_ENROLLED)
        }
    }
}
