package xyz.aethelred.wallet.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import xyz.aethelred.wallet.data.room.dao.TransactionDao
import xyz.aethelred.wallet.ui.components.TxDirection
import xyz.aethelred.wallet.ui.screens.ActivityItem
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

/** View-model backing [xyz.aethelred.wallet.ui.screens.ActivityScreen]. */
@HiltViewModel
public class ActivityViewModel @Inject constructor(
    private val transactionDao: TransactionDao,
) : ViewModel() {

    /** UI state — list of activity items plus loading flag. */
    public data class UiState(
        public val items: List<ActivityItem> = emptyList(),
        public val isLoading: Boolean = true,
    )

    private val _state = MutableStateFlow(UiState())
    public val state: StateFlow<UiState> = _state.asStateFlow()

    private val formatter = SimpleDateFormat("MMM d HH:mm", Locale.getDefault())

    init {
        viewModelScope.launch {
            transactionDao.observeAll().collect { rows ->
                _state.update {
                    it.copy(
                        isLoading = false,
                        items = rows.map { tx ->
                            ActivityItem(
                                id = tx.hash,
                                direction = when (tx.direction) {
                                    "outgoing" -> TxDirection.Outgoing
                                    "incoming" -> TxDirection.Incoming
                                    "pending" -> TxDirection.Pending
                                    "failed" -> TxDirection.Failed
                                    else -> TxDirection.Contract
                                },
                                title = tx.memo ?: tx.direction.replaceFirstChar { c -> c.uppercase() },
                                subtitle = tx.toAddress ?: tx.fromAddress,
                                amountFormatted = tx.valueWei.toString(),
                                timestamp = formatter.format(Date(tx.submittedAt)),
                            )
                        },
                    )
                }
            }
        }
    }
}
