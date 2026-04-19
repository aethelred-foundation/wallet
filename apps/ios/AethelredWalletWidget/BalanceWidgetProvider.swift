import Foundation
import WidgetKit

/// Timeline provider that refreshes hourly and reads cached values
/// from an App Group container.
public struct BalanceWidgetProvider: TimelineProvider {

    private static let appGroupId = "group.network.aethelred.wallet"
    private static let balanceKey = "widget.balance.totalUsd"
    private static let deltaKey = "widget.balance.deltaPct24h"
    private static let labelKey = "widget.balance.accountLabel"

    public init() {}

    public func placeholder(in context: Context) -> BalanceWidgetEntry {
        .placeholder
    }

    public func getSnapshot(in context: Context, completion: @escaping (BalanceWidgetEntry) -> Void) {
        completion(read(at: Date()))
    }

    public func getTimeline(in context: Context, completion: @escaping (Timeline<BalanceWidgetEntry>) -> Void) {
        let now = Date()
        let next = now.addingTimeInterval(60 * 60)
        let entry = read(at: now)
        let timeline = Timeline(entries: [entry], policy: .after(next))
        completion(timeline)
    }

    private func read(at date: Date) -> BalanceWidgetEntry {
        let defaults = UserDefaults(suiteName: Self.appGroupId)
        let total = defaults?.double(forKey: Self.balanceKey) ?? BalanceWidgetEntry.placeholder.totalUsd
        let delta = defaults?.double(forKey: Self.deltaKey) ?? BalanceWidgetEntry.placeholder.deltaPct24h
        let label = defaults?.string(forKey: Self.labelKey) ?? BalanceWidgetEntry.placeholder.accountLabel
        return BalanceWidgetEntry(
            date: date,
            accountLabel: label,
            totalUsd: total,
            deltaPct24h: delta
        )
    }
}

/// Convenience for the main app to publish the shared values.
public enum BalanceWidgetCache {
    private static let defaults = UserDefaults(suiteName: "group.network.aethelred.wallet")

    public static func save(label: String, totalUsd: Double, deltaPct24h: Double) {
        defaults?.set(label, forKey: "widget.balance.accountLabel")
        defaults?.set(totalUsd, forKey: "widget.balance.totalUsd")
        defaults?.set(deltaPct24h, forKey: "widget.balance.deltaPct24h")
    }
}
