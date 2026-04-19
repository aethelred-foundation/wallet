package xyz.aethelred.wallet

import android.app.Application
import android.util.Log
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import xyz.aethelred.wallet.data.WalletStateRepository
import javax.inject.Inject

/**
 * Application-level entry point for the Aethelred Wallet.
 *
 * Responsibilities:
 *  - Host the Hilt component graph via [HiltAndroidApp].
 *  - Install a process-wide [ProcessLifecycleOwner] observer so the wallet
 *    locks itself on backgrounding (see [WalletStateRepository.onProcessStopped]).
 *  - Own a single application-scoped [CoroutineScope] that subsystems can
 *    piggy-back on for fire-and-forget work (audit fanout, background
 *    RPC warmers). Tests replace this via Hilt's `TestApplication` swap.
 *
 * The actual signing and key material live inside the hardware-backed
 * keystore — nothing here holds raw secrets in memory.
 */
@HiltAndroidApp
public class AethelredWalletApplication : Application() {

    /**
     * Wallet state singleton. Injected so the process-lifecycle observer
     * can call [WalletStateRepository.onProcessStopped] without creating
     * a second instance (which would lose the in-memory unlock token).
     */
    @Inject
    internal lateinit var walletStateRepository: WalletStateRepository

    /**
     * Application-scoped coroutine scope. Errors are logged and suppressed;
     * a panicking background coroutine should never take down the process.
     */
    public val applicationScope: CoroutineScope = CoroutineScope(
        context = SupervisorJob() +
            Dispatchers.Default +
            CoroutineExceptionHandler { _, throwable ->
                Log.e(TAG, "Uncaught coroutine error", throwable)
            },
    )

    override fun onCreate() {
        super.onCreate()
        installLifecycleLock()
    }

    /**
     * Re-gates the wallet whenever the process goes to the background.
     * The 60-second idle timer lives inside [WalletStateRepository] — this
     * observer only signals the transition.
     */
    private fun installLifecycleLock() {
        ProcessLifecycleOwner.get().lifecycle.addObserver(
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_STOP -> walletStateRepository.onProcessStopped()
                    Lifecycle.Event.ON_START -> walletStateRepository.onProcessStarted()
                    else -> Unit
                }
            },
        )
    }

    private companion object {
        private const val TAG = "AethelredWalletApp"
    }
}
