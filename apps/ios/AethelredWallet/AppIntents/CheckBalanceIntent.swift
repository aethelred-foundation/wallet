import AppIntents
import Foundation

/// App Intent that reports the primary account's USD balance via Siri.
///
/// Reads from the shared App Group container populated by
/// ``BalanceWidgetCache`` so the intent runs in milliseconds without
/// waking the main app.
public struct CheckBalanceIntent: AppIntent {

    public static let title: LocalizedStringResource = "Check wallet balance"
    public static let description: IntentDescription = IntentDescription(
        "Reads your primary account balance from the shared cache."
    )

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<Double> {
        let defaults = UserDefaults(suiteName: "group.network.aethelred.wallet")
        let total = defaults?.double(forKey: "widget.balance.totalUsd") ?? 0
        let dialog = IntentDialog("Your wallet is worth about $\(Int(total.rounded())) USD right now.")
        return .result(value: total, dialog: dialog)
    }
}
