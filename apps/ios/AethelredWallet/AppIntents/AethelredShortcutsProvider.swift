import AppIntents

/// Registers the wallet's shortcuts with the system.
///
/// Shortcuts surfaced here are automatically added to the user's
/// Shortcuts app for easy discovery.
public struct AethelredShortcutsProvider: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CheckBalanceIntent(),
            phrases: [
                "Check my \(.applicationName) balance",
                "How much crypto is in \(.applicationName)"
            ],
            shortTitle: "Check balance",
            systemImageName: "wallet.pass.fill"
        )
        AppShortcut(
            intent: ConnectedSitesIntent(),
            phrases: [
                "Show connected sites in \(.applicationName)",
                "Which sites are connected to \(.applicationName)"
            ],
            shortTitle: "Connected sites",
            systemImageName: "antenna.radiowaves.left.and.right"
        )
    }
}
