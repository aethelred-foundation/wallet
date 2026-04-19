import Foundation
import SwiftData

/// Persisted tenant metadata — tier, hosting region, and compliance
/// flags surfaced through the tenant profile view.
@Model
public final class StoredTenantProfile {
    @Attribute(.unique) public var id: String
    public var tenantName: String
    public var tier: String
    public var hostingRegion: String
    public var complianceFlags: String
    public var transactionCapUsd: Double?
    public var dailyVolumeCapUsd: Double?
    public var supportEmail: String?
    public var updatedAt: Int64

    public init(
        id: String,
        tenantName: String,
        tier: String,
        hostingRegion: String,
        complianceFlags: String,
        transactionCapUsd: Double? = nil,
        dailyVolumeCapUsd: Double? = nil,
        supportEmail: String? = nil,
        updatedAt: Int64
    ) {
        self.id = id
        self.tenantName = tenantName
        self.tier = tier
        self.hostingRegion = hostingRegion
        self.complianceFlags = complianceFlags
        self.transactionCapUsd = transactionCapUsd
        self.dailyVolumeCapUsd = dailyVolumeCapUsd
        self.supportEmail = supportEmail
        self.updatedAt = updatedAt
    }
}
