package xyz.aethelred.wallet.instrumented

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.WorkerParameters
import androidx.work.testing.TestListenableWorkerBuilder
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import xyz.aethelred.wallet.core.services.BalanceRefreshWorker

/** Instrumented test for the balance refresh worker. */
@RunWith(AndroidJUnit4::class)
public class WorkManagerTest {

    @Test
    public fun balanceRefreshWorkerCompletes(): Unit = runTest {
        val context: Context = ApplicationProvider.getApplicationContext()
        val builder = TestListenableWorkerBuilder<BalanceRefreshWorker>(context)
        val worker = builder.build()
        val result = worker.doWork()
        assertEquals(ListenableWorker.Result.success(), result)
    }
}
