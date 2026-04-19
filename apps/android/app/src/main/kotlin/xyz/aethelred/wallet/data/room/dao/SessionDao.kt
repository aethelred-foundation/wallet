package xyz.aethelred.wallet.data.room.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow
import xyz.aethelred.wallet.data.room.entities.StoredSessionEntity

/** DAO backing active sessions. */
@Dao
public interface SessionDao {
    @Query("SELECT * FROM sessions ORDER BY created_at DESC")
    public fun observeAll(): Flow<List<StoredSessionEntity>>

    @Query("SELECT * FROM sessions WHERE kind = :kind ORDER BY created_at DESC")
    public fun observeByKind(kind: String): Flow<List<StoredSessionEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun upsert(session: StoredSessionEntity)

    @Query("DELETE FROM sessions WHERE topic = :topic")
    public suspend fun deleteByTopic(topic: String)

    @Query("DELETE FROM sessions WHERE expires_at < :now")
    public suspend fun expireBefore(now: Long)
}
