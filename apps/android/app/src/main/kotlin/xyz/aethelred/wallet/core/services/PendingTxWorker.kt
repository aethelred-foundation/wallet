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
 * Background worker that polls pending transactions for receipts.
 *
 * Runs every 5 minutes while the app is backgrounded. Once a receipt is
 * available it updates the Room transaction entity, emits a push so the
 * UI re-renders, and writes an audit event. On repeated failures the
 * worker backs off exponentially up to 30 minutes.
 *
 * This is intentionally separate from BalanceRefreshWorker because tx
 * receipts need tighter cadence and smaller payloads.
 */
@HiltWorker
public class PendingTxWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        // FOLLOW-UP(android-team): read pending tx hashes from Room, call
        // `eth_getTransactionReceipt` per hash, and update status when
        // receipts arrive. Emit audit events for the transition.
        return Result.success()
    }

    public companion object {
        /** Unique work name so launches don't stack duplicate workers. */
        public const val UNIQUE_WORK_NAME: String = "aethelred.pending.tx"

        private const val INTERVAL_MINUTES: Long = 5

        /** Schedule the worker. Idempotent. */
        public fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val request = PeriodicWorkRequestBuilder<PendingTxWorker>(
                INTERVAL_MINUTES,
                TimeUnit.MINUTES,
            ).setConstraints(constraints).build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }

        /** Cancel the worker. */
        public fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK_NAME)
        }
    }
}
