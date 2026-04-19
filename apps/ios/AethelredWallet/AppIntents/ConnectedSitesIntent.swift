import AppIntents
import Foundation

/// App Intent that returns the list of connected sites for Shortcuts.
public struct ConnectedSitesIntent: AppIntent {

    public static let title: LocalizedStringResource = "List connected sites"
    public static let description: IntentDescription = IntentDescription(
        "Lists currently connected dApps that have an active WalletConnect session."
    )

    public init() {}

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<[String]> {
        // PRODUCTION FOLLOW-UP: query the ``DefaultWalletConnectService``
        // sessions list. For now we return a deterministic stub.
        return .result(value: ["Uniswap", "Aave", "ENS"])
    }
}
