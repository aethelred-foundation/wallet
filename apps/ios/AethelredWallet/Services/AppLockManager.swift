import Combine
import Foundation
import SwiftUI
import UIKit

/// Service that owns the inactivity timer and Face ID lock gating that
/// wraps the existing ``AppLockCoordinator``.
///
/// Extracted into a service so ``AppLockCoordinator`` can remain tightly
/// scoped to scene-phase handling while this layer deals with richer
/// lock logic: timeouts configurable by the user, wall-clock drift
/// checks, and opt-in "lock on notification tap" semantics.
@MainActor
public final class AppLockManager: ObservableObject {

    @Published public private(set) var lockPolicy: LockPolicy
    @Published public private(set) var lastTouchAt: Date = .init()

    private let clock: @Sendable () -> Date
    private var timerTask: Task<Void, Never>?
    private weak var appState: AppState?

    public init(
        policy: LockPolicy = .default,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.lockPolicy = policy
        self.clock = clock
    }

    /// Bind the manager to an ``AppState`` and start the inactivity
    /// timer. Call once the app has cold-booted.
    public func attach(_ state: AppState) {
        self.appState = state
        restartTimer()
    }

    /// Update the stored policy. Settings screen calls through here.
    public func updatePolicy(_ policy: LockPolicy) {
        self.lockPolicy = policy
        restartTimer()
    }

    /// Mark the user as having touched the UI so the inactivity timer
    /// resets.
    public func touch() {
        lastTouchAt = clock()
        appState?.touchActivity()
    }

    // MARK: Timer loop

    private func restartTimer() {
        timerTask?.cancel()
        let interval = lockPolicy.inactivityGraceSeconds
        timerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000 / 10))
                await self?.tick(interval: interval)
            }
        }
    }

    private func tick(interval: TimeInterval) async {
        guard let appState else { return }
        let now = clock()
        let elapsed = now.timeIntervalSince(lastTouchAt)
        if !appState.isLocked, elapsed >= interval {
            await appState.lock(reason: .inactivity)
        }
    }
}

/// User-configurable lock policy.
public struct LockPolicy: Sendable, Equatable, Codable {
    public let inactivityGraceSeconds: TimeInterval
    public let lockOnBackground: Bool
    public let requireBiometricOnEverySignature: Bool

    public init(
        inactivityGraceSeconds: TimeInterval,
        lockOnBackground: Bool,
        requireBiometricOnEverySignature: Bool
    ) {
        self.inactivityGraceSeconds = inactivityGraceSeconds
        self.lockOnBackground = lockOnBackground
        self.requireBiometricOnEverySignature = requireBiometricOnEverySignature
    }

    public static let `default` = LockPolicy(
        inactivityGraceSeconds: 60,
        lockOnBackground: true,
        requireBiometricOnEverySignature: true
    )

    public static let paranoid = LockPolicy(
        inactivityGraceSeconds: 15,
        lockOnBackground: true,
        requireBiometricOnEverySignature: true
    )

    public static let permissive = LockPolicy(
        inactivityGraceSeconds: 300,
        lockOnBackground: true,
        requireBiometricOnEverySignature: false
    )
}
