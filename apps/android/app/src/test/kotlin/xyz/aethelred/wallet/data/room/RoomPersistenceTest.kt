package xyz.aethelred.wallet.data.room

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import xyz.aethelred.wallet.data.room.entities.StoredAccountEntity

/**
 * Robolectric-backed DAO round-trip tests. Uses an in-memory Room database
 * so each test gets an isolated schema.
 */
@RunWith(RobolectricTestRunner::class)
public class RoomPersistenceTest {

    private lateinit var db: AethelredDatabase

    @Before
    public fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            AethelredDatabase::class.java,
        ).allowMainThreadQueries().build()
    }

    @After
    public fun tearDown() {
        db.close()
    }

    @Test
    public fun accountsRoundTrip(): Unit = runTest {
        val dao = db.accountDao()
        val row = StoredAccountEntity(
            id = "acct-1",
            displayName = "Treasury",
            address = "0xdead",
            namespace = "eip155",
            custody = "local",
            assuranceLevel = "strongbox",
            preferredChainId = 1,
            createdAt = 0,
        )
        dao.upsert(row)
        val fetched = dao.findById("acct-1")
        assertEquals("Treasury", fetched?.displayName)
        val observed = dao.observeAll().first()
        assertEquals(1, observed.size)
    }

    @Test
    public fun accountHideMarksHidden(): Unit = runTest {
        val dao = db.accountDao()
        val row = StoredAccountEntity(
            id = "acct-2",
            displayName = "Burner",
            address = "0xbeef",
            namespace = "eip155",
            custody = "local",
            assuranceLevel = "tee",
            preferredChainId = 1,
            createdAt = 0,
        )
        dao.upsert(row)
        dao.hide("acct-2")
        val fetched = dao.findById("acct-2")
        assertNotNull(fetched)
        assertEquals(true, fetched?.isHidden)
    }
}
