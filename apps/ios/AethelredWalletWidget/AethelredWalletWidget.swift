import SwiftUI
import WidgetKit

/// Widget bundle entry point for the Aethelred Wallet home-screen
/// widgets.
///
/// Only one widget ships today — the balance widget — but the bundle
/// pattern means adding more (transaction history, approvals queue)
/// is a drop-in change.
@main
struct AethelredWalletWidgetBundle: WidgetBundle {
    var body: some Widget {
        BalanceWidget()
    }
}

/// Balance widget — displays the primary account's USD balance.
public struct BalanceWidget: Widget {
    public let kind: String = "network.aethelred.wallet.widget.balance"

    public init() {}

    public var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BalanceWidgetProvider()) { entry in
            BalanceWidgetView(entry: entry)
                .containerBackground(for: .widget) { Color.black }
        }
        .configurationDisplayName("Aethelred balance")
        .description("Your wallet's total USD value at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
