package xyz.aethelred.wallet.viewmodel

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

/** State for the swap surface. */
public data class SwapUiState(
    public val payAmount: String = "",
    public val receiveAmount: String = "",
    public val slippagePercent: Float = 0.5f,
    public val priceImpactPercent: Float = 0f,
    public val route: String = "—",
    public val simulating: Boolean = false,
    public val error: String? = null,
)

/**
 * ViewModel for [xyz.aethelred.wallet.ui.screens.SwapScreen].
 *
 * Delegates to [xyz.aethelred.wallet.core.services.TxSimulator] for
 * pre-signing simulation and a yet-to-be-wired routing service for path
 * discovery.
 */
@HiltViewModel
public class SwapViewModel @Inject constructor() : ViewModel() {

    private val _state = MutableStateFlow(SwapUiState())
    public val state: StateFlow<SwapUiState> = _state.asStateFlow()

    /** Update the "pay" amount. */
    public fun onPayAmountChange(value: String) {
        _state.update { it.copy(payAmount = value, error = null) }
    }

    /** Update the "receive" amount. */
    public fun onReceiveAmountChange(value: String) {
        _state.update { it.copy(receiveAmount = value, error = null) }
    }

    /** Update the user-selected slippage. */
    public fun onSlippageChange(percent: Float) {
        _state.update { it.copy(slippagePercent = percent) }
    }

    /** Kick off a simulation. Stub — wire through [TxSimulator] once routed. */
    public fun simulate() {
        _state.update { it.copy(simulating = true) }
        // FOLLOW-UP(android-team): integrate with router + TxSimulator.
        _state.update { it.copy(simulating = false, route = "Uniswap V3") }
    }
}
