package xyz.aethelred.wallet.core.services

import javax.inject.Inject
import javax.inject.Singleton

/**
 * Tagged crash context. Keep it data-only so the reporter never leaks
 * references to activity instances.
 */
public data class CrashContext(
    public val thread: String,
    public val throwable: Throwable,
    public val breadcrumbs: List<String> = emptyList(),
    public val userId: String? = null,
)

/**
 * Crash capture contract.
 *
 * FOLLOW-UP(android-team): wire `com.google.firebase:firebase-crashlytics-ktx`
 * and delegate to `FirebaseCrashlytics.getInstance()`. Until then this
 * class accumulates crashes in-memory so the Developer Tools surface can
 * render them locally.
 *
 * The interface never names Firebase directly so the team can swap to
 * Sentry / Embrace without touching every call site.
 */
@Singleton
public class CrashReporter @Inject constructor() {

    private val recent: ArrayDeque<CrashContext> = ArrayDeque()

    /** Most recent crashes captured in this session (oldest → newest). */
    public fun recentCrashes(): List<CrashContext> = synchronized(this) { recent.toList() }

    /** Record a breadcrumb — rolling log of recent app events. */
    private val breadcrumbs: ArrayDeque<String> = ArrayDeque()
    public fun breadcrumb(message: String): Unit = synchronized(this) {
        breadcrumbs.addLast("[${System.currentTimeMillis()}] $message")
        if (breadcrumbs.size > MAX_BREADCRUMBS) breadcrumbs.removeFirst()
    }

    /** Snapshot of breadcrumbs, oldest → newest. */
    public fun breadcrumbs(): List<String> = synchronized(this) { breadcrumbs.toList() }

    /** Record a non-fatal exception. */
    public fun recordNonFatal(throwable: Throwable, thread: String = Thread.currentThread().name) {
        record(
            CrashContext(
                thread = thread,
                throwable = throwable,
                breadcrumbs = breadcrumbs(),
            ),
        )
    }

    /** Record a fatal exception. */
    public fun recordFatal(throwable: Throwable, thread: String = Thread.currentThread().name) {
        record(
            CrashContext(
                thread = thread,
                throwable = throwable,
                breadcrumbs = breadcrumbs(),
            ),
        )
    }

    private fun record(context: CrashContext): Unit = synchronized(this) {
        recent.addLast(context)
        if (recent.size > MAX_CRASHES) recent.removeFirst()
    }

    private companion object {
        private const val MAX_BREADCRUMBS = 64
        private const val MAX_CRASHES = 16
    }
}
