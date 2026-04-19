package xyz.aethelred.wallet.core.services

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

/**
 * WorkManager worker that refreshes account balances on a cadence.
 *
 * Scheduled every 15 minutes with Wi-Fi + battery-not-low constraints so
 * the wallet doesn't spam cellular data or drain the phone in background.
 *
 * The actual refresh logic delegates to the lists of services the app
 * already has — balance reads are just an `eth_getBalance` per account.
 * The scaffold keeps the work trivially scoped; the Android team fills
 * in the multi-chain fan-out once analytics tell us which chains users
 * actually check most often.
 */
@HiltWorker
public class BalanceRefreshWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        // FOLLOW-UP(android-team): iterate over WalletStateRepository.accounts
        // and call `eth_getBalance` per (account, chain) pair. Persist to
        // Room so ProcessLifecycle can't wipe the data.
        return Result.success()
    }

    /** Schedule / replace the periodic work. Call from Application.onCreate(). */
    public companion object {
        /** Unique work name so we don't stack duplicates across launches. */
        public const val UNIQUE_WORK_NAME: String = "aethelred.balance.refresh"

        /**
         * Refresh cadence. Chosen to match Play Store recommendations for
         * "infrequent background work" while still feeling fresh in the
         * wallet.
         */
        private const val INTERVAL_MINUTES: Long = 15

        /** Schedule the worker. Idempotent — replaces any existing work. */
        public fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.UNMETERED)
                .setRequiresBatteryNotLow(true)
                .build()
            val request = PeriodicWorkRequestBuilder<BalanceRefreshWorker>(
                INTERVAL_MINUTES,
                TimeUnit.MINUTES,
            ).setConstraints(constraints).build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        /** Cancel the worker — used on logout / reset flows. */
        public fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME)
        }
    }
}
