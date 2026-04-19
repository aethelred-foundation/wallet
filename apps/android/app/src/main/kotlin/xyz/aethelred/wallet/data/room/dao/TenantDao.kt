package xyz.aethelred.wallet.data.room.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import xyz.aethelred.wallet.data.room.entities.StoredTenantProfileEntity

/** DAO for tenant / workspace rows. */
@Dao
public interface TenantDao {
    @Query("SELECT * FROM tenants ORDER BY enrolled_at ASC")
    public fun observeAll(): Flow<List<StoredTenantProfileEntity>>

    @Query("SELECT * FROM tenants WHERE id = :id LIMIT 1")
    public suspend fun findById(id: String): StoredTenantProfileEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun upsert(tenant: StoredTenantProfileEntity)

    @Query("DELETE FROM tenants WHERE id = :id")
    public suspend fun deleteById(id: String)
}
