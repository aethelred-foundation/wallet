import SwiftUI
import UIKit

/// Top-level `@main` entry for the Aethelred Wallet iOS app.
///
/// `AethelredWalletApp` composes three long-lived singletons and injects
/// them into the SwiftUI environment:
///  - ``AppState`` — observable session / lock / account state.
///  - ``AppLockCoordinator`` — arbiter of lock / unlock flow.
///  - ``ThemeColors`` — active palette for light / dark mode.
///
/// No business logic lives here. The app routes directly to either the
/// lock screen or the authenticated root based on ``AppState/isLocked``.
@main
@MainActor
struct AethelredWalletApp: App {

    /// Observable container owning the authenticated session.
    @StateObject private var appState = AppState()

    /// Decides when to present or dismiss the lock screen.
    @StateObject private var lockCoordinator = AppLockCoordinator(
        inactivityGraceSeconds: 60
    )

    /// Captures app lifecycle notifications so the coordinator can react.
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Styling that must happen before the first view renders.
        let barAppearance = UINavigationBarAppearance()
        barAppearance.configureWithTransparentBackground()
        UINavigationBar.appearance().standardAppearance = barAppearance
        UINavigationBar.appearance().scrollEdgeAppearance = barAppearance
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .environmentObject(lockCoordinator)
                .preferredColorScheme(.dark)
                .task {
                    await appState.bootstrap()
                }
                .onChange(of: scenePhase) { _, newPhase in
                    lockCoordinator.handleScenePhase(newPhase, appState: appState)
                }
        }
    }
}

/// Routes between the authenticated surface and the lock screen.
///
/// Kept as a separate view so SwiftUI can diff on ``AppState/isLocked``
/// without tearing down the whole scene every time the wallet locks.
@MainActor
struct RootView: View {

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var lockCoordinator: AppLockCoordinator

    var body: some View {
        ZStack {
            if appState.isLocked {
                LockScreen()
                    .transition(.opacity)
            } else {
                MainTabsView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.18), value: appState.isLocked)
    }
}

/// Five-tab root for the authenticated experience.
@MainActor
struct MainTabsView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Home", systemImage: "house.fill") }

            AccountsView()
                .tabItem { Label("Accounts", systemImage: "person.crop.circle") }

            ReceiveView()
                .tabItem { Label("Receive", systemImage: "qrcode") }

            SendView()
                .tabItem { Label("Send", systemImage: "paperplane.fill") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(ThemeColors.dark.accent)
    }
}
