import Combine
import Foundation
import SwiftUI
import UIKit

/// Central arbiter for when the wallet is locked vs unlocked.
///
/// The lock rules are:
///  1. The app is **always** locked on cold launch until the user passes
///     biometric auth on the lock screen.
///  2. When the app backgrounds (``UIApplication/didEnterBackgroundNotification``),
///     we snap to the lock screen before the system screenshot is taken
///     so cached thumbnails never reveal account state.
///  3. On foreground, if more than ``inactivityGraceSeconds`` has elapsed
///     since the last recorded user activity, the lock screen remains up
///     and the user must re-auth.
///
/// Living coordinator — not a pure value type — because it subscribes to
/// system notifications and timers.
@MainActor
public final class AppLockCoordinator: ObservableObject {

    /// Seconds of foreground inactivity before the wallet locks itself.
    /// `60` is the product default per the PRD; users can bump it down
    /// (never up) from settings.
    public let inactivityGraceSeconds: TimeInterval

    private var backgroundEnteredAt: Date?
    private var cancellables: Set<AnyCancellable> = []

    /// Designated initializer.
    public init(inactivityGraceSeconds: TimeInterval) {
        self.inactivityGraceSeconds = inactivityGraceSeconds
        subscribeToApplicationNotifications()
    }

    /// Consume the latest `scenePhase` from SwiftUI. `AethelredWalletApp`
    /// forwards this from its root scene so we don't have to stand up a
    /// duplicate observer.
    public func handleScenePhase(_ phase: ScenePhase, appState: AppState) {
        switch phase {
        case .background, .inactive:
            recordBackground(appState: appState)
        case .active:
            handleForeground(appState: appState)
        @unknown default:
            break
        }
    }

    // MARK: UIApplication notifications

    private func subscribeToApplicationNotifications() {
        let center = NotificationCenter.default

        center.publisher(for: UIApplication.didEnterBackgroundNotification)
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.backgroundEnteredAt = Date()
                }
            }
            .store(in: &cancellables)

        center.publisher(for: UIApplication.protectedDataWillBecomeUnavailableNotification)
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.backgroundEnteredAt = Date()
                }
            }
            .store(in: &cancellables)
    }

    // MARK: Scene phase handlers

    private func recordBackground(appState: AppState) {
        backgroundEnteredAt = Date()
        Task { await appState.lock(reason: .background) }
    }

    private func handleForeground(appState: AppState) {
        defer { backgroundEnteredAt = nil }

        // Cold launch: already locked, nothing to do.
        guard let backgroundedAt = backgroundEnteredAt else {
            return
        }

        let elapsed = Date().timeIntervalSince(backgroundedAt)
        if elapsed >= inactivityGraceSeconds {
            Task { await appState.lock(reason: .inactivity) }
        }
    }
}
