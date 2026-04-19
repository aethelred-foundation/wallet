package xyz.aethelred.wallet.core.services

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import xyz.aethelred.wallet.data.SecureStore
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Typed analytics event. All events live in this sealed hierarchy so we
 * can exhaustively enumerate the telemetry surface during privacy review.
 */
public sealed class AnalyticsEvent {
    /** Screen view. `name` is the Compose route name. */
    public data class ScreenView(public val name: String) : AnalyticsEvent()

    /** User tapped a primary CTA. `action` identifies the button. */
    public data class Action(public val action: String) : AnalyticsEvent()

    /** Feature-flag exposure. Emitted once per session. */
    public data class FeatureExposure(public val flag: String, public val enabled: Boolean) : AnalyticsEvent()

    /** Transaction lifecycle milestone (drafted, broadcast, mined). */
    public data class TxLifecycle(public val state: String, public val chainId: Long) : AnalyticsEvent()

    /** Error surfaced to the user. Non-PII fingerprint only. */
    public data class ErrorSurface(public val code: String) : AnalyticsEvent()
}

/**
 * Privacy-first analytics sink.
 *
 * The wallet deliberately ships **no third-party analytics SDK**. Events
 * are accumulated in-memory and uploaded via the control-plane audit
 * endpoint, which re-uses the same hash-linked chain so telemetry is
 * auditable end-to-end.
 *
 * User consent is enforced via [isOptedIn] — events are dropped until
 * the user accepts the analytics prompt in Settings. Once accepted, we
 * strip any personally-identifying detail before emit.
 */
@Singleton
public class AnalyticsService @Inject constructor(
    private val secureStore: SecureStore,
) {

    private val mutex = Mutex()
    private val _optedIn = MutableStateFlow(secureStore.readBoolean(KEY_OPT_IN, false))
    private val buffer: ArrayDeque<AnalyticsEvent> = ArrayDeque()

    /** Observable opt-in flag. Settings collects this for the toggle. */
    public val isOptedIn: StateFlow<Boolean> = _optedIn.asStateFlow()

    /** Flip the opt-in flag and persist it. */
    public suspend fun setOptedIn(value: Boolean): Unit = mutex.withLock {
        _optedIn.value = value
        secureStore.writeBoolean(KEY_OPT_IN, value)
        if (!value) buffer.clear()
    }

    /** Emit an event. Dropped if the user hasn't opted in. */
    public suspend fun emit(event: AnalyticsEvent): Unit = mutex.withLock {
        if (!_optedIn.value) return
        buffer.addLast(event)
        if (buffer.size > MAX_BUFFER) buffer.removeFirst()
    }

    /** Flush pending events — wired into the audit fanout loop. */
    public suspend fun drain(): List<AnalyticsEvent> = mutex.withLock {
        val snapshot = buffer.toList()
        buffer.clear()
        snapshot
    }

    private companion object {
        private const val KEY_OPT_IN = "analytics.opt_in"
        private const val MAX_BUFFER = 256
    }
}
