package xyz.aethelred.wallet.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import xyz.aethelred.wallet.core.services.AppLockManager
import xyz.aethelred.wallet.data.room.dao.PasskeyDao
import xyz.aethelred.wallet.data.room.dao.SessionDao
import xyz.aethelred.wallet.ui.screens.PasskeyUi
import xyz.aethelred.wallet.ui.screens.SecuritySessionUi
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

/** ViewModel backing [xyz.aethelred.wallet.ui.screens.SecurityScreen]. */
@HiltViewModel
public class SecurityViewModel @Inject constructor(
    private val passkeyDao: PasskeyDao,
    private val sessionDao: SessionDao,
    private val appLockManager: AppLockManager,
) : ViewModel() {

    /** UI state. */
    public data class UiState(
        public val passkeys: List<PasskeyUi> = emptyList(),
        public val sessions: List<SecuritySessionUi> = emptyList(),
    )

    private val _state = MutableStateFlow(UiState())
    public val state: StateFlow<UiState> = _state.asStateFlow()

    private val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())

    init {
        viewModelScope.launch {
            passkeyDao.observeAll().collect { rows ->
                _state.update { current ->
                    current.copy(
                        passkeys = rows.map {
                            PasskeyUi(
                                id = it.credentialId,
                                label = it.label,
                                transport = it.transport,
                                enrolledAt = formatter.format(Date(it.enrolledAt)),
                            )
                        },
                    )
                }
            }
        }
        viewModelScope.launch {
            sessionDao.observeAll().collect { rows ->
                _state.update { current ->
                    current.copy(
                        sessions = rows.map {
                            SecuritySessionUi(
                                id = it.topic,
                                label = it.origin,
                                origin = it.kind,
                            )
                        },
                    )
                }
            }
        }
    }

    /** Persist a new auto-lock window length. */
    public fun setAutoLockIndex(index: Int) {
        val window = when (index) {
            0 -> 0L
            1 -> 30_000L
            2 -> 60_000L
            else -> 5 * 60_000L
        }
        appLockManager.updateConfig { it.copy(idleLockWindowMs = window) }
    }
}
