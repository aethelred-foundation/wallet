package xyz.aethelred.wallet.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import xyz.aethelred.wallet.core.network.NetworkRegistry
import javax.inject.Inject

/**
 * Lightweight form state for the Send screen.
 *
 * @property recipient Raw input (hex address or ENS). Validated on submit.
 * @property amount    Raw input; parsing happens when the user taps Review.
 * @property networkName Display-name of the currently-selected chain.
 * @property gasEstimateFormatted Human-readable fee preview (e.g. "0.00021 ETH").
 * @property canReview `true` once recipient + amount are both non-blank.
 * @property error Pre-submit validation message; cleared on every edit.
 */
public data class SendUiState(
    public val recipient: String = "",
    public val amount: String = "",
    public val networkName: String = "",
    public val gasEstimateFormatted: String = "—",
    public val canReview: Boolean = false,
    public val error: String? = null,
)

/**
 * ViewModel for [xyz.aethelred.wallet.ui.screens.SendScreen].
 */
@HiltViewModel
public class SendViewModel @Inject constructor(
    networkRegistry: NetworkRegistry,
) : ViewModel() {

    private val _state = MutableStateFlow(
        SendUiState(networkName = networkRegistry.defaultNetwork.name),
    )
    public val state: StateFlow<SendUiState> = _state.asStateFlow()

    public fun onRecipientChange(value: String) {
        _state.update { it.copy(recipient = value, error = null, canReview = recomputeCanReview(value, it.amount)) }
    }

    public fun onAmountChange(value: String) {
        _state.update { it.copy(amount = value, error = null, canReview = recomputeCanReview(it.recipient, value)) }
    }

    public fun review() {
        val current = _state.value
        val recipient = current.recipient.trim()
        if (!recipient.startsWith("0x") || recipient.length != HEX_ADDR_LENGTH) {
            _state.update { it.copy(error = "Recipient must be a 0x hex address.") }
            return
        }

        val amount = current.amount.toDoubleOrNull()
        if (amount == null || amount <= 0.0) {
            _state.update { it.copy(error = "Amount must be greater than zero.") }
            return
        }

        viewModelScope.launch {
            // Placeholder — real implementation chains into gas oracle +
            // nonce manager + signer. Keeping the call-site here so the
            // Android product team knows where the integration hooks live.
            _state.update { it.copy(gasEstimateFormatted = "~0.00021") }
        }
    }

    private fun recomputeCanReview(recipient: String, amount: String): Boolean =
        recipient.isNotBlank() && amount.isNotBlank()

    private companion object {
        private const val HEX_ADDR_LENGTH = 42
    }
}
