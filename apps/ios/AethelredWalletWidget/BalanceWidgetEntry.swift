import Foundation
import WidgetKit

/// Timeline entry consumed by the widget view.
public struct BalanceWidgetEntry: TimelineEntry {
    public let date: Date
    public let accountLabel: String
    public let totalUsd: Double
    public let deltaPct24h: Double

    public init(
        date: Date,
        accountLabel: String,
        totalUsd: Double,
        deltaPct24h: Double
    ) {
        self.date = date
        self.accountLabel = accountLabel
        self.totalUsd = totalUsd
        self.deltaPct24h = deltaPct24h
    }

    public static let placeholder = BalanceWidgetEntry(
        date: .now,
        accountLabel: "Primary",
        totalUsd: 18_432.12,
        deltaPct24h: 0.0182
    )
}
