package xyz.aethelred.wallet.data.room.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Enterprise tenant / workspace profile. The wallet scopes signing
 * policies, audit fanout, and feature flags per tenant so a consumer
 * user and a corporate treasurer can share the same binary.
 */
@Entity(tableName = "tenants")
public data class StoredTenantProfileEntity(
    @PrimaryKey public val id: String,
    @ColumnInfo(name = "display_name") public val displayName: String,
    @ColumnInfo(name = "kind") public val kind: String,
    @ColumnInfo(name = "region") public val region: String?,
    @ColumnInfo(name = "plan") public val plan: String,
    @ColumnInfo(name = "enrolled_at") public val enrolledAt: Long,
    @ColumnInfo(name = "control_plane_url") public val controlPlaneUrl: String,
    @ColumnInfo(name = "feature_flags") public val featureFlags: Map<String, String>,
)
