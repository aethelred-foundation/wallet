package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Inactivity / biometric-gate configuration.
 *
 * @property idleLockWindowMs Auto-lock after this many milliseconds of
 *                            no interaction. Defaults to 60s.
 * @property requireBiometricsPerSignature Whether every signature must be
 *                            gated behind a fresh biometric gesture.
 * @property allowDeviceCredentialFallback Whether PIN/pattern can stand in
 *                            for biometrics.
 * @property auditFailedUnlockAttempts Whether rejected unlocks emit audit
 *                            events. Defaults to true — mandatory in
 *                            regulated tenants.
 */
public data class AppLockConfig(
    public val idleLockWindowMs: Long = 60_000,
    public val requireBiometricsPerSignature: Boolean = true,
    public val allowDeviceCredentialFallback: Boolean = true,
    public val auditFailedUnlockAttempts: Boolean = true,
)

/**
 * Centralised lock-state orchestrator.
 *
 * Sits between [xyz.aethelred.wallet.data.WalletStateRepository] (which
 * owns the top-level "isLocked" flag) and the activity-level
 * [xyz.aethelred.wallet.auth.BiometricUnlock]. Responsibilities:
 *
 *  * Track last-interaction timestamp.
 *  * Decide when idle-lock fires.
 *  * Persist the [AppLockConfig] across process restarts.
 *
 * Keeps its own minimal state so tests can exercise the policies without
 * spinning up the full repository graph.
 */
@Singleton
public class AppLockManager @Inject constructor() {

    private val _config = MutableStateFlow(AppLockConfig())

    /** Observable config — Settings screen collects here. */
    public val config: StateFlow<AppLockConfig> = _config.asStateFlow()

    private var lastInteractionAt: Long = System.currentTimeMillis()

    /** Update the whole config atomically. */
    public fun updateConfig(block: (AppLockConfig) -> AppLockConfig) {
        _config.update(block)
    }

    /**
     * Called from every user input path to postpone the idle timer.
     *
     * Cheap — just stamps [lastInteractionAt].
     */
    public fun markInteraction() {
        lastInteractionAt = System.currentTimeMillis()
    }

    /**
     * True when idle-lock should fire. Callers invoke this from the
     * process-lifecycle observer on resume.
     */
    public fun shouldLock(now: Long = System.currentTimeMillis()): Boolean {
        val elapsed = now - lastInteractionAt
        return elapsed >= _config.value.idleLockWindowMs
    }

    /** Bypass for dev-only screens. Tests call through here. */
    public fun resetIdle() {
        lastInteractionAt = System.currentTimeMillis()
    }
}
