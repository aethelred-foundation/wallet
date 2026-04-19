package xyz.aethelred.wallet.data.room.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import xyz.aethelred.wallet.data.room.entities.StoredNetworkEntity

/** DAO for the network registry snapshot. */
@Dao
public interface NetworkDao {
    @Query("SELECT * FROM networks ORDER BY name ASC")
    public fun observeAll(): Flow<List<StoredNetworkEntity>>

    @Query("SELECT * FROM networks WHERE chain_id = :chainId LIMIT 1")
    public suspend fun findByChainId(chainId: Long): StoredNetworkEntity?

    @Query("SELECT * FROM networks WHERE is_testnet = 0 ORDER BY name ASC")
    public fun observeMainnets(): Flow<List<StoredNetworkEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun upsertAll(networks: List<StoredNetworkEntity>)

    @Query("DELETE FROM networks")
    public suspend fun clearAll()
}
